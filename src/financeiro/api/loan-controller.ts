import type { PersonRepository } from "../../cadastros/infrastructure/person-repository.js";
import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEvent } from "../../shared/domain/domain-event.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import { Loan } from "../domain/loan.js";
import type { LoanAmortizationService } from "../domain/loan-amortization-service.js";
import type { LoanInstallment } from "../domain/loan-installment.js";
import type { LoanPaymentService } from "../domain/loan-payment-service.js";
import type { AccountRepository } from "../infrastructure/account-repository.js";
import type {
  LoanInstallmentRepository,
  LoanRepository,
} from "../infrastructure/loan-repository.js";
import type { TransactionRepository } from "../infrastructure/transaction-repository.js";
import {
  validateAmortizationRequest,
  validateContractLoanRequest,
  validateLoanListQuery,
  validateLoanPaymentRequest,
  validateUpdateLoanRequest,
} from "./dtos.js";

/**
 * Loan endpoints. The company scope always comes from the token.
 */
export class LoanController {
  constructor(
    private readonly loanRepository: LoanRepository,
    private readonly installmentRepository: LoanInstallmentRepository,
    private readonly accountRepository: AccountRepository,
    private readonly personRepository: PersonRepository,
    private readonly transactionRepository: TransactionRepository,
    private readonly paymentService: LoanPaymentService,
    private readonly amortizationService: LoanAmortizationService,
    private readonly eventBus: DomainEventBus,
  ) {}

  /**
   * POST /api/v1/loans
   *
   * The loan and its whole schedule are written in one database transaction: a
   * loan without installments is not a state anyone should be able to observe.
   */
  async contract(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateContractLoanRequest(body);
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

    const creditor = input.personId
      ? await this.personRepository.findById(companyId, input.personId)
      : null;
    if (input.personId && !creditor) {
      return { statusCode: 404, body: { error: "Creditor not found" } };
    }

    const result = Loan.contract({
      companyId,
      account: {
        id: account.id,
        companyId: account.companyId,
        currency: account.currency,
        isActive: account.isActive,
      },
      creditor: creditor
        ? { id: creditor.id, companyId: creditor.companyId }
        : undefined,
      description: input.description,
      principalAmount: input.principalAmount,
      monthlyInterestPercent: input.monthlyInterestPercent,
      installmentCount: input.installmentCount,
      installmentAmount: input.installmentAmount,
      firstDueDate: input.firstDueDate,
    });

    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    const { loan, installments } = result.value;

    await this.transactionRepository.runAtomic(async (executor) => {
      await this.loanRepository.create(loan, installments, executor);
    });

    this.publish(loan.events);
    loan.clearEvents();

    return {
      statusCode: 201,
      body: {
        ...(loan.toJSON() as Record<string, unknown>),
        ...this.serializeBalance(loan, installments),
        installments: installments.map((installment) => installment.toJSON()),
      },
    };
  }

  /**
   * GET /api/v1/loans
   */
  async list(companyId: string, query: unknown): Promise<ControllerResult> {
    const validation = validateLoanListQuery(query);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const { items, total } = await this.loanRepository.findByCompany(
      companyId,
      validation.data,
    );

    const loans = [];
    for (const loan of items) {
      const installments = await this.installmentRepository.listByLoan(
        companyId,
        loan.id,
      );
      loans.push({
        ...(loan.toJSON() as Record<string, unknown>),
        ...this.serializeBalance(loan, installments),
      });
    }

    return { statusCode: 200, body: { loans, total } };
  }

  /**
   * GET /api/v1/loans/:loanId
   */
  async get(companyId: string, loanId: string): Promise<ControllerResult> {
    const loan = await this.loanRepository.findById(companyId, loanId);
    if (!loan) {
      return { statusCode: 404, body: { error: "Loan not found" } };
    }

    const installments = await this.installmentRepository.listByLoan(
      companyId,
      loanId,
    );
    const payments = await this.loanRepository.listPayments(companyId, loanId);

    return {
      statusCode: 200,
      body: {
        ...(loan.toJSON() as Record<string, unknown>),
        ...this.serializeBalance(loan, installments),
        installments: installments.map((installment) => installment.toJSON()),
        payments,
      },
    };
  }

  /**
   * PUT /api/v1/loans/:loanId
   */
  async update(
    companyId: string,
    loanId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateUpdateLoanRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const loan = await this.loanRepository.findById(companyId, loanId);
    if (!loan) {
      return { statusCode: 404, body: { error: "Loan not found" } };
    }

    const input = validation.data;

    if (input.personId) {
      const creditor = await this.personRepository.findById(
        companyId,
        input.personId,
      );
      if (!creditor) {
        return { statusCode: 404, body: { error: "Creditor not found" } };
      }
    }

    const result = loan.edit(input);
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.loanRepository.update(loan);

    return { statusCode: 200, body: loan.toJSON() };
  }

  /**
   * GET /api/v1/loans/:loanId/installments
   */
  async listInstallments(
    companyId: string,
    loanId: string,
  ): Promise<ControllerResult> {
    const loan = await this.loanRepository.findById(companyId, loanId);
    if (!loan) {
      return { statusCode: 404, body: { error: "Loan not found" } };
    }

    const installments = await this.installmentRepository.listByLoan(
      companyId,
      loanId,
    );

    return {
      statusCode: 200,
      body: {
        installments: installments.map((installment) => installment.toJSON()),
        total: installments.length,
      },
    };
  }

  /**
   * POST /api/v1/loans/:loanId/installments/:number/payments
   *
   * The expense transaction, the account debit, the installment transition and
   * the loan transition are written in a single database transaction. The
   * installment UPDATE is guarded by status, so a concurrent second payment
   * matches zero rows, throws, and takes its own transaction down with it.
   */
  async payInstallment(
    companyId: string,
    loanId: string,
    installmentNumber: number,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateLoanPaymentRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const input = validation.data;

    const loan = await this.loanRepository.findById(companyId, loanId);
    if (!loan) {
      return { statusCode: 404, body: { error: "Loan not found" } };
    }

    const installment = await this.installmentRepository.findByNumber(
      companyId,
      loanId,
      installmentNumber,
    );
    if (!installment) {
      return { statusCode: 404, body: { error: "Installment not found" } };
    }

    const account = await this.accountRepository.findById(
      companyId,
      input.accountId,
    );
    if (!account) {
      return { statusCode: 404, body: { error: "Account not found" } };
    }

    const installments = await this.installmentRepository.listByLoan(
      companyId,
      loanId,
    );

    const result = this.paymentService.pay({
      loan,
      installment,
      installments,
      account,
      amount: input.amount,
      paidAt: input.paidAt,
      categoryId: input.categoryId,
      costCenterId: input.costCenterId,
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
      await this.installmentRepository.update(installment, executor);
      await this.loanRepository.update(loan, executor);
      await this.loanRepository.registerPayment(
        {
          id: paymentId,
          companyId,
          loanId: loan.id,
          loanInstallmentId: installment.id,
          transactionId: payment.id,
          accountId: account.id,
          paymentType: "INSTALLMENT",
          amount: amount.toDecimalString(),
          principalAmount: installment.principalAmount.toDecimalString(),
          paidAt,
        },
        executor,
      );
    });

    this.publish(events);
    payment.clearEvents();
    loan.clearEvents();

    const refreshed = await this.installmentRepository.listByLoan(
      companyId,
      loanId,
    );

    return {
      statusCode: 200,
      body: {
        ...(loan.toJSON() as Record<string, unknown>),
        ...this.serializeBalance(loan, refreshed),
        installment: installment.toJSON(),
        transaction: payment.toJSON(),
      },
    };
  }

  /**
   * POST /api/v1/loans/:loanId/amortizations
   *
   * The loan row is locked for the whole write: the amortization decides which
   * installments it settles from a summed balance, so the balance it read must
   * not move underneath it (design, decision 7).
   */
  async amortize(
    companyId: string,
    loanId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateAmortizationRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const input = validation.data;

    const existing = await this.loanRepository.findById(companyId, loanId);
    if (!existing) {
      return { statusCode: 404, body: { error: "Loan not found" } };
    }

    const account = await this.accountRepository.findById(
      companyId,
      input.accountId,
    );
    if (!account) {
      return { statusCode: 404, body: { error: "Account not found" } };
    }

    const outcome = await this.transactionRepository.runAtomic(
      async (executor) => {
        const loan = await this.loanRepository.findByIdForUpdate(
          companyId,
          loanId,
          executor,
        );
        if (!loan) {
          throw DomainError.create("ENTITY_NOT_FOUND", "Loan not found");
        }

        const installments = await this.installmentRepository.listByLoan(
          companyId,
          loanId,
          executor,
        );

        const balance = loan.balanceFrom(installments);

        const result = this.amortizationService.amortize({
          loan,
          installments,
          outstandingBalance: balance.outstandingBalance,
          account,
          amount: input.amount,
          paidAt: input.paidAt,
          categoryId: input.categoryId,
          costCenterId: input.costCenterId,
          description: input.description,
        });

        if (result.isFailure || !result.value) {
          throw this.orGeneric(result.error);
        }

        const {
          payment,
          paymentId,
          amount,
          paidAt,
          settledInstallments,
          reducedInstallment,
          events,
        } = result.value;

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

        for (const installment of settledInstallments) {
          await this.installmentRepository.update(installment, executor);
        }
        if (reducedInstallment) {
          await this.installmentRepository.update(reducedInstallment, executor);
        }

        await this.loanRepository.update(loan, executor);
        await this.loanRepository.registerPayment(
          {
            id: paymentId,
            companyId,
            loanId: loan.id,
            transactionId: payment.id,
            accountId: account.id,
            paymentType: "EXTRA_AMORTIZATION",
            amount: amount.toDecimalString(),
            principalAmount: amount.toDecimalString(),
            paidAt,
          },
          executor,
        );

        return { loan, payment, events, installments };
      },
    );

    this.publish(outcome.events);
    outcome.payment.clearEvents();
    outcome.loan.clearEvents();

    const refreshed = await this.installmentRepository.listByLoan(
      companyId,
      loanId,
    );

    return {
      statusCode: 200,
      body: {
        ...(outcome.loan.toJSON() as Record<string, unknown>),
        ...this.serializeBalance(outcome.loan, refreshed),
        transaction: outcome.payment.toJSON(),
      },
    };
  }

  /**
   * The derived figures of a loan — never read from storage.
   */
  private serializeBalance(
    loan: Loan,
    installments: readonly LoanInstallment[],
  ): Record<string, unknown> {
    const balance = loan.balanceFrom(installments);

    return {
      outstandingBalance: balance.outstandingBalance.amount,
      paidInstallments: balance.paidInstallments,
      remainingInstallments: balance.remainingInstallments,
      interestPaid: balance.interestPaid.amount,
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
