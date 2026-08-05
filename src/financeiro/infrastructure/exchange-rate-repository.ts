import type { QueryExecutor } from "./account-repository.js";

/**
 * A rate as stored: the pair, the factor and the date it is in force from.
 */
export interface ExchangeRateRecord {
  id: string;
  companyId: string;
  sourceCurrency: string;
  targetCurrency: string;
  rate: number;
  rateDate: Date;
  source: string;
}

/**
 * Filters accepted when listing rates.
 */
export interface ExchangeRateFilter {
  sourceCurrency?: string | undefined;
  targetCurrency?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * Repository interface for exchange rates.
 * Every method is scoped by companyId (multi-tenancy invariant).
 */
export interface ExchangeRateRepository {
  /**
   * Writes the rate, replacing the one already registered for the same company,
   * pair and date — correcting a rate must not leave two rows for one day.
   */
  upsert(
    record: ExchangeRateRecord,
    executor?: QueryExecutor,
  ): Promise<ExchangeRateRecord>;

  /**
   * The most recent rate for the pair whose date is not later than `date`.
   * Returns null when the pair has no rate on or before that date — the caller
   * decides what to do, and no caller may assume 1.
   */
  findForDate(
    companyId: string,
    sourceCurrency: string,
    targetCurrency: string,
    date: Date,
  ): Promise<ExchangeRateRecord | null>;

  findByCompany(
    companyId: string,
    filter?: ExchangeRateFilter,
  ): Promise<{ items: ExchangeRateRecord[]; total: number }>;
}
