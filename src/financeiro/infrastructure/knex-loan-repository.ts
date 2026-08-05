import type { Knex } from "knex";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Loan } from "../domain/loan.js";
import type { LoanStatus } from "../domain/loan.js";
import { LoanInstallment } from "../domain/loan-installment.js";
import { Money } from "../domain/money.js";
import type { QueryExecutor } from "./account-repository.js";
import type {
  LoanFilter,
  LoanPaymentRecord,
  LoanRepository,
} from "./loan-repository.js";

function toLoan(row: Record<string, unknown>): Loan {
  const currency = row.currency as string;

  return new Loan({
    id: row.id as string,
    companyId: row.company_id as string,
    accountId: row.account_id as string,
    personId: (row.person_id as string | null) ?? undefined,
    description: row.description as string,
    principalAmount: Money.fromDecimalString(
      String(row.principal_amount),
      currency,
    ),
    monthlyInterestPercent: Number(row.monthly_interest_percent ?? 0),
    installmentCount: Number(row.installment_count),
    installmentAmount: Money.fromDecimalString(
      String(row.installment_amount),
      currency,
    ),
    currency,
    firstDueDate: new Date(row.first_due_date as string),
    status: row.status as LoanStatus,
    settledAt: row.settled_at ? new Date(row.settled_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
  });
}

function toPayment(row: Record<string, unknown>): LoanPaymentRecord {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    loanId: row.loan_id as string,
    loanInstallmentId: (row.loan_installment_id as string | null) ?? undefined,
    transactionId: (row.transaction_id as string | null) ?? undefined,
    accountId: row.account_id as string,
    paymentType: row.payment_type as LoanPaymentRecord["paymentType"],
    amount: String(row.amount),
    principalAmount: String(row.principal_amount),
    paidAt: new Date(row.paid_at as string),
  };
}

export function installmentRow(
  installment: LoanInstallment,
): Record<string, unknown> {
  return {
    id: installment.id,
    company_id: installment.companyId,
    loan_id: installment.loanId,
    number: installment.number,
    due_date: installment.dueDate,
    amount: installment.amount.toDecimalString(),
    interest_amount: installment.interestAmount.toDecimalString(),
    principal_amount: installment.principalAmount.toDecimalString(),
    status: installment.status,
    paid_at: installment.paidAt ?? null,
    created_at: installment.createdAt,
    updated_at: new Date(),
  };
}

/**
 * Knex-based implementation of LoanRepository.
 */
export class KnexLoanRepository implements LoanRepository {
  constructor(private readonly knex: Knex) {}

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.knex;
  }

  async create(
    loan: Loan,
    installments: readonly LoanInstallment[],
    executor?: QueryExecutor,
  ): Promise<void> {
    const db = this.executor(executor);

    await db("loans").insert({
      id: loan.id,
      company_id: loan.companyId,
      account_id: loan.accountId,
      person_id: loan.personId ?? null,
      description: loan.description,
      principal_amount: loan.principalAmount.toDecimalString(),
      monthly_interest_percent: loan.monthlyInterestPercent,
      installment_count: loan.installmentCount,
      installment_amount: loan.installmentAmount.toDecimalString(),
      currency: loan.currency,
      first_due_date: loan.firstDueDate,
      status: loan.status,
      settled_at: loan.settledAt ?? null,
      created_at: loan.createdAt,
      updated_at: new Date(),
    });

    if (installments.length > 0) {
      await db("loan_installments").insert(installments.map(installmentRow));
    }
  }

  async findById(companyId: string, id: string): Promise<Loan | null> {
    const row = await this.knex("loans")
      .where({ id, company_id: companyId })
      .first();

    return row ? toLoan(row as Record<string, unknown>) : null;
  }

  async findByIdForUpdate(
    companyId: string,
    id: string,
    executor: QueryExecutor,
  ): Promise<Loan | null> {
    const row = await executor("loans")
      .where({ id, company_id: companyId })
      .forUpdate()
      .first();

    return row ? toLoan(row as Record<string, unknown>) : null;
  }

  async findByCompany(
    companyId: string,
    filter: LoanFilter = {},
  ): Promise<{ items: Loan[]; total: number }> {
    const base = this.knex("loans").where({ company_id: companyId });

    if (filter.status) {
      base.andWhere("status", filter.status);
    }
    if (filter.personId) {
      base.andWhere("person_id", filter.personId);
    }

    const countResult = (await base
      .clone()
      .count<{ count: string }[]>("id as count")) as { count: string }[];

    const query = base.clone().orderBy("first_due_date", "asc");
    if (filter.limit !== undefined) {
      query.limit(filter.limit);
    }
    if (filter.offset !== undefined) {
      query.offset(filter.offset);
    }

    const rows = await query;

    return {
      items: rows.map((row) => toLoan(row as Record<string, unknown>)),
      total: Number(countResult[0]?.count ?? 0),
    };
  }

  async update(loan: Loan, executor?: QueryExecutor): Promise<void> {
    await this.executor(executor)("loans")
      .where({ id: loan.id, company_id: loan.companyId })
      .update({
        description: loan.description,
        person_id: loan.personId ?? null,
        status: loan.status,
        settled_at: loan.settledAt ?? null,
        updated_at: new Date(),
      });
  }

  async extraAmortizations(
    companyId: string,
    loanId: string,
  ): Promise<string> {
    const result = (await this.knex("loan_payments")
      .where({
        company_id: companyId,
        loan_id: loanId,
        payment_type: "EXTRA_AMORTIZATION",
      })
      .sum<{ total: string | null }[]>("amount as total")) as {
      total: string | null;
    }[];

    return result[0]?.total ?? "0";
  }

  async registerPayment(
    record: LoanPaymentRecord,
    executor?: QueryExecutor,
  ): Promise<void> {
    await this.executor(executor)("loan_payments").insert({
      id: record.id,
      company_id: record.companyId,
      loan_id: record.loanId,
      loan_installment_id: record.loanInstallmentId ?? null,
      transaction_id: record.transactionId ?? null,
      account_id: record.accountId,
      payment_type: record.paymentType,
      amount: record.amount,
      principal_amount: record.principalAmount,
      paid_at: record.paidAt,
    });
  }

  async listPayments(
    companyId: string,
    loanId: string,
  ): Promise<LoanPaymentRecord[]> {
    const rows = await this.knex("loan_payments")
      .where({ company_id: companyId, loan_id: loanId })
      .orderBy("paid_at", "asc");

    return rows.map((row) => toPayment(row as Record<string, unknown>));
  }

  async isPaymentTransaction(
    companyId: string,
    transactionId: string,
  ): Promise<boolean> {
    const row = await this.knex("loan_payments")
      .where({ company_id: companyId, transaction_id: transactionId })
      .first();

    return row !== undefined;
  }
}
