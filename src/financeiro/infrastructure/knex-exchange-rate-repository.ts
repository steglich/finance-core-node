import type { Knex } from "knex";
import { normalizeCurrency } from "../domain/currency.js";
import type { QueryExecutor } from "./account-repository.js";
import type {
  ExchangeRateFilter,
  ExchangeRateRecord,
  ExchangeRateRepository,
} from "./exchange-rate-repository.js";

function toRecord(row: Record<string, unknown>): ExchangeRateRecord {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    sourceCurrency: row.source_currency as string,
    targetCurrency: row.target_currency as string,
    rate: Number(row.rate),
    rateDate: new Date(row.rate_date as string),
    source: row.source as string,
  };
}

/**
 * Knex-based implementation of ExchangeRateRepository.
 */
export class KnexExchangeRateRepository implements ExchangeRateRepository {
  constructor(private readonly knex: Knex) {}

  async upsert(
    record: ExchangeRateRecord,
    executor?: QueryExecutor,
  ): Promise<ExchangeRateRecord> {
    const rows = (await (executor ?? this.knex)("exchange_rates")
      .insert({
        id: record.id,
        company_id: record.companyId,
        source_currency: normalizeCurrency(record.sourceCurrency),
        target_currency: normalizeCurrency(record.targetCurrency),
        rate: record.rate,
        rate_date: record.rateDate,
        source: record.source,
        updated_at: new Date(),
      })
      // Registering a rate for a date that already has one replaces it, so a
      // correction leaves exactly one rate in force for that day.
      .onConflict([
        "company_id",
        "source_currency",
        "target_currency",
        "rate_date",
      ])
      .merge(["rate", "source", "updated_at"])
      .returning("*")) as Record<string, unknown>[];

    const row = rows[0];
    return row ? toRecord(row) : record;
  }

  async findForDate(
    companyId: string,
    sourceCurrency: string,
    targetCurrency: string,
    date: Date,
  ): Promise<ExchangeRateRecord | null> {
    const row = await this.knex("exchange_rates")
      .where({
        company_id: companyId,
        source_currency: normalizeCurrency(sourceCurrency),
        target_currency: normalizeCurrency(targetCurrency),
      })
      .andWhere("rate_date", "<=", date)
      .orderBy("rate_date", "desc")
      .first();

    return row ? toRecord(row as Record<string, unknown>) : null;
  }

  async findByCompany(
    companyId: string,
    filter: ExchangeRateFilter = {},
  ): Promise<{ items: ExchangeRateRecord[]; total: number }> {
    const base = this.knex("exchange_rates").where({ company_id: companyId });

    if (filter.sourceCurrency) {
      base.andWhere("source_currency", normalizeCurrency(filter.sourceCurrency));
    }
    if (filter.targetCurrency) {
      base.andWhere("target_currency", normalizeCurrency(filter.targetCurrency));
    }
    if (filter.from) {
      base.andWhere("rate_date", ">=", filter.from);
    }
    if (filter.to) {
      base.andWhere("rate_date", "<=", filter.to);
    }

    const countResult = (await base
      .clone()
      .count<{ count: string }[]>("id as count")) as { count: string }[];

    const query = base.clone().orderBy("rate_date", "desc");
    if (filter.limit !== undefined) {
      query.limit(filter.limit);
    }
    if (filter.offset !== undefined) {
      query.offset(filter.offset);
    }

    const rows = await query;

    return {
      items: rows.map((row) => toRecord(row as Record<string, unknown>)),
      total: Number(countResult[0]?.count ?? 0),
    };
  }
}
