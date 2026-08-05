import type { Knex } from "knex";
import { Installment, type InstallmentStatus } from "../domain/installment.js";
import { Money } from "../domain/money.js";
import type { QueryExecutor } from "./account-repository.js";
import type {
  InstallmentFilter,
  InstallmentRepository,
} from "./installment-repository.js";

/**
 * Maps an `installments` row (joined with its parent transaction currency)
 * into the Installment entity.
 */
function toInstallment(row: Record<string, unknown>): Installment {
  const currency = (row.currency as string | null) ?? "BRL";

  return new Installment({
    id: row.id as string,
    companyId: row.company_id as string,
    parentTransactionId: row.transaction_id as string,
    accountId: row.account_id as string,
    categoryId: (row.category_id as string | null) ?? undefined,
    number: Number(row.number),
    amount: Money.fromDecimalString(String(row.amount ?? "0"), currency),
    dueDate: new Date(row.due_date as string),
    status: row.status as InstallmentStatus,
    paymentDate: row.payment_date
      ? new Date(row.payment_date as string)
      : undefined,
    paymentTransactionId:
      (row.payment_transaction_id as string | null) ?? undefined,
    paymentAccountId: (row.payment_account_id as string | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
  });
}

/**
 * Knex-based implementation of InstallmentRepository.
 */
export class KnexInstallmentRepository implements InstallmentRepository {
  constructor(private readonly knex: Knex) {}

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.knex;
  }

  /**
   * The currency lives on the parent transaction, so every read joins it in.
   */
  private baseQuery(companyId: string): Knex.QueryBuilder {
    return this.knex("installments")
      .join(
        "transactions",
        "transactions.id",
        "installments.transaction_id",
      )
      .where("installments.company_id", companyId)
      .andWhere("transactions.company_id", companyId)
      .select("installments.*", "transactions.currency as currency");
  }

  async createMany(
    installments: readonly Installment[],
    executor?: QueryExecutor,
  ): Promise<void> {
    if (installments.length === 0) {
      return;
    }

    const now = new Date();

    await this.executor(executor)("installments").insert(
      installments.map((installment) => ({
        id: installment.id,
        company_id: installment.companyId,
        transaction_id: installment.parentTransactionId,
        category_id: installment.categoryId ?? null,
        account_id: installment.accountId,
        number: installment.number,
        amount: installment.amount.toDecimalString(),
        due_date: installment.dueDate,
        status: installment.status,
        payment_date: installment.paymentDate ?? null,
        payment_transaction_id: installment.paymentTransactionId ?? null,
        payment_account_id: installment.paymentAccountId ?? null,
        created_at: installment.createdAt,
        updated_at: now,
      })),
    );
  }

  async findById(companyId: string, id: string): Promise<Installment | null> {
    const row = await this.baseQuery(companyId)
      .andWhere("installments.id", id)
      .first();

    return row ? toInstallment(row as Record<string, unknown>) : null;
  }

  async findMany(
    companyId: string,
    filter: InstallmentFilter = {},
  ): Promise<{ items: Installment[]; total: number }> {
    const base = this.baseQuery(companyId);

    if (filter.status) base.andWhere("installments.status", filter.status);
    if (filter.accountId) {
      base.andWhere("installments.account_id", filter.accountId);
    }
    if (filter.parentTransactionId) {
      base.andWhere("installments.transaction_id", filter.parentTransactionId);
    }
    if (filter.dueFrom) {
      base.andWhere("installments.due_date", ">=", filter.dueFrom);
    }
    if (filter.dueTo) {
      base.andWhere("installments.due_date", "<=", filter.dueTo);
    }

    const countResult = (await base
      .clone()
      .clearSelect()
      .clearOrder()
      .count<{ count: string }[]>("installments.id as count")) as {
      count: string;
    }[];

    const rowsQuery = base
      .clone()
      .orderBy("installments.due_date", "asc")
      .orderBy("installments.number", "asc");

    if (filter.limit !== undefined) rowsQuery.limit(filter.limit);
    if (filter.offset !== undefined) rowsQuery.offset(filter.offset);

    const rows = (await rowsQuery) as Record<string, unknown>[];

    return {
      items: rows.map(toInstallment),
      total: Number(countResult[0]?.count ?? 0),
    };
  }

  async findByParentTransactionId(
    companyId: string,
    parentTransactionId: string,
  ): Promise<Installment[]> {
    const result = await this.findMany(companyId, { parentTransactionId });
    return result.items;
  }

  async findOverdueCandidates(
    companyId: string,
    referenceDate: Date,
  ): Promise<Installment[]> {
    const rows = (await this.baseQuery(companyId)
      .andWhere("installments.status", "PENDING")
      .andWhere("installments.due_date", "<", referenceDate)
      .orderBy("installments.due_date", "asc")) as Record<string, unknown>[];

    return rows.map(toInstallment);
  }

  async update(
    installment: Installment,
    executor?: QueryExecutor,
  ): Promise<void> {
    await this.executor(executor)("installments")
      .where({ id: installment.id, company_id: installment.companyId })
      .update({
        amount: installment.amount.toDecimalString(),
        due_date: installment.dueDate,
        status: installment.status,
        payment_date: installment.paymentDate ?? null,
        payment_transaction_id: installment.paymentTransactionId ?? null,
        payment_account_id: installment.paymentAccountId ?? null,
        updated_at: new Date(),
      });
  }
}
