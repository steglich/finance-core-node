import type { Knex } from "knex";
import { Money } from "../domain/money.js";
import {
  Recurrence,
  type Periodicity,
  type RecurrenceStatus,
} from "../domain/recurrence.js";
import type { TransactionType } from "../domain/transaction.js";
import type { QueryExecutor } from "./account-repository.js";
import type {
  RecurrenceFilter,
  RecurrenceRepository,
} from "./recurrence-repository.js";

/**
 * Maps a `recurrences` row into the Recurrence aggregate.
 */
function toRecurrence(row: Record<string, unknown>): Recurrence {
  const currency = (row.currency as string | null) ?? "BRL";

  return new Recurrence({
    id: row.id as string,
    companyId: row.company_id as string,
    accountId: row.account_id as string,
    categoryId: (row.category_id as string | null) ?? undefined,
    description: row.description as string,
    amount: Money.fromDecimalString(String(row.amount ?? "0"), currency),
    type: (row.type as TransactionType | null) ?? "EXPENSE",
    periodicity: row.periodicity as Periodicity,
    startDate: new Date(row.start_date as string),
    endDate: row.end_date ? new Date(row.end_date as string) : undefined,
    maxOccurrences:
      row.max_occurrences === null || row.max_occurrences === undefined
        ? undefined
        : Number(row.max_occurrences),
    status: row.status as RecurrenceStatus,
    generatedCount: Number(row.generated_count ?? 0),
    createdAt: new Date(row.created_at as string),
  });
}

/**
 * Knex-based implementation of RecurrenceRepository.
 */
export class KnexRecurrenceRepository implements RecurrenceRepository {
  constructor(private readonly knex: Knex) {}

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.knex;
  }

  async create(
    recurrence: Recurrence,
    executor?: QueryExecutor,
  ): Promise<void> {
    await this.executor(executor)("recurrences").insert({
      id: recurrence.id,
      company_id: recurrence.companyId,
      account_id: recurrence.accountId,
      category_id: recurrence.categoryId ?? null,
      description: recurrence.description,
      amount: recurrence.amount.toDecimalString(),
      currency: recurrence.amount.currency,
      type: recurrence.type,
      periodicity: recurrence.periodicity,
      start_date: recurrence.startDate,
      end_date: recurrence.endDate ?? null,
      max_occurrences: recurrence.maxOccurrences ?? null,
      status: recurrence.status,
      generated_count: recurrence.generatedCount,
      created_at: recurrence.createdAt,
      updated_at: new Date(),
    });
  }

  async findById(companyId: string, id: string): Promise<Recurrence | null> {
    const row = await this.knex("recurrences")
      .where({ id, company_id: companyId })
      .first();

    return row ? toRecurrence(row as Record<string, unknown>) : null;
  }

  async findMany(
    companyId: string,
    filter: RecurrenceFilter = {},
  ): Promise<{ items: Recurrence[]; total: number }> {
    const base = this.knex("recurrences").where("company_id", companyId);

    if (filter.status) base.andWhere("status", filter.status);
    if (filter.accountId) base.andWhere("account_id", filter.accountId);
    if (filter.categoryId) base.andWhere("category_id", filter.categoryId);

    const countResult = (await base
      .clone()
      .clearOrder()
      .count<{ count: string }[]>("id as count")) as { count: string }[];

    const rowsQuery = base.clone().orderBy("created_at", "desc");
    if (filter.limit !== undefined) rowsQuery.limit(filter.limit);
    if (filter.offset !== undefined) rowsQuery.offset(filter.offset);

    const rows = (await rowsQuery) as Record<string, unknown>[];

    return {
      items: rows.map(toRecurrence),
      total: Number(countResult[0]?.count ?? 0),
    };
  }

  async findActive(): Promise<Recurrence[]> {
    const rows = (await this.knex("recurrences")
      .where("status", "ACTIVE")
      .orderBy("start_date", "asc")) as Record<string, unknown>[];

    return rows.map(toRecurrence);
  }

  async update(
    recurrence: Recurrence,
    executor?: QueryExecutor,
  ): Promise<void> {
    await this.executor(executor)("recurrences")
      .where({ id: recurrence.id, company_id: recurrence.companyId })
      .update({
        category_id: recurrence.categoryId ?? null,
        description: recurrence.description,
        amount: recurrence.amount.toDecimalString(),
        currency: recurrence.amount.currency,
        type: recurrence.type,
        end_date: recurrence.endDate ?? null,
        max_occurrences: recurrence.maxOccurrences ?? null,
        status: recurrence.status,
        generated_count: recurrence.generatedCount,
        updated_at: new Date(),
      });
  }
}
