import type { PersonRepository } from "../../cadastros/infrastructure/person-repository.js";
import type { AccountRepository } from "../../financeiro/infrastructure/account-repository.js";
import type { TransactionRepository } from "../../financeiro/infrastructure/transaction-repository.js";
import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEvent } from "../../shared/domain/domain-event.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import { ChargeReceiptService } from "../domain/charge-receipt-service.js";
import { Charge } from "../domain/charge.js";
import type { ChargeRepository } from "../infrastructure/charge-repository.js";
import {
  validateCancelRequest,
  validateChargeReceiptRequest,
  validateIssueChargeRequest,
  validateListChargesQuery,
  validateUpdateChargeRequest,
} from "./dtos.js";

/**
 * Charge endpoints. The company scope always comes from the token.
 */
export class ChargeController {
  constructor(
    private readonly chargeRepository: ChargeRepository,
    private readonly personRepository: PersonRepository,
    private readonly accountRepository: AccountRepository,
    private readonly transactionRepository: TransactionRepository,
    private readonly receiptService: ChargeReceiptService,
    private readonly eventBus: DomainEventBus,
    private readonly defaultCurrency = "BRL",
  ) {}

  /**
   * POST /api/v1/charges
   */
  async issue(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateIssueChargeRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const input = validation.data;

    const customer = await this.personRepository.findById(
      companyId,
      input.personId,
    );
    if (!customer) {
      return { statusCode: 404, body: { error: "Customer not found" } };
    }

    const result = Charge.issue({
      companyId,
      customer,
      amount: input.amount,
      currency: this.defaultCurrency,
      dueDate: input.dueDate,
      issueDate: input.issueDate,
      description: input.description,
      penaltyPercent: input.penaltyPercent,
      monthlyInterestPercent: input.monthlyInterestPercent,
    });

    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    const charge = result.value;
    await this.chargeRepository.create(charge);
    this.publish(charge.events);
    charge.clearEvents();

    return { statusCode: 201, body: charge.toJSON() };
  }

  /**
   * GET /api/v1/charges
   */
  async list(companyId: string, query: unknown): Promise<ControllerResult> {
    const validation = validateListChargesQuery(query);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const { items, total } = await this.chargeRepository.findByCompany(
      companyId,
      validation.data,
    );

    const referenceDate = new Date();

    return {
      statusCode: 200,
      body: {
        charges: items.map((charge) => this.serialize(charge, referenceDate)),
        total,
      },
    };
  }

  /**
   * GET /api/v1/charges/:chargeId
   */
  async get(companyId: string, chargeId: string): Promise<ControllerResult> {
    const charge = await this.chargeRepository.findById(companyId, chargeId);
    if (!charge) {
      return { statusCode: 404, body: { error: "Charge not found" } };
    }

    const receipts = await this.chargeRepository.listReceipts(
      companyId,
      chargeId,
    );

    return {
      statusCode: 200,
      body: { ...this.serialize(charge, new Date()), receipts },
    };
  }

  /**
   * PUT /api/v1/charges/:chargeId
   */
  async update(
    companyId: string,
    chargeId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateUpdateChargeRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const charge = await this.chargeRepository.findById(companyId, chargeId);
    if (!charge) {
      return { statusCode: 404, body: { error: "Charge not found" } };
    }

    const result = charge.edit(validation.data);
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.chargeRepository.update(charge);
    this.publish(charge.events);
    charge.clearEvents();

    return { statusCode: 200, body: this.serialize(charge, new Date()) };
  }

  /**
   * POST /api/v1/charges/:chargeId/receipts
   *
   * The income transaction, the account credit, the charge transition and the
   * receipt record are written in a single database transaction. The charge
   * update is guarded by status, so a concurrent second receipt matches zero
   * rows, throws, and takes its own income transaction down with it.
   */
  async receive(
    companyId: string,
    chargeId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateChargeReceiptRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const input = validation.data;

    const charge = await this.chargeRepository.findById(companyId, chargeId);
    if (!charge) {
      return { statusCode: 404, body: { error: "Charge not found" } };
    }

    const account = await this.accountRepository.findById(
      companyId,
      input.accountId,
    );
    if (!account) {
      return { statusCode: 404, body: { error: "Account not found" } };
    }

    const result = this.receiptService.receive({
      charge,
      account,
      amount: input.amount,
      receivedAt: input.receivedAt,
      categoryId: input.categoryId,
      costCenterId: input.costCenterId,
      description: input.description,
    });

    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    const { payment, receiptId, amount, penalty, interest, receivedAt, events } =
      result.value;

    await this.transactionRepository.runAtomic(async (executor) => {
      await this.transactionRepository.create(payment, executor);
      await this.accountRepository.applyMovement(
        companyId,
        {
          transactionId: payment.id,
          accountId: account.id,
          direction: "CREDIT",
          amount,
        },
        executor,
      );
      await this.chargeRepository.update(charge, executor);
      await this.chargeRepository.registerReceipt(
        {
          id: receiptId,
          chargeId: charge.id,
          transactionId: payment.id,
          accountId: account.id,
          amount: amount.toDecimalString(),
          penaltyAmount: penalty.toDecimalString(),
          interestAmount: interest.toDecimalString(),
          receivedAt,
        },
        executor,
      );
    });

    this.publish(events);
    payment.clearEvents();
    charge.clearEvents();

    return {
      statusCode: 200,
      body: {
        ...this.serialize(charge, receivedAt),
        payment: payment.toJSON(),
      },
    };
  }

  /**
   * POST /api/v1/charges/:chargeId/cancel
   */
  async cancel(
    companyId: string,
    chargeId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateCancelRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const charge = await this.chargeRepository.findById(companyId, chargeId);
    if (!charge) {
      return { statusCode: 404, body: { error: "Charge not found" } };
    }

    const result = charge.cancel(validation.data.reason);
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.chargeRepository.update(charge);
    this.publish(charge.events);
    charge.clearEvents();

    return { statusCode: 200, body: this.serialize(charge, new Date()) };
  }

  /**
   * The charge plus the amounts it derives for a reference date — the penalty,
   * the interest and the total due are never read from storage.
   */
  private serialize(
    charge: Charge,
    referenceDate: Date,
  ): Record<string, unknown> {
    const due = charge.amountsDueAt(referenceDate);

    return {
      ...(charge.toJSON() as Record<string, unknown>),
      penalty: due.penalty.amount,
      interest: due.interest.amount,
      totalDue: due.totalDue.amount,
      daysLate: charge.isOpen ? charge.daysLateAt(referenceDate) : 0,
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
