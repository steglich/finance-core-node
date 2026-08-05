import { randomUUID } from "node:crypto";
import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEvent } from "../../shared/domain/domain-event.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import { Investment } from "../domain/investment.js";
import type { InvestmentType } from "../domain/investment.js";
import type { InvestmentOperationService } from "../domain/investment-operation-service.js";
import { valuePosition } from "../domain/investment-position.js";
import { Money } from "../domain/money.js";
import type { AccountRepository } from "../infrastructure/account-repository.js";
import type { CategoryRepository } from "../infrastructure/category-repository.js";
import type {
  InvestmentPositionSummary,
  InvestmentRepository,
  PortfolioEntry,
} from "../infrastructure/investment-repository.js";
import type { InvestmentQuoteRepository } from "../infrastructure/investment-quote-repository.js";
import type { TransactionRepository } from "../infrastructure/transaction-repository.js";
import {
  validateCreateInvestmentRequest,
  validateInvestmentListQuery,
  validateInvestmentOperationRequest,
  validateInvestmentQuoteRequest,
  validateUpdateInvestmentRequest,
} from "./dtos.js";

/**
 * The derived figures of a position, as they go over the wire.
 */
export interface SerializedPosition {
  quantity: number;
  averageCost: number;
  investedAmount: number;
  currentValue: number;
  unrealizedResult: number;
  realizedResult: number;
  incomeReceived: number;
  profitabilityPercent: number;
  /** False when the current value fell back to the invested amount. */
  quoted: boolean;
  unitPrice?: number | undefined;
}

/**
 * One portfolio line: the investment's identity plus its priced position.
 */
export interface SerializedInvestment extends SerializedPosition {
  id: string;
  name: string;
  investmentType: InvestmentType;
  symbol?: string | undefined;
  currency: string;
  status: string;
}

/**
 * Investment endpoints. The company scope always comes from the token.
 */
export class InvestmentController {
  constructor(
    private readonly investmentRepository: InvestmentRepository,
    private readonly quoteRepository: InvestmentQuoteRepository,
    private readonly accountRepository: AccountRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly transactionRepository: TransactionRepository,
    private readonly operationService: InvestmentOperationService,
    private readonly eventBus: DomainEventBus,
  ) {}

  /**
   * POST /api/v1/investments
   */
  async register(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateCreateInvestmentRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const input = validation.data;

    const account = await this.accountRepository.findById(
      companyId,
      input.accountId,
    );
    if (!account) {
      return { statusCode: 404, body: { error: "Account not found" } };
    }

    const expenseCategory = await this.categoryRepository.findById(
      companyId,
      input.expenseCategoryId,
    );
    if (!expenseCategory) {
      return { statusCode: 404, body: { error: "Expense category not found" } };
    }

    const incomeCategory = await this.categoryRepository.findById(
      companyId,
      input.incomeCategoryId,
    );
    if (!incomeCategory) {
      return { statusCode: 404, body: { error: "Income category not found" } };
    }

    const result = Investment.create({
      companyId,
      account: {
        id: account.id,
        companyId: account.companyId,
        currency: account.currency,
        isActive: account.isActive,
      },
      name: input.name,
      investmentType: input.investmentType,
      symbol: input.symbol,
      // The investment follows the account's currency unless told otherwise;
      // a mismatch is rejected by the aggregate either way.
      currency: input.currency ?? account.currency,
      expenseCategory: {
        id: expenseCategory.id,
        companyId: expenseCategory.companyId,
        type: expenseCategory.type,
      },
      incomeCategory: {
        id: incomeCategory.id,
        companyId: incomeCategory.companyId,
        type: incomeCategory.type,
      },
    });

    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    const investment = result.value;
    await this.investmentRepository.create(investment);
    this.publish(investment.events);
    investment.clearEvents();

    return { statusCode: 201, body: investment.toJSON() };
  }

  /**
   * GET /api/v1/investments
   */
  async list(companyId: string, query: unknown): Promise<ControllerResult> {
    const validation = validateInvestmentListQuery(query);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const filter = validation.data;
    const referenceDate = filter.referenceDate ?? new Date();

    const entries = await this.investmentRepository.portfolio(
      companyId,
      referenceDate,
      {
        status: filter.status,
        investmentType: filter.investmentType,
      },
    );

    return {
      statusCode: 200,
      body: {
        investments: entries.map((entry) => this.serializeEntry(entry)),
        total: entries.length,
        referenceDate,
      },
    };
  }

  /**
   * GET /api/v1/investments/portfolio
   *
   * Position, current value, result and distribution by type, each line
   * carrying whether it could be quoted at all.
   */
  async portfolio(companyId: string, query: unknown): Promise<ControllerResult> {
    const validation = validateInvestmentListQuery(query);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const filter = validation.data;
    const referenceDate = filter.referenceDate ?? new Date();

    const entries = await this.investmentRepository.portfolio(
      companyId,
      referenceDate,
      { status: filter.status, investmentType: filter.investmentType },
    );

    const lines = entries.map((entry) => this.serializeEntry(entry));

    // Totals are summed per currency; mixing them silently would be the same
    // mistake as assuming an exchange rate of 1.
    const currency = entries[0]?.currency ?? "BRL";
    const sameCurrency = entries.every((entry) => entry.currency === currency);

    const totals = lines.reduce(
      (acc, line) => ({
        investedAmount: acc.investedAmount + line.investedAmount,
        currentValue: acc.currentValue + line.currentValue,
        realizedResult: acc.realizedResult + line.realizedResult,
        incomeReceived: acc.incomeReceived + line.incomeReceived,
      }),
      {
        investedAmount: 0,
        currentValue: 0,
        realizedResult: 0,
        incomeReceived: 0,
      },
    );

    const unrealizedResult =
      Math.round((totals.currentValue - totals.investedAmount) * 100) / 100;
    const profitabilityPercent =
      totals.investedAmount === 0
        ? 0
        : ((totals.currentValue +
            totals.realizedResult +
            totals.incomeReceived -
            totals.investedAmount) /
            totals.investedAmount) *
          100;

    const byType = new Map<string, { currentValue: number; count: number }>();
    for (const line of lines) {
      const current = byType.get(line.investmentType) ?? {
        currentValue: 0,
        count: 0,
      };
      byType.set(line.investmentType, {
        currentValue:
          Math.round((current.currentValue + line.currentValue) * 100) / 100,
        count: current.count + 1,
      });
    }

    const distribution = [...byType.entries()].map(([type, value]) => ({
      investmentType: type,
      currentValue: value.currentValue,
      count: value.count,
      sharePercent:
        totals.currentValue === 0
          ? 0
          : (value.currentValue / totals.currentValue) * 100,
    }));

    return {
      statusCode: 200,
      body: {
        referenceDate,
        currency: sameCurrency ? currency : undefined,
        investments: lines,
        totals: {
          investedAmount: Math.round(totals.investedAmount * 100) / 100,
          currentValue: Math.round(totals.currentValue * 100) / 100,
          realizedResult: Math.round(totals.realizedResult * 100) / 100,
          incomeReceived: Math.round(totals.incomeReceived * 100) / 100,
          unrealizedResult,
          profitabilityPercent,
          // The portfolio total is only as trustworthy as its least quoted line.
          quoted: lines.every((line) => line.quoted),
        },
        distributionByType: distribution,
      },
    };
  }

  /**
   * GET /api/v1/investments/:investmentId
   */
  async get(
    companyId: string,
    investmentId: string,
    query: unknown,
  ): Promise<ControllerResult> {
    const investment = await this.investmentRepository.findById(
      companyId,
      investmentId,
    );
    if (!investment) {
      return { statusCode: 404, body: { error: "Investment not found" } };
    }

    const validation = validateInvestmentListQuery(query);
    const referenceDate =
      (validation.success ? validation.data.referenceDate : undefined) ??
      new Date();

    const summary = await this.investmentRepository.positionSummary(
      companyId,
      investmentId,
      referenceDate,
    );
    const quote = await this.quoteRepository.findForDate(
      companyId,
      investmentId,
      referenceDate,
    );

    return {
      statusCode: 200,
      body: {
        ...(investment.toJSON() as Record<string, unknown>),
        ...this.serializePosition(summary, investment.currency, quote?.unitPrice),
        referenceDate,
      },
    };
  }

  /**
   * PUT /api/v1/investments/:investmentId
   */
  async update(
    companyId: string,
    investmentId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateUpdateInvestmentRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const investment = await this.investmentRepository.findById(
      companyId,
      investmentId,
    );
    if (!investment) {
      return { statusCode: 404, body: { error: "Investment not found" } };
    }

    const input = validation.data;

    const expenseCategory = input.expenseCategoryId
      ? await this.categoryRepository.findById(
          companyId,
          input.expenseCategoryId,
        )
      : null;
    if (input.expenseCategoryId && !expenseCategory) {
      return { statusCode: 404, body: { error: "Expense category not found" } };
    }

    const incomeCategory = input.incomeCategoryId
      ? await this.categoryRepository.findById(companyId, input.incomeCategoryId)
      : null;
    if (input.incomeCategoryId && !incomeCategory) {
      return { statusCode: 404, body: { error: "Income category not found" } };
    }

    const result = investment.edit({
      name: input.name,
      symbol: input.symbol,
      expenseCategory: expenseCategory
        ? {
            id: expenseCategory.id,
            companyId: expenseCategory.companyId,
            type: expenseCategory.type,
          }
        : undefined,
      incomeCategory: incomeCategory
        ? {
            id: incomeCategory.id,
            companyId: incomeCategory.companyId,
            type: incomeCategory.type,
          }
        : undefined,
    });

    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.investmentRepository.update(investment);

    return { statusCode: 200, body: investment.toJSON() };
  }

  /**
   * POST /api/v1/investments/:investmentId/close
   */
  async close(
    companyId: string,
    investmentId: string,
  ): Promise<ControllerResult> {
    const investment = await this.investmentRepository.findById(
      companyId,
      investmentId,
    );
    if (!investment) {
      return { statusCode: 404, body: { error: "Investment not found" } };
    }

    const summary = await this.investmentRepository.positionSummary(
      companyId,
      investmentId,
      new Date(),
    );

    const result = investment.close(summary.quantity);
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.investmentRepository.update(investment);
    this.publish(investment.events);
    investment.clearEvents();

    return { statusCode: 200, body: investment.toJSON() };
  }

  /**
   * POST /api/v1/investments/:investmentId/operations
   *
   * The operation, its confirmed transaction and the account movement are
   * written in one database transaction, with the investment row locked so the
   * position the validation read cannot move underneath it (design, decision 4).
   */
  async registerOperation(
    companyId: string,
    investmentId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateInvestmentOperationRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const input = validation.data;

    const existing = await this.investmentRepository.findById(
      companyId,
      investmentId,
    );
    if (!existing) {
      return { statusCode: 404, body: { error: "Investment not found" } };
    }

    const account = await this.accountRepository.findById(
      companyId,
      existing.accountId,
    );
    if (!account) {
      return { statusCode: 404, body: { error: "Account not found" } };
    }

    if (input.categoryId) {
      const category = await this.categoryRepository.findById(
        companyId,
        input.categoryId,
      );
      if (!category) {
        return { statusCode: 404, body: { error: "Category not found" } };
      }
      const expected =
        input.operationType === "BUY" ? "EXPENSE" : "INCOME";
      if (category.type !== expected) {
        return {
          statusCode: 422,
          body: { error: `Category must be of type ${expected}` },
        };
      }
    }

    const outcome = await this.transactionRepository.runAtomic(
      async (executor) => {
        const investment = await this.investmentRepository.findByIdForUpdate(
          companyId,
          investmentId,
          executor,
        );
        if (!investment) {
          throw DomainError.create(
            "ENTITY_NOT_FOUND",
            "Investment not found",
          );
        }

        const operations = await this.investmentRepository.listOperations(
          companyId,
          investmentId,
          {},
          executor,
        );

        const result = this.operationService.register({
          investment,
          operations,
          account,
          input,
        });

        if (result.isFailure || !result.value) {
          throw this.orGeneric(result.error);
        }

        const { operation, payment, position, events } = result.value;

        // The two tables reference each other, so the write goes in three
        // steps: the operation without its link, the transaction (whose foreign
        // key now resolves), then the link back. All inside one database
        // transaction, so no intermediate state is ever observable.
        await this.investmentRepository.createOperation(operation, executor);
        await this.transactionRepository.create(payment, executor);
        await this.investmentRepository.linkOperationTransaction(
          companyId,
          operation.id,
          payment.id,
          executor,
        );
        await this.accountRepository.applyMovement(
          companyId,
          {
            transactionId: payment.id,
            accountId: account.id,
            direction: operation.direction,
            amount: operation.amount,
          },
          executor,
        );

        return { operation, payment, position, events };
      },
    );

    this.publish(outcome.events);
    outcome.payment.clearEvents();

    return {
      statusCode: 201,
      body: {
        operation: outcome.operation.toJSON(),
        transaction: outcome.payment.toJSON(),
        position: {
          quantity: outcome.position.quantity,
          averageCost: outcome.position.averageCost,
          investedAmount: outcome.position.investedAmount.amount,
          realizedResult: outcome.position.realizedResult.amount,
          incomeReceived: outcome.position.incomeReceived.amount,
        },
      },
    };
  }

  /**
   * GET /api/v1/investments/:investmentId/operations
   */
  async listOperations(
    companyId: string,
    investmentId: string,
  ): Promise<ControllerResult> {
    const investment = await this.investmentRepository.findById(
      companyId,
      investmentId,
    );
    if (!investment) {
      return { statusCode: 404, body: { error: "Investment not found" } };
    }

    const operations = await this.investmentRepository.listOperations(
      companyId,
      investmentId,
    );

    return {
      statusCode: 200,
      body: {
        operations: operations.map((operation) => operation.toJSON()),
        total: operations.length,
      },
    };
  }

  /**
   * POST /api/v1/investments/:investmentId/quotes
   */
  async registerQuote(
    companyId: string,
    investmentId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateInvestmentQuoteRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const investment = await this.investmentRepository.findById(
      companyId,
      investmentId,
    );
    if (!investment) {
      return { statusCode: 404, body: { error: "Investment not found" } };
    }

    const input = validation.data;

    const quote = await this.quoteRepository.upsert(companyId, {
      id: randomUUID(),
      investmentId,
      quoteDate: input.quoteDate,
      unitPrice: input.unitPrice,
      source: input.source ?? "MANUAL",
    });

    return { statusCode: 201, body: quote };
  }

  /**
   * GET /api/v1/investments/:investmentId/quotes
   */
  async listQuotes(
    companyId: string,
    investmentId: string,
  ): Promise<ControllerResult> {
    const investment = await this.investmentRepository.findById(
      companyId,
      investmentId,
    );
    if (!investment) {
      return { statusCode: 404, body: { error: "Investment not found" } };
    }

    const { items, total } = await this.quoteRepository.findByInvestment(
      companyId,
      investmentId,
    );

    return { statusCode: 200, body: { quotes: items, total } };
  }

  /**
   * The derived figures of a position, priced with the quote of the date when
   * there is one and flagged when there is not.
   */
  private serializePosition(
    summary: InvestmentPositionSummary,
    currency: string,
    unitPrice: number | undefined,
  ): SerializedPosition {
    const valuation = valuePosition(
      {
        quantity: summary.quantity,
        averageCost:
          summary.quantity > 0 ? summary.investedAmount / summary.quantity : 0,
        investedAmount: Money.create(summary.investedAmount, currency),
        realizedResult: Money.create(summary.realizedResult, currency),
        incomeReceived: Money.create(summary.incomeReceived, currency),
      },
      unitPrice,
    );

    return {
      quantity: valuation.quantity,
      averageCost: valuation.averageCost,
      investedAmount: valuation.investedAmount.amount,
      currentValue: valuation.currentValue.amount,
      unrealizedResult: valuation.unrealizedResult.amount,
      realizedResult: valuation.realizedResult.amount,
      incomeReceived: valuation.incomeReceived.amount,
      profitabilityPercent: valuation.profitabilityPercent,
      quoted: valuation.quoted,
      unitPrice,
    };
  }

  private serializeEntry(entry: PortfolioEntry): SerializedInvestment {
    return {
      id: entry.investmentId,
      name: entry.name,
      investmentType: entry.investmentType,
      symbol: entry.symbol,
      currency: entry.currency,
      status: entry.status,
      ...this.serializePosition(entry, entry.currency, entry.unitPrice),
    };
  }

  private publish(events: readonly DomainEvent<string>[]): void {
    for (const event of events) {
      this.eventBus.publish(event);
    }
  }

  private orGeneric(error: DomainError | undefined): DomainError {
    return (
      error ??
      DomainError.create("BUSINESS_RULE_VIOLATION", "Operation not allowed")
    );
  }
}
