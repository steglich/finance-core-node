import { randomUUID } from "node:crypto";
import type { Account } from "../../financeiro/domain/account.js";
import { Transaction } from "../../financeiro/domain/transaction.js";
import type { PersonRepository } from "../../cadastros/infrastructure/person-repository.js";
import type { AccountRepository } from "../../financeiro/infrastructure/account-repository.js";
import type { TransactionRepository } from "../../financeiro/infrastructure/transaction-repository.js";
import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEvent } from "../../shared/domain/domain-event.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import { PixKey } from "../../shared/domain/pix-key.js";
import type { ChargeReceiptService } from "../domain/charge-receipt-service.js";
import type { ChargeRepository } from "../infrastructure/charge-repository.js";
import type { PixRepository } from "../infrastructure/pix-repository.js";
import { validateReceivePixRequest, validateSendPixRequest } from "./dtos.js";
import type { ReceivePixRequest } from "./dtos.js";

/**
 * PIX endpoints.
 *
 * A PIX movement is a transaction plus a record of how the money moved; the
 * record lives in its own table so `transactions` stays free of payment-method
 * columns.
 */
export class PixController {
  constructor(
    private readonly pixRepository: PixRepository,
    private readonly chargeRepository: ChargeRepository,
    private readonly personRepository: PersonRepository,
    private readonly accountRepository: AccountRepository,
    private readonly transactionRepository: TransactionRepository,
    private readonly receiptService: ChargeReceiptService,
    private readonly eventBus: DomainEventBus,
  ) {}

  /**
   * POST /api/v1/pix/send
   */
  async send(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateSendPixRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const input = validation.data;

    // A selected bank detail supplies the key. Looked up inside the company
    // scope, so one belonging to another company simply is not found.
    let rawKey = input.pixKey;
    let personId = input.personId;

    if (input.bankAccountId) {
      const bankAccount = await this.personRepository.findBankAccountById(
        companyId,
        input.bankAccountId,
      );
      if (!bankAccount) {
        return { statusCode: 404, body: { error: "Bank account not found" } };
      }
      if (!bankAccount.pixKey) {
        return {
          statusCode: 400,
          body: { error: "The selected bank account has no PIX key" },
        };
      }
      rawKey = bankAccount.pixKey;
      personId = bankAccount.personId;
    }

    let pixKey: PixKey;
    try {
      pixKey = PixKey.create(rawKey!);
    } catch (error) {
      if (error instanceof DomainError) {
        return { statusCode: 400, body: { error: error.message } };
      }
      throw error;
    }

    const account = await this.accountRepository.findById(
      companyId,
      input.accountId,
    );
    if (!account) {
      return { statusCode: 404, body: { error: "Account not found" } };
    }

    if (!account.isActive) {
      throw DomainError.create(
        "INVALID_OPERATION",
        "Inactive accounts do not accept new transactions",
      );
    }

    const transaction = Transaction.create({
      companyId,
      accountId: account.id,
      categoryId: input.categoryId,
      costCenterId: input.costCenterId,
      personId,
      type: "EXPENSE",
      grossAmount: input.amount,
      currency: account.currency,
      accountCurrency: account.currency,
      date: input.occurredAt,
      description: input.description ?? `PIX enviado para ${pixKey.value}`,
    });

    if (transaction.isFailure || !transaction.value) {
      throw this.orGeneric(transaction.error);
    }

    const payment = transaction.value;
    const amount = payment.netAmount;

    if (account.availableBalance.lessThan(amount)) {
      throw DomainError.create(
        "BUSINESS_RULE_VIOLATION",
        "Saldo insuficiente na conta de origem",
      );
    }

    const confirmed = payment.confirm();
    if (confirmed.isFailure) {
      throw this.orGeneric(confirmed.error);
    }

    const recordId = randomUUID();

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
      await this.pixRepository.create(
        {
          id: recordId,
          companyId,
          transactionId: payment.id,
          direction: "SENT",
          pixKey: pixKey.value,
          personId,
          bankAccountId: input.bankAccountId,
          occurredAt: input.occurredAt,
        },
        executor,
      );
    });

    this.publish(payment.events);
    payment.clearEvents();

    return {
      statusCode: 201,
      body: {
        id: recordId,
        direction: "SENT",
        pixKey: pixKey.value,
        pixKeyType: pixKey.type,
        occurredAt: input.occurredAt,
        transaction: payment.toJSON(),
      },
    };
  }

  /**
   * POST /api/v1/pix/receive
   *
   * When the receipt names a charge, the settlement is delegated to
   * `ChargeReceiptService`, so the money produces exactly one income
   * transaction instead of one for the PIX and another for the charge.
   */
  async receive(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateReceivePixRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const input = validation.data;

    let pixKey: PixKey;
    try {
      pixKey = PixKey.create(input.pixKey);
    } catch (error) {
      if (error instanceof DomainError) {
        return { statusCode: 400, body: { error: error.message } };
      }
      throw error;
    }

    const account = await this.accountRepository.findById(
      companyId,
      input.accountId,
    );
    if (!account) {
      return { statusCode: 404, body: { error: "Account not found" } };
    }

    return input.chargeId
      ? this.receiveForCharge(companyId, input, pixKey, account, input.chargeId)
      : this.receiveStandalone(companyId, input, pixKey, account);
  }

  /**
   * A PIX that settles a charge: one transaction, produced by the receipt
   * service, with the PIX record pointing at both it and the charge.
   */
  private async receiveForCharge(
    companyId: string,
    input: ReceivePixRequest,
    pixKey: PixKey,
    account: Account,
    chargeId: string,
  ): Promise<ControllerResult> {
    const charge = await this.chargeRepository.findById(companyId, chargeId);
    if (!charge) {
      return { statusCode: 404, body: { error: "Charge not found" } };
    }

    const result = this.receiptService.receive({
      charge,
      account,
      amount: input.amount,
      receivedAt: input.occurredAt,
      categoryId: input.categoryId,
      costCenterId: input.costCenterId,
      description: input.description ?? `PIX recebido de ${pixKey.value}`,
    });

    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    const { payment, receiptId, amount, penalty, interest, receivedAt, events } =
      result.value;
    const recordId = randomUUID();

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
      await this.pixRepository.create(
        {
          id: recordId,
          companyId,
          transactionId: payment.id,
          direction: "RECEIVED",
          pixKey: pixKey.value,
          personId: charge.personId,
          chargeId: charge.id,
          occurredAt: receivedAt,
        },
        executor,
      );
    });

    this.publish(events);
    payment.clearEvents();
    charge.clearEvents();

    return {
      statusCode: 201,
      body: {
        id: recordId,
        direction: "RECEIVED",
        pixKey: pixKey.value,
        pixKeyType: pixKey.type,
        occurredAt: receivedAt,
        charge: charge.toJSON(),
        transaction: payment.toJSON(),
      },
    };
  }

  /**
   * A PIX with no charge behind it: plain income.
   */
  private async receiveStandalone(
    companyId: string,
    input: ReceivePixRequest,
    pixKey: PixKey,
    account: Account,
  ): Promise<ControllerResult> {
    if (!account.isActive) {
      throw DomainError.create(
        "INVALID_OPERATION",
        "Inactive accounts do not accept new transactions",
      );
    }

    const transaction = Transaction.create({
      companyId,
      accountId: account.id,
      categoryId: input.categoryId,
      costCenterId: input.costCenterId,
      personId: input.personId,
      type: "INCOME",
      grossAmount: input.amount,
      currency: account.currency,
      accountCurrency: account.currency,
      date: input.occurredAt,
      description: input.description ?? `PIX recebido de ${pixKey.value}`,
    });

    if (transaction.isFailure || !transaction.value) {
      throw this.orGeneric(transaction.error);
    }

    const payment = transaction.value;
    const confirmed = payment.confirm();
    if (confirmed.isFailure) {
      throw this.orGeneric(confirmed.error);
    }

    const recordId = randomUUID();

    await this.transactionRepository.runAtomic(async (executor) => {
      await this.transactionRepository.create(payment, executor);
      await this.accountRepository.applyMovement(
        companyId,
        {
          transactionId: payment.id,
          accountId: account.id,
          direction: "CREDIT",
          amount: payment.netAmount,
        },
        executor,
      );
      await this.pixRepository.create(
        {
          id: recordId,
          companyId,
          transactionId: payment.id,
          direction: "RECEIVED",
          pixKey: pixKey.value,
          personId: input.personId,
          occurredAt: input.occurredAt,
        },
        executor,
      );
    });

    this.publish(payment.events);
    payment.clearEvents();

    return {
      statusCode: 201,
      body: {
        id: recordId,
        direction: "RECEIVED",
        pixKey: pixKey.value,
        pixKeyType: pixKey.type,
        occurredAt: input.occurredAt,
        transaction: payment.toJSON(),
      },
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
