import { randomUUID } from "node:crypto";
import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import type { Account } from "../domain/account.js";
import { ExchangeRate } from "../domain/exchange-rate.js";
import { Installment } from "../domain/installment.js";
import { Transaction } from "../domain/transaction.js";
import type { AccountRepository } from "../infrastructure/account-repository.js";
import type { CategoryRepository } from "../infrastructure/category-repository.js";
import type { InstallmentRepository } from "../infrastructure/installment-repository.js";
import type { TransactionRepository } from "../infrastructure/transaction-repository.js";
import {
  validateAttachmentRequest,
  validateCreateTransactionRequest,
  validateStateChangeRequest,
  validateTransactionQuery,
  validateUpdateTransactionRequest,
} from "./dtos.js";

/**
 * Transaction endpoints, including the parceled purchase flow and the state
 * transitions that move the account balance.
 */
export class TransactionController {
  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly accountRepository: AccountRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly installmentRepository: InstallmentRepository,
    private readonly eventBus: DomainEventBus,
  ) {}

  /**
   * POST /api/v1/transactions — simple or parceled.
   */
  async create(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateCreateTransactionRequest(body);
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
    if (!account.isActive) {
      return {
        statusCode: 400,
        body: { error: "Inactive accounts do not accept new transactions" },
      };
    }

    if (input.categoryId) {
      const category = await this.categoryRepository.findById(
        companyId,
        input.categoryId,
      );
      if (!category) {
        return { statusCode: 404, body: { error: "Category not found" } };
      }
    }

    const result = Transaction.create({
      companyId,
      accountId: input.accountId,
      categoryId: input.categoryId,
      type: input.type,
      grossAmount: input.grossAmount,
      discount: input.discount,
      interest: input.interest,
      penalty: input.penalty,
      currency: input.currency ?? account.currency,
      accountCurrency: account.currency,
      exchangeRate: this.toExchangeRate(input.exchangeRate),
      date: input.date,
      competence: input.competence,
      description: input.description,
      tags: input.tags,
    });

    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    const transaction = result.value;
    const installmentCount = input.installments ?? 1;

    if (installmentCount <= 1) {
      await this.transactionRepository.create(transaction);
      this.publish(transaction);

      return { statusCode: 201, body: transaction.toJSON() };
    }

    // Installments inherit the category and the account of the parent purchase.
    const installments = Installment.generate({
      companyId,
      parentTransactionId: transaction.id,
      accountId: transaction.accountId,
      categoryId: transaction.categoryId,
      total: transaction.netAmount,
      count: installmentCount,
      purchaseDate: transaction.date,
    });

    if (installments.isFailure || !installments.value) {
      throw this.orGeneric(installments.error);
    }

    // Parent and installments are written together or not at all.
    await this.transactionRepository.runAtomic(async (executor) => {
      await this.transactionRepository.create(transaction, executor);
      await this.installmentRepository.createMany(
        installments.value ?? [],
        executor,
      );
    });
    this.publish(transaction);

    return {
      statusCode: 201,
      body: {
        ...(transaction.toJSON() as Record<string, unknown>),
        installments: installments.value.map((item) => item.toJSON()),
      },
    };
  }

  /**
   * GET /api/v1/transactions
   */
  async list(companyId: string, query: unknown): Promise<ControllerResult> {
    const validation = validateTransactionQuery(query);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const { items, total } = await this.transactionRepository.findMany(
      companyId,
      validation.data,
    );

    return {
      statusCode: 200,
      body: {
        transactions: items.map((transaction) => transaction.toJSON()),
        total,
      },
    };
  }

  /**
   * GET /api/v1/transactions/:transactionId
   */
  async detail(
    companyId: string,
    transactionId: string,
  ): Promise<ControllerResult> {
    const transaction = await this.transactionRepository.findById(
      companyId,
      transactionId,
    );
    if (!transaction) {
      return { statusCode: 404, body: { error: "Transaction not found" } };
    }

    const [installments, attachments] = await Promise.all([
      this.installmentRepository.findByParentTransactionId(
        companyId,
        transactionId,
      ),
      this.transactionRepository.listAttachments(companyId, transactionId),
    ]);

    return {
      statusCode: 200,
      body: {
        ...(transaction.toJSON() as Record<string, unknown>),
        installments: installments.map((installment) => installment.toJSON()),
        attachments,
      },
    };
  }

  /**
   * PUT /api/v1/transactions/:transactionId — pending transactions only.
   */
  async update(
    companyId: string,
    transactionId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateUpdateTransactionRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const transaction = await this.transactionRepository.findById(
      companyId,
      transactionId,
    );
    if (!transaction) {
      return { statusCode: 404, body: { error: "Transaction not found" } };
    }

    if (validation.data.categoryId) {
      const category = await this.categoryRepository.findById(
        companyId,
        validation.data.categoryId,
      );
      if (!category) {
        return { statusCode: 404, body: { error: "Category not found" } };
      }
    }

    const result = transaction.edit(validation.data);
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.transactionRepository.update(transaction);
    this.publish(transaction);

    return {
      statusCode: 200,
      body: {
        ...(transaction.toJSON() as Record<string, unknown>),
        changes: result.value ?? [],
      },
    };
  }

  /**
   * POST /api/v1/transactions/:transactionId/confirm — posts to the balance.
   */
  async confirm(
    companyId: string,
    transactionId: string,
  ): Promise<ControllerResult> {
    return this.changeState(companyId, transactionId, "confirm");
  }

  /**
   * POST /api/v1/transactions/:transactionId/cancel
   */
  async cancel(
    companyId: string,
    transactionId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateStateChangeRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    return this.changeState(
      companyId,
      transactionId,
      "cancel",
      validation.data.reason,
    );
  }

  /**
   * POST /api/v1/transactions/:transactionId/refund — reverts the balance.
   */
  async refund(
    companyId: string,
    transactionId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateStateChangeRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    return this.changeState(
      companyId,
      transactionId,
      "refund",
      validation.data.reason,
    );
  }

  /**
   * Runs a state transition and, when it moves money, applies the balance
   * change in the same database transaction as the status update.
   */
  private async changeState(
    companyId: string,
    transactionId: string,
    operation: "confirm" | "cancel" | "refund",
    reason?: string,
  ): Promise<ControllerResult> {
    const transaction = await this.transactionRepository.findById(
      companyId,
      transactionId,
    );
    if (!transaction) {
      return { statusCode: 404, body: { error: "Transaction not found" } };
    }

    const account = await this.accountRepository.findById(
      companyId,
      transaction.accountId,
    );
    if (!account) {
      return { statusCode: 404, body: { error: "Account not found" } };
    }

    const result =
      operation === "confirm"
        ? transaction.confirm()
        : operation === "cancel"
          ? transaction.cancel(reason)
          : transaction.refund(reason);

    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.transactionRepository.runAtomic(async (executor) => {
      await this.transactionRepository.update(transaction, executor);

      if (operation === "cancel") {
        return;
      }

      // Confirming applies the transaction direction; refunding applies the
      // opposite one, undoing the original movement.
      const direction = this.movementDirection(transaction, operation);

      await this.accountRepository.applyMovement(
        companyId,
        {
          transactionId: transaction.id,
          accountId: account.id,
          direction,
          amount: transaction.netAmount,
        },
        executor,
      );
    });

    this.publish(transaction);

    return { statusCode: 200, body: transaction.toJSON() };
  }

  private movementDirection(
    transaction: Transaction,
    operation: "confirm" | "refund",
  ): "CREDIT" | "DEBIT" {
    const natural = transaction.direction;
    if (operation === "confirm") {
      return natural;
    }
    return natural === "CREDIT" ? "DEBIT" : "CREDIT";
  }

  /**
   * POST /api/v1/transactions/:transactionId/attachments
   *
   * The API stores attachment metadata plus the location of the file; binary
   * upload needs a storage backend and a multipart parser, neither of which is
   * part of this phase.
   */
  async addAttachment(
    companyId: string,
    transactionId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateAttachmentRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const transaction = await this.transactionRepository.findById(
      companyId,
      transactionId,
    );
    if (!transaction) {
      return { statusCode: 404, body: { error: "Transaction not found" } };
    }

    const attachment = await this.transactionRepository.addAttachment(
      companyId,
      { id: randomUUID(), transactionId, ...validation.data },
    );

    return { statusCode: 201, body: attachment };
  }

  /**
   * GET /api/v1/transactions/:transactionId/attachments/:attachmentId
   */
  async getAttachment(
    companyId: string,
    transactionId: string,
    attachmentId: string,
  ): Promise<ControllerResult> {
    const attachment = await this.transactionRepository.findAttachment(
      companyId,
      transactionId,
      attachmentId,
    );

    if (!attachment) {
      return { statusCode: 404, body: { error: "Attachment not found" } };
    }

    return { statusCode: 200, body: attachment };
  }

  private toExchangeRate(
    raw:
      | {
          sourceCurrency: string;
          targetCurrency: string;
          rate: number;
          date: Date;
        }
      | undefined,
  ): ExchangeRate | undefined {
    return raw
      ? new ExchangeRate(
          raw.sourceCurrency,
          raw.targetCurrency,
          raw.rate,
          raw.date,
        )
      : undefined;
  }

  /**
   * Publishes and clears the events accumulated by the aggregate.
   */
  private publish(aggregate: Transaction | Account): void {
    for (const event of aggregate.events) {
      this.eventBus.publish(event);
    }
    aggregate.clearEvents();
  }

  private orGeneric(error: DomainError | undefined): DomainError {
    return (
      error ??
      DomainError.create("BUSINESS_RULE_VIOLATION", "Operation not allowed")
    );
  }
}
