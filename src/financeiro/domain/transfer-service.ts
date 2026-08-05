import { randomUUID } from "node:crypto";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEvent } from "../../shared/domain/domain-event.js";
import { Result } from "../../shared/domain/result.js";
import type { Account } from "./account.js";
import { ExchangeRate } from "./exchange-rate.js";
import { Money } from "./money.js";
import { Transaction } from "./transaction.js";
import { TransferCompleted, TransferReversed } from "./transfer-events.js";

/**
 * Input for transferring funds between two accounts of the same company.
 */
export interface TransferInput {
  transferId?: string;
  source: Account;
  target: Account;
  /** Amount in the source account currency. */
  amount: number;
  date: Date;
  description?: string | undefined;
  categoryId?: string | undefined;
  /** Required when the accounts have different currencies (RN-07). */
  exchangeRate?: ExchangeRate | undefined;
}

/**
 * Outcome of a transfer: the two legs plus the events to publish.
 */
export interface TransferResult {
  transferId: string;
  debit: Transaction;
  credit: Transaction;
  debitedAmount: Money;
  creditedAmount: Money;
  events: readonly DomainEvent<string>[];
}

/**
 * Input for reversing a completed transfer.
 */
export interface ReverseTransferInput {
  transferId: string;
  source: Account;
  target: Account;
  debit: Transaction;
  credit: Transaction;
  reason?: string | undefined;
}

/**
 * Domain service that orchestrates transfers between accounts.
 *
 * RN-04: the two legs are built and validated together and always carry the same
 * `transferId`; if any check fails, neither exists. The service never touches the
 * balances itself — the caller applies both movements inside a single database
 * transaction, which is the strongest atomicity guarantee available.
 */
export class TransferService {
  /**
   * Builds a transfer: validates both accounts and the source balance, then
   * returns the confirmed debit and credit legs for the caller to persist.
   */
  transfer(input: TransferInput): Result<TransferResult> {
    const { source, target } = input;

    if (source.id === target.id) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "Source and target accounts must be different",
        ),
      );
    }

    if (source.companyId !== target.companyId) {
      return Result.failed(
        DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "Transfers are only allowed between accounts of the same company",
        ),
      );
    }

    if (!source.isActive || !target.isActive) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "Transfers are only allowed between active accounts",
        ),
      );
    }

    let debitedAmount: Money;
    try {
      debitedAmount = Money.create(input.amount, source.currency);
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }

    if (!debitedAmount.isPositive()) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "Transfer amount must be greater than zero",
        ),
      );
    }

    if (source.availableBalance.lessThan(debitedAmount)) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "Saldo insuficiente na conta de origem",
        ),
      );
    }

    const conversion = this.resolveCreditedAmount(
      debitedAmount,
      target.currency,
      input.exchangeRate,
    );
    if (conversion.isFailure) {
      return Result.failed(
        conversion.error ??
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            "Could not convert the transfer amount",
          ),
      );
    }

    const creditedAmount = conversion.value as Money;
    const transferId = input.transferId ?? randomUUID();

    const debitResult = Transaction.create({
      companyId: source.companyId,
      accountId: source.id,
      categoryId: input.categoryId,
      type: "TRANSFER",
      grossAmount: debitedAmount.amount,
      currency: source.currency,
      accountCurrency: source.currency,
      exchangeRate: input.exchangeRate,
      date: input.date,
      description: input.description,
      transferId,
    });
    if (debitResult.isFailure) {
      return Result.failed(debitResult.error as DomainError);
    }

    const creditResult = Transaction.create({
      companyId: target.companyId,
      accountId: target.id,
      categoryId: input.categoryId,
      type: "TRANSFER",
      grossAmount: creditedAmount.amount,
      currency: target.currency,
      accountCurrency: target.currency,
      exchangeRate: input.exchangeRate,
      date: input.date,
      description: input.description,
      transferId,
    });
    if (creditResult.isFailure) {
      return Result.failed(creditResult.error as DomainError);
    }

    const debit = debitResult.value as Transaction;
    const credit = creditResult.value as Transaction;

    // Both legs are confirmed together: a failure here leaves neither posted.
    const debitConfirm = debit.confirm();
    if (debitConfirm.isFailure) {
      return Result.failed(debitConfirm.error as DomainError);
    }

    const creditConfirm = credit.confirm();
    if (creditConfirm.isFailure) {
      return Result.failed(creditConfirm.error as DomainError);
    }

    const completed = new TransferCompleted(
      transferId,
      source.companyId,
      source.id,
      target.id,
      debitedAmount,
      creditedAmount,
      debit.id,
      credit.id,
    );

    return Result.success({
      transferId,
      debit,
      credit,
      debitedAmount,
      creditedAmount,
      events: [completed],
    });
  }

  /**
   * Reverses a completed transfer: refunds both legs and undoes both movements.
   */
  reverse(input: ReverseTransferInput): Result<TransferResult> {
    const { debit, credit, source } = input;

    if (
      debit.transferId !== input.transferId ||
      credit.transferId !== input.transferId
    ) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "Both legs must belong to the transfer being reversed (RN-04)",
        ),
      );
    }

    const debitRefund = debit.refund(input.reason);
    if (debitRefund.isFailure) {
      return Result.failed(debitRefund.error as DomainError);
    }

    const creditRefund = credit.refund(input.reason);
    if (creditRefund.isFailure) {
      return Result.failed(creditRefund.error as DomainError);
    }

    const reversed = new TransferReversed(
      input.transferId,
      source.companyId,
      debit.id,
      credit.id,
      input.reason,
    );

    return Result.success({
      transferId: input.transferId,
      debit,
      credit,
      debitedAmount: debit.netAmount,
      creditedAmount: credit.netAmount,
      events: [reversed],
    });
  }

  /**
   * RN-07: crossing currencies requires a rate covering both, in either direction.
   */
  private resolveCreditedAmount(
    amount: Money,
    targetCurrency: string,
    rate: ExchangeRate | undefined,
  ): Result<Money> {
    if (amount.currency === targetCurrency) {
      return Result.success(amount);
    }

    if (!rate) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Cross-currency transfers require an exchange rate (RN-07)`,
        ),
      );
    }

    try {
      if (rate.supports(amount.currency, targetCurrency)) {
        return Result.success(rate.convert(amount));
      }
      if (rate.supports(targetCurrency, amount.currency)) {
        return Result.success(rate.invert().convert(amount));
      }
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }

    return Result.failed(
      DomainError.create(
        "BUSINESS_RULE_VIOLATION",
        `Exchange rate ${rate.sourceCurrency}/${rate.targetCurrency} does not cover ${amount.currency}/${targetCurrency} (RN-07)`,
      ),
    );
  }

}
