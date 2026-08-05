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
 * Phase 4 dashboard summary of the investment portfolio at the reference date.
 */
export interface InvestmentsSummary {
  investedAmount: number;
  currentValue: number;
  unrealizedResult: number;
  realizedResult: number;
  incomeReceived: number;
  profitabilityPercent: number;
  /** False when at least one investment could not be quoted. */
  quoted: boolean;
  distributionByType: {
    investmentType: string;
    currentValue: number;
    sharePercent: number;
  }[];
  currency: string;
}

/**
 * Phase 4 dashboard summary of what the company owes on its loans.
 */
export interface DebtSummary {
  /** Outstanding balance of the loans that are not settled. */
  outstandingBalance: number;
  /** Installments falling due inside the period. */
  dueInPeriod: number;
  overdueAmount: number;
  overdueCount: number;
  currency: string;
}

/**
 * One line of the investments report: the position priced at the reference date
 * plus the results the period produced.
 */
export interface InvestmentReportRow {
  investmentId: string;
  name: string;
  investmentType: string;
  symbol?: string | undefined;
  currency: string;
  quantity: number;
  averageCost: number;
  investedAmount: number;
  currentValue: number;
  unrealizedResult: number;
  /** Realized inside the period, not since inception. */
  realizedResultInPeriod: number;
  incomeReceivedInPeriod: number;
  profitabilityPercent: number;
  quoted: boolean;
}

/**
 * The raw figures the income tax report presents. No tax is computed here.
 */
export interface IncomeTaxData {
  year: number;
  positions: {
    investmentId: string;
    name: string;
    investmentType: string;
    symbol?: string | undefined;
    currency: string;
    quantityAtYearEnd: number;
    costAtYearEnd: number;
    quantityAtPreviousYearEnd: number;
    costAtPreviousYearEnd: number;
  }[];
  incomeByInvestment: {
    investmentId: string;
    name: string;
    operationType: string;
    amount: number;
  }[];
  realizedResults: {
    investmentId: string;
    name: string;
    amount: number;
  }[];
  accountBalances: { accountId: string; name: string; currency: string; balance: number }[];
  loanBalances: { loanId: string; description: string; currency: string; outstandingBalance: number }[];
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

  /**
   * The investment portfolio at the end of the period.
   */
  investmentsSummary(scope: ReportingScope): Promise<InvestmentsSummary>;

  /**
   * What the company owes on its loans at the end of the period.
   */
  debtSummary(scope: ReportingScope): Promise<DebtSummary>;

  /**
   * One line per investment, optionally restricted to a type.
   */
  investmentsReport(
    scope: ReportingScope,
    investmentType?: string,
  ): Promise<InvestmentReportRow[]>;

  /**
   * The raw data of the income tax report for a calendar year.
   */
  incomeTaxData(companyId: string, year: number): Promise<IncomeTaxData>;
}
