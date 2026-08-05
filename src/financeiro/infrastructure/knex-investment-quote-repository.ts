import type { Knex } from "knex";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { QueryExecutor } from "./account-repository.js";
import type {
  InvestmentQuoteFilter,
  InvestmentQuoteRecord,
  InvestmentQuoteRepository,
} from "./investment-quote-repository.js";

function toRecord(row: Record<string, unknown>): InvestmentQuoteRecord {
  return {
    id: row.id as string,
    investmentId: row.investment_id as string,
    quoteDate: new Date(row.quote_date as string),
    unitPrice: Number(row.unit_price),
    source: row.source as string,
  };
}

/**
 * Knex-based implementation of InvestmentQuoteRepository.
 *
 * The company scope lives on `investments`, so every read joins through it and
 * the write checks ownership before inserting — a quote must never be attached
 * to an investment of another company.
 */
export class KnexInvestmentQuoteRepository
  implements InvestmentQuoteRepository
{
  constructor(private readonly knex: Knex) {}

  private async assertOwnership(
    companyId: string,
    investmentId: string,
    executor: QueryExecutor,
  ): Promise<void> {
    const row = await executor("investments")
      .where({ id: investmentId, company_id: companyId })
      .first();

    if (!row) {
      throw DomainError.create(
        "ENTITY_NOT_FOUND",
        `Investment ${investmentId} not found`,
      );
    }
  }

  async upsert(
    companyId: string,
    record: InvestmentQuoteRecord,
    executor?: QueryExecutor,
  ): Promise<InvestmentQuoteRecord> {
    const db = executor ?? this.knex;

    await this.assertOwnership(companyId, record.investmentId, db);

    const rows = (await db("investment_quotes")
      .insert({
        id: record.id,
        investment_id: record.investmentId,
        quote_date: record.quoteDate,
        unit_price: record.unitPrice,
        source: record.source,
        updated_at: new Date(),
      })
      // Registering a quote for a date that already has one replaces it.
      .onConflict(["investment_id", "quote_date"])
      .merge(["unit_price", "source", "updated_at"])
      .returning("*")) as Record<string, unknown>[];

    const row = rows[0];
    return row ? toRecord(row) : record;
  }

  async findForDate(
    companyId: string,
    investmentId: string,
    referenceDate: Date,
  ): Promise<InvestmentQuoteRecord | null> {
    const row = await this.knex("investment_quotes as q")
      .join("investments as i", "i.id", "q.investment_id")
      .where({ "q.investment_id": investmentId, "i.company_id": companyId })
      .andWhere("q.quote_date", "<=", referenceDate)
      .orderBy("q.quote_date", "desc")
      .select("q.*")
      .first();

    return row ? toRecord(row as Record<string, unknown>) : null;
  }

  async findByInvestment(
    companyId: string,
    investmentId: string,
    filter: InvestmentQuoteFilter = {},
  ): Promise<{ items: InvestmentQuoteRecord[]; total: number }> {
    const base = this.knex("investment_quotes as q")
      .join("investments as i", "i.id", "q.investment_id")
      .where({ "q.investment_id": investmentId, "i.company_id": companyId });

    if (filter.from) {
      base.andWhere("q.quote_date", ">=", filter.from);
    }
    if (filter.to) {
      base.andWhere("q.quote_date", "<=", filter.to);
    }

    const countResult = (await base
      .clone()
      .count<{ count: string }[]>("q.id as count")) as { count: string }[];

    const query = base.clone().orderBy("q.quote_date", "desc").select("q.*");
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
