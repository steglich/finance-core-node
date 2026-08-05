import type { PersonRepository } from "../../cadastros/infrastructure/person-repository.js";
import type { AccountRepository } from "../../financeiro/infrastructure/account-repository.js";
import type { CategoryRepository } from "../../financeiro/infrastructure/category-repository.js";
import type { TransactionRepository } from "../../financeiro/infrastructure/transaction-repository.js";
import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEvent } from "../../shared/domain/domain-event.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import type { PayableSettlementService } from "../domain/payable-settlement-service.js";
import { Payable } from "../domain/payable.js";
import type { PayableRepository } from "../infrastructure/payable-repository.js";
import {
  validateCancelRequest,
  validateListPayablesQuery,
  validatePayablePaymentRequest,
  validateRegisterPayableRequest,
  validateUpdatePayableRequest,
} from "./dtos.js";

/**
 * Payable endpoints. The company scope always comes from the token.
 */
export class PayableController {
  constructor(
    private readonly payableRepository: PayableRepository,
    private readonly personRepository: PersonRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly accountRepository: AccountRepository,
    private readonly transactionRepository: TransactionRepository,
    private readonly settlementService: PayableSettlementService,
    private readonly eventBus: DomainEventBus,
    private readonly defaultCurrency = "BRL",
  ) {}

  /**
   * POST /api/v1/payables
   */
  async register(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateRegisterPayableRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const input = validation.data;

    const supplier = await this.personRepository.findById(
      companyId,
      input.personId,
    );
    if (!supplier) {
      return { statusCode: 404, body: { error: "Supplier not found" } };
    }

    const category = await this.categoryRepository.findById(
      companyId,
      input.categoryId,
    );
    if (!category) {
      return { statusCode: 404, body: { error: "Category not found" } };
    }

    const result = Payable.register({
      companyId,
      supplier,
      category,
      costCenterId: input.costCenterId,
      amount: input.amount,
      currency: this.defaultCurrency,
      dueDate: input.dueDate,
      competenceDate: input.competenceDate,
      description: input.description,
      documentNumber: input.documentNumber,
    });

    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    const payable = result.value;
    await this.payableRepository.create(payable);
    this.publish(payable.events);
    payable.clearEvents();

    return { statusCode: 201, body: payable.toJSON() };
  }

  /**
   * GET /api/v1/payables
   */
  async list(companyId: string, query: unknown): Promise<ControllerResult> {
    const validation = validateListPayablesQuery(query);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const { items, total } = await this.payableRepository.findByCompany(
      companyId,
      validation.data,
    );

    return {
      statusCode: 200,
      body: { payables: items.map((payable) => payable.toJSON()), total },
    };
  }

  /**
   * GET /api/v1/payables/:payableId
   */
  async get(companyId: string, payableId: string): Promise<ControllerResult> {
    const payable = await this.payableRepository.findById(companyId, payableId);
    if (!payable) {
      return { statusCode: 404, body: { error: "Payable not found" } };
    }

    const payments = await this.payableRepository.listPayments(
      companyId,
      payableId,
    );

    return {
      statusCode: 200,
      body: { ...(payable.toJSON() as Record<string, unknown>), payments },
    };
  }

  /**
   * PUT /api/v1/payables/:payableId
   */
  async update(
    companyId: string,
    payableId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateUpdatePayableRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const payable = await this.payableRepository.findById(companyId, payableId);
    if (!payable) {
      return { statusCode: 404, body: { error: "Payable not found" } };
    }

    // A payable may only be moved to an expense category of the same company —
    // the same rule its registration enforces.
    if (validation.data.categoryId !== undefined) {
      const category = await this.categoryRepository.findById(
        companyId,
        validation.data.categoryId,
      );
      if (!category) {
        return { statusCode: 404, body: { error: "Category not found" } };
      }
      if (category.type !== "EXPENSE") {
        return {
          statusCode: 400,
          body: { error: "A payable requires an expense category" },
        };
      }
    }

    const result = payable.edit(validation.data);
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.payableRepository.update(payable);
    this.publish(payable.events);
    payable.clearEvents();

    return { statusCode: 200, body: payable.toJSON() };
  }

  /**
   * POST /api/v1/payables/:payableId/payments
   *
   * The expense transaction, the account debit, the payable transition and the
   * payment record are written in a single database transaction, with the same
   * status-guarded update that stops a double settlement.
   */
  async pay(
    companyId: string,
    payableId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validatePayablePaymentRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const input = validation.data;

    const payable = await this.payableRepository.findById(companyId, payableId);
    if (!payable) {
      return { statusCode: 404, body: { error: "Payable not found" } };
    }

    const account = await this.accountRepository.findById(
      companyId,
      input.accountId,
    );
    if (!account) {
      return { statusCode: 404, body: { error: "Account not found" } };
    }

    const result = this.settlementService.settle({
      payable,
      account,
      amount: input.amount,
      paidAt: input.paidAt,
      description: input.description,
    });

    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    const { payment, paymentId, amount, paidAt, events } = result.value;

    await this.transactionRepository.runAtomic(async (executor) => {
      await this.transactionRepository.create(payment, executor);
      await this.accountRepository.applyMovement(
        companyId,
        {
          transactionId: payment.id,
          accountId: account.id,
          direction: "DEBIT",
          amount,
        },
        executor,
      );
      await this.payableRepository.update(payable, executor);
      await this.payableRepository.registerPayment(
        {
          id: paymentId,
          payableId: payable.id,
          transactionId: payment.id,
          accountId: account.id,
          amount: amount.toDecimalString(),
          paidAt,
        },
        executor,
      );
    });

    this.publish(events);
    payment.clearEvents();
    payable.clearEvents();

    return {
      statusCode: 200,
      body: {
        ...(payable.toJSON() as Record<string, unknown>),
        payment: payment.toJSON(),
      },
    };
  }

  /**
   * POST /api/v1/payables/:payableId/cancel
   */
  async cancel(
    companyId: string,
    payableId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateCancelRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const payable = await this.payableRepository.findById(companyId, payableId);
    if (!payable) {
      return { statusCode: 404, body: { error: "Payable not found" } };
    }

    const result = payable.cancel(validation.data.reason);
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.payableRepository.update(payable);
    this.publish(payable.events);
    payable.clearEvents();

    return { statusCode: 200, body: payable.toJSON() };
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
