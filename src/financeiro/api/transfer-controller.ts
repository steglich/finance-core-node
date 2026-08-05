import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import { ExchangeRate } from "../domain/exchange-rate.js";
import { TransferService } from "../domain/transfer-service.js";
import type { AccountRepository } from "../infrastructure/account-repository.js";
import type { TransactionRepository } from "../infrastructure/transaction-repository.js";
import { validateCreateTransferRequest } from "./dtos.js";

/**
 * Transfer endpoint. Both legs and both balance movements are written inside a
 * single database transaction (RN-04).
 */
export class TransferController {
  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly accountRepository: AccountRepository,
    private readonly transferService: TransferService,
    private readonly eventBus: DomainEventBus,
  ) {}

  /**
   * POST /api/v1/transfers
   */
  async create(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateCreateTransferRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const input = validation.data;

    const [source, target] = await Promise.all([
      this.accountRepository.findById(companyId, input.sourceAccountId),
      this.accountRepository.findById(companyId, input.targetAccountId),
    ]);

    if (!source) {
      return { statusCode: 404, body: { error: "Source account not found" } };
    }
    if (!target) {
      return { statusCode: 404, body: { error: "Target account not found" } };
    }

    const result = this.transferService.transfer({
      source,
      target,
      amount: input.amount,
      date: input.date,
      description: input.description,
      categoryId: input.categoryId,
      exchangeRate: input.exchangeRate
        ? new ExchangeRate(
            input.exchangeRate.sourceCurrency,
            input.exchangeRate.targetCurrency,
            input.exchangeRate.rate,
            input.exchangeRate.date,
          )
        : undefined,
    });

    if (result.isFailure || !result.value) {
      throw (
        result.error ??
        DomainError.create("BUSINESS_RULE_VIOLATION", "Transfer not allowed")
      );
    }

    const transfer = result.value;

    await this.transactionRepository.runAtomic(async (executor) => {
      await this.transactionRepository.create(transfer.debit, executor);
      await this.transactionRepository.create(transfer.credit, executor);

      await this.accountRepository.applyMovement(
        companyId,
        {
          transactionId: transfer.debit.id,
          accountId: source.id,
          direction: "DEBIT",
          amount: transfer.debitedAmount,
        },
        executor,
      );
      await this.accountRepository.applyMovement(
        companyId,
        {
          transactionId: transfer.credit.id,
          accountId: target.id,
          direction: "CREDIT",
          amount: transfer.creditedAmount,
        },
        executor,
      );

      await this.transactionRepository.recordTransfer(
        {
          transferId: transfer.transferId,
          companyId,
          sourceAccountId: source.id,
          targetAccountId: target.id,
          debitTransactionId: transfer.debit.id,
          creditTransactionId: transfer.credit.id,
          amount: transfer.debitedAmount.toDecimalString(),
          currency: transfer.debitedAmount.currency,
          creditedAmount: transfer.creditedAmount.toDecimalString(),
          targetCurrency: transfer.creditedAmount.currency,
          exchangeRate: input.exchangeRate,
        },
        executor,
      );
    });

    for (const event of [
      ...transfer.events,
      ...transfer.debit.events,
      ...transfer.credit.events,
      ...source.events,
      ...target.events,
    ]) {
      this.eventBus.publish(event);
    }
    transfer.debit.clearEvents();
    transfer.credit.clearEvents();
    source.clearEvents();
    target.clearEvents();

    return {
      statusCode: 201,
      body: {
        transferId: transfer.transferId,
        debit: transfer.debit.toJSON(),
        credit: transfer.credit.toJSON(),
        debitedAmount: transfer.debitedAmount.amount,
        creditedAmount: transfer.creditedAmount.amount,
      },
    };
  }
}
