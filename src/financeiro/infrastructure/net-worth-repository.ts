/**
 * The components net worth is broken into. Assets are positive contributions,
 * liabilities negative ones; keeping them named is what makes every figure
 * traceable back to where it came from.
 */
export type NetWorthComponent =
  | "ACCOUNT_BALANCES"
  | "INVESTMENT_PORTFOLIO"
  | "OPEN_RECEIVABLES"
  | "LOAN_BALANCES"
  | "OPEN_INVOICES"
  | "OPEN_PAYABLES";

export type NetWorthSide = "ASSET" | "LIABILITY";

/**
 * One component, in one currency. The conversion to a display currency happens
 * afterwards, in TypeScript, through the `ExchangeService` — doing it in SQL
 * would reimplement the rate resolution a second time (design, decision 11).
 */
export interface NetWorthComponentRow {
  component: NetWorthComponent;
  side: NetWorthSide;
  currency: string;
  amount: number;
}

/**
 * Read model for net worth.
 *
 * A pure reading layer: there is no aggregate here, because net worth has no
 * write rule of its own — it is the aggregation of things that already exist.
 */
export interface NetWorthRepository {
  /**
   * The components of a company's net worth at a reference date, one row per
   * component and currency.
   *
   * Account balances at a past date are rebuilt from the confirmed entries, not
   * read from the cached balance column, so asking for 31/12/2025 answers about
   * 31/12/2025 rather than about today.
   */
  netWorthAt(
    companyId: string,
    referenceDate: Date,
    accountIds?: readonly string[],
  ): Promise<NetWorthComponentRow[]>;

  /**
   * The company's default currency, used when no display currency is asked for.
   */
  defaultCurrency(companyId: string): Promise<string>;
}

/**
 * The net worth of one company, as read for the consolidation.
 */
export interface CompanyNetWorth {
  companyId: string;
  companyName: string;
  components: NetWorthComponentRow[];
}

/**
 * Reading that spans companies — the only one in the system.
 *
 * It lives outside `BaseRepository` and takes a **userId**, never a list of
 * companies: the company isolation is a repository invariant precisely so that
 * there is no accidental exception, which makes the necessary exception one
 * that has to be unmistakable (design, decision 12).
 */
export interface CrossCompanyReader {
  netWorthByCompany(
    userId: string,
    referenceDate: Date,
  ): Promise<CompanyNetWorth[]>;
}
