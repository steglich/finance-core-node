import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import type { Installment } from "../domain/installment.js";
import { Transaction } from "../domain/transaction.js";
import type { AccountRepository } from "../infrastructure/account-repository.js";
import type { InstallmentRepository } from "../infrastructure/installment-repository.js";
import type { TransactionRepository } from "../infrastructure/transaction-repository.js";
import {
  validateChangeDueDateRequest,
  validateInstallmentQuery,
  validatePayInstallmentRequest,
  validatePayInstallmentsBatchRequest,
} from "./dtos.js";

/**
 * Installment endpoints. Paying an installment creates its own payment
 * transaction, which may come from a different account than the purchase.
 */
export class InstallmentController {
  constructor(
    private readonly installmentRepository: InstallmentRepository,
    private readonly transactionRepository: TransactionRepository,
    private readonly accountRepository: AccountRepository,
    private readonly eventBus: DomainEventBus,
  ) {}

  /**
   * GET /api/v1/installments
   */
  async list(companyId: string, query: unknown): Promise<ControllerResult> {
    const validation = validateInstallmentQuery(query);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const { items, total } = await this.installmentRepository.findMany(
      companyId,
      validation.data,
    );

    return {
      statusCode: 200,
      body: {
        installments: items.map((installment) => installment.toJSON()),
        total,
      },
    };
  }

  /**
   * PUT /api/v1/installments/:installmentId/due-date
   */
  async changeDueDate(
    companyId: string,
    installmentId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateChangeDueDateRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const installment = await this.installmentRepository.findById(
      companyId,
      installmentId,
    );
    if (!installment) {
      return { statusCode: 404, body: { error: "Installment not found" } };
    }

    const result = installment.changeDueDate(validation.data.dueDate);
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.installmentRepository.update(installment);
    this.publish(installment);

    return { statusCode: 200, body: installment.toJSON() };
  }

  /**
   * POST /api/v1/installments/:installmentId/pay
   */
  async pay(
    companyId: string,
    installmentId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validatePayInstallmentRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const result = await this.payOne(
      companyId,
      installmentId,
      validation.data.paymentDate,
      validation.data.accountId,
    );

    if ("error" in result) {
      return { statusCode: result.statusCode, body: { error: result.error } };
    }

    return { statusCode: 200, body: result.body };
  }

  /**
   * POST /api/v1/installments/pay — batch payment.
   * Each installment is processed individually; one failure does not stop the
   * others, and the response reports the outcome per installment.
   */
  async payBatch(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validatePayInstallmentsBatchRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const results = [];

    for (const installmentId of validation.data.installmentIds) {
      const outcome = await this.payOne(
        companyId,
        installmentId,
        validation.data.paymentDate,
        validation.data.accountId,
      );

      results.push(
        "error" in outcome
          ? { installmentId, paid: false, error: outcome.error }
          : { installmentId, paid: true, installment: outcome.body },
      );
    }

    const paid = results.filter((result) => result.paid).length;

    return {
      statusCode: 200,
      body: { paid, failed: results.length - paid, results },
    };
  }

  /**
   * Settles one installment: creates the confirmed payment transaction, applies
   * it to the paying account and flips the installment to PAID — all atomically.
   */
  private async payOne(
    companyId: string,
    installmentId: string,
    paymentDate: Date,
    accountId: string | undefined,
  ): Promise<
    { body: unknown } | { statusCode: number; error: string }
  > {
    const installment = await this.installmentRepository.findById(
      companyId,
      installmentId,
    );
    if (!installment) {
      return { statusCode: 404, error: "Installment not found" };
    }

    const payingAccountId = accountId ?? installment.accountId;
    const account = await this.accountRepository.findById(
      companyId,
      payingAccountId,
    );
    if (!account) {
      return { statusCode: 404, error: "Account not found" };
    }
    if (!account.isActive) {
      return {
        statusCode: 400,
        error: "Inactive accounts do not accept new transactions",
      };
    }
    if (account.currency !== installment.amount.currency) {
      return {
        statusCode: 400,
        error: `Account currency ${account.currency} does not match the installment currency ${installment.amount.currency}`,
      };
    }

    const payment = Transaction.create({
      companyId,
      accountId: payingAccountId,
      categoryId: installment.categoryId,
      type: "EXPENSE",
      grossAmount: installment.amount.amount,
      currency: installment.amount.currency,
      accountCurrency: account.currency,
      date: paymentDate,
      description: `Pagamento da parcela ${installment.number}`,
      parentTransactionId: installment.parentTransactionId,
    });

    if (payment.isFailure || !payment.value) {
      return {
        statusCode: 400,
        error: (payment.error ?? this.orGeneric(undefined)).message,
      };
    }

    const transaction = payment.value;
    const confirmed = transaction.confirm();
    if (confirmed.isFailure) {
      return {
        statusCode: 400,
        error: (confirmed.error ?? this.orGeneric(undefined)).message,
      };
    }

    const paid = installment.pay(paymentDate, payingAccountId, transaction.id);
    if (paid.isFailure) {
      return {
        statusCode: 400,
        error: (paid.error ?? this.orGeneric(undefined)).message,
      };
    }

    await this.transactionRepository.runAtomic(async (executor) => {
      await this.transactionRepository.create(transaction, executor);
      await this.accountRepository.applyMovement(
        companyId,
        {
          transactionId: transaction.id,
          accountId: payingAccountId,
          direction: "DEBIT",
          amount: transaction.netAmount,
        },
        executor,
      );
      await this.installmentRepository.update(installment, executor);
    });

    this.publish(installment);
    for (const event of transaction.events) {
      this.eventBus.publish(event);
    }
    transaction.clearEvents();

    return {
      body: {
        ...(installment.toJSON() as Record<string, unknown>),
        paymentTransaction: transaction.toJSON(),
      },
    };
  }

  private publish(installment: Installment): void {
    for (const event of installment.events) {
      this.eventBus.publish(event);
    }
    installment.clearEvents();
  }

  private orGeneric(error: DomainError | undefined): DomainError {
    return (
      error ??
      DomainError.create("BUSINESS_RULE_VIOLATION", "Operation not allowed")
    );
  }
}
