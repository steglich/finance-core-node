import type { QueryExecutor } from "./account-repository.js";

/**
 * A quote as stored: the unit price of an investment on a date.
 */
export interface InvestmentQuoteRecord {
  id: string;
  investmentId: string;
  quoteDate: Date;
  unitPrice: number;
  source: string;
}

export interface InvestmentQuoteFilter {
  from?: Date | undefined;
  to?: Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * Repository interface for investment quotes.
 *
 * Quotes hang off an investment, and the investment is what carries the company
 * scope — so every method takes the companyId and joins through it.
 */
export interface InvestmentQuoteRepository {
  /**
   * Writes the quote, replacing the one already registered for the same
   * investment and date.
   */
  upsert(
    companyId: string,
    record: InvestmentQuoteRecord,
    executor?: QueryExecutor,
  ): Promise<InvestmentQuoteRecord>;

  /**
   * The most recent quote whose date is not later than the reference date, or
   * null when the investment has none — the caller falls back to the invested
   * amount and flags it (design, decision 8).
   */
  findForDate(
    companyId: string,
    investmentId: string,
    referenceDate: Date,
  ): Promise<InvestmentQuoteRecord | null>;

  findByInvestment(
    companyId: string,
    investmentId: string,
    filter?: InvestmentQuoteFilter,
  ): Promise<{ items: InvestmentQuoteRecord[]; total: number }>;
}
