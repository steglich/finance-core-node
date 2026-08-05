/**
 * Read model of the financeiro context: flat DTOs produced by SQL aggregation,
 * never hydrated domain entities.
 *
 * Loading thousands of transactions into memory to add them up would break the
 * dashboard response budget on the first real company, so the summing is the
 * database's job (design decision 10). The trade-off is that "what counts as a
 * confirmed expense" now also exists in SQL — which is why every one of these
 * queries lives in a single file.
 */

/**
 * Common scope of every read: the active company, a period, and optionally a
 * subset of accounts.
 */
export interface ReportingScope {
  companyId: string;
  start: Date;
  end: Date;
  accountIds?: readonly string[] | undefined;
  /**
   * Restricts the read to these cost centers and their descendants. Absent
   * means every cost center, including the unclassified transactions.
   */
  costCenterIds?: readonly string[] | undefined;
  /**
   * Record-level filters used by the receivables and payables reports, which
   * read charges and payables rather than transactions.
   */
  personId?: string | undefined;
  categoryId?: string | undefined;
  status?: string | undefined;
}

export interface PeriodIndicators {
  income: number;
  expense: number;
  result: number;
  netWorth: number;
  currency: string;
}

export interface CategoryBreakdownRow {
  categoryId: string | null;
  categoryName: string;
  amount: number;
  percent: number;
}

export interface MonthlySeriesRow {
  /** `YYYY-MM`. */
  month: string;
  income: number;
  expense: number;
}

export interface CashFlowRow {
  /** `YYYY-MM`. */
  month: string;
  inflow: number;
  outflow: number;
  result: number;
  accumulated: number;
}

export interface IncomeStatementRow {
  group: "INCOME" | "EXPENSE";
  categoryId: string | null;
  categoryName: string;
  amount: number;
}

export interface SpendingRow {
  dimensionId: string | null;
  dimensionName: string;
  amount: number;
  percent: number;
}

export interface BudgetSummary {
  count: number;
  planned: number;
  actual: number;
  exceeded: number;
}

/**
 * What is owed to the company, and what the company owes, over a period.
 * Penalty and interest on the overdue charges are included in `overdue`.
 */
export interface ReceivablesSummary {
  openCount: number;
  openTotal: number;
  overdueCount: number;
  overdueTotal: number;
  receivedTotal: number;
  currency: string;
}

export interface PayablesSummary {
  openCount: number;
  openTotal: number;
  overdueCount: number;
  overdueTotal: number;
  paidTotal: number;
  currency: string;
}

/**
 * One line of the by-cost-center report. `costCenterId` is null for the
 * "Sem classificação" group.
 */
export interface CostCenterReportRow {
  costCenterId: string | null;
  costCenterName: string;
  /** Charged to this cost center alone. */
  ownAmount: number;
  /** This cost center plus every descendant — what the report shows. */
  totalAmount: number;
  percent: number;
}

/**
 * One line of the receivables or payables report.
 */
export interface ReceivableReportRow {
  id: string;
  personId: string;
  personName: string;
  description?: string | undefined;
  status: string;
  dueDate: Date;
  amount: number;
  /** Penalty plus interest at the reference date; zero for payables. */
  charges: number;
  totalDue: number;
  /** Payables only: how the obligation is classified. */
  categoryId?: string | undefined;
  costCenterId?: string | undefined;
  /** Amount already settled, from the receipt or payment records. */
  settledAmount: number;
}

export interface GoalSummary {
  activeCount: number;
  target: number;
  current: number;
  progress: number;
}

export interface CardSummaryRow {
  cardId: string;
  name: string;
  limit: number | null;
  availableLimit: number | null;
  openInvoiceAmount: number;
  nextDueDate: Date | null;
}

/**
 * Aggregated reads backing the dashboard and the reports.
 */
export interface ReportingRepository {
  periodIndicators(scope: ReportingScope): Promise<PeriodIndicators>;

  /**
   * Confirmed expenses grouped by top-level category — subcategory spending is
   * rolled up into its root — ordered by amount descending.
   */
  spendingByCategory(scope: ReportingScope): Promise<CategoryBreakdownRow[]>;

  /**
   * Twelve months ending in the scope's end month, months without movement
   * included as zero.
   */
  monthlySeries(scope: ReportingScope): Promise<MonthlySeriesRow[]>;

  budgetSummary(scope: ReportingScope): Promise<BudgetSummary>;

  goalSummary(companyId: string): Promise<GoalSummary>;

  cardSummary(companyId: string): Promise<CardSummaryRow[]>;

  cashFlow(scope: ReportingScope): Promise<CashFlowRow[]>;

  incomeStatement(scope: ReportingScope): Promise<IncomeStatementRow[]>;

  spendingByCard(scope: ReportingScope): Promise<SpendingRow[]>;

  spendingByAccount(scope: ReportingScope): Promise<SpendingRow[]>;

  /**
   * Confirmed expenses grouped by cost center, with each subtree rolled up into
   * its root and the unclassified transactions in their own group.
   */
  spendingByCostCenter(scope: ReportingScope): Promise<CostCenterReportRow[]>;

  receivablesSummary(scope: ReportingScope): Promise<ReceivablesSummary>;

  payablesSummary(scope: ReportingScope): Promise<PayablesSummary>;

  /**
   * Charges falling due inside the period, with the amounts derived for
   * `referenceDate`.
   */
  receivables(
    scope: ReportingScope,
    referenceDate: Date,
  ): Promise<ReceivableReportRow[]>;

  /**
   * Payables falling due inside the period.
   */
  payables(scope: ReportingScope): Promise<ReceivableReportRow[]>;
}
