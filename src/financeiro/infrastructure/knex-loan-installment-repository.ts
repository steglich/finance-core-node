import type { Knex } from "knex";
import { DomainError } from "../../shared/domain/domain-error.js";
import { LoanInstallment } from "../domain/loan-installment.js";
import { Money } from "../domain/money.js";
import type { QueryExecutor } from "./account-repository.js";
import type { LoanInstallmentRepository } from "./loan-repository.js";
import { installmentRow } from "./knex-loan-repository.js";

/**
 * The statuses an installment may be updated *from*. PAID is final, so an
 * update that finds the row already paid must fail rather than overwrite it.
 */
const UPDATABLE_STATUSES = ["PENDING", "OVERDUE"] as const;

function toInstallment(row: Record<string, unknown>): LoanInstallment {
  const currency = (row.currency as string | undefined) ?? "BRL";

  return new LoanInstallment({
    id: row.id as string,
    companyId: row.company_id as string,
    loanId: row.loan_id as string,
    number: Number(row.number),
    dueDate: new Date(row.due_date as string),
    amount: Money.fromDecimalString(String(row.amount), currency),
    interestAmount: Money.fromDecimalString(
      String(row.interest_amount ?? "0"),
      currency,
    ),
    principalAmount: Money.fromDecimalString(
      String(row.principal_amount),
      currency,
    ),
    status: row.status as "PENDING" | "OVERDUE" | "PAID",
    paidAt: row.paid_at ? new Date(row.paid_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
  });
}

/**
 * Knex-based implementation of LoanInstallmentRepository.
 *
 * Every read joins `loans` to pick up the currency, which lives on the loan and
 * not on the installment — the installment cannot be in another one.
 */
export class KnexLoanInstallmentRepository
  implements LoanInstallmentRepository
{
  constructor(private readonly knex: Knex) {}

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.knex;
  }

  private baseQuery(executor?: QueryExecutor) {
    return this.executor(executor)("loan_installments as li")
      .join("loans as l", "l.id", "li.loan_id")
      .select("li.*", "l.currency");
  }

  async create(
    installments: readonly LoanInstallment[],
    executor?: QueryExecutor,
  ): Promise<void> {
    if (installments.length === 0) {
      return;
    }
    await this.executor(executor)("loan_installments").insert(
      installments.map(installmentRow),
    );
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<LoanInstallment | null> {
    const row = await this.baseQuery()
      .where({ "li.id": id, "li.company_id": companyId })
      .first();

    return row ? toInstallment(row as Record<string, unknown>) : null;
  }

  async findByNumber(
    companyId: string,
    loanId: string,
    number: number,
  ): Promise<LoanInstallment | null> {
    const row = await this.baseQuery()
      .where({
        "li.loan_id": loanId,
        "li.company_id": companyId,
        "li.number": number,
      })
      .first();

    return row ? toInstallment(row as Record<string, unknown>) : null;
  }

  async listByLoan(
    companyId: string,
    loanId: string,
    executor?: QueryExecutor,
  ): Promise<LoanInstallment[]> {
    const rows = await this.baseQuery(executor)
      .where({ "li.loan_id": loanId, "li.company_id": companyId })
      .orderBy("li.number", "asc");

    return rows.map((row) => toInstallment(row as Record<string, unknown>));
  }

  /**
   * Writes the installment demanding that it still be in a status it may move
   * from. A concurrent second payment matches zero rows and throws here, which
   * rolls back its own expense transaction with it.
   */
  async update(
    installment: LoanInstallment,
    executor?: QueryExecutor,
  ): Promise<void> {
    const updated = await this.executor(executor)("loan_installments")
      .where({ id: installment.id, company_id: installment.companyId })
      .whereIn("status", [...UPDATABLE_STATUSES])
      .update({
        due_date: installment.dueDate,
        principal_amount: installment.principalAmount.toDecimalString(),
        status: installment.status,
        paid_at: installment.paidAt ?? null,
        updated_at: new Date(),
      });

    if (updated !== 1) {
      throw DomainError.create(
        "INVALID_OPERATION",
        `Installment ${installment.number} is no longer in a state that accepts this operation`,
      );
    }
  }

  async findOverdueCandidates(referenceDate: Date): Promise<LoanInstallment[]> {
    const rows = await this.baseQuery()
      .where("li.status", "PENDING")
      .andWhere("li.due_date", "<", referenceDate)
      // A settled loan has nothing to fall overdue.
      .whereNot("l.status", "SETTLED")
      .orderBy("li.due_date", "asc");

    return rows.map((row) => toInstallment(row as Record<string, unknown>));
  }
}
