import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DashboardController } from "./dashboard-controller.js";
import { ReportController } from "./report-controller.js";
import { escapeCsvField, toCsv } from "./csv.js";
import { validateDashboardQuery, validateReportQuery } from "./dtos.js";
import { ExchangeService } from "../domain/exchange-service.js";
import { NetWorthService } from "../domain/net-worth-service.js";
import type { ExchangeRateRecord } from "../infrastructure/exchange-rate-repository.js";
import type { NetWorthComponentRow } from "../infrastructure/net-worth-repository.js";
import type {
  BudgetSummary,
  CostCenterReportRow,
  DebtSummary,
  IncomeTaxData,
  InvestmentReportRow,
  InvestmentsSummary,
  PayablesSummary,
  ReceivableReportRow,
  ReceivablesSummary,
  CardSummaryRow,
  CashFlowRow,
  CategoryBreakdownRow,
  GoalSummary,
  IncomeStatementRow,
  MonthlySeriesRow,
  PeriodIndicators,
  ReportingRepository,
  ReportingScope,
  SpendingRow,
} from "../infrastructure/reporting-repository.js";

const COMPANY_ID = "company-1";

/**
 * Records the scope every read receives, so the tests can assert the company
 * and the period the controller actually queried with.
 */
class FakeReportingRepository implements ReportingRepository {
  readonly scopes: ReportingScope[] = [];

  constructor(
    private readonly data: {
      indicators?: PeriodIndicators;
      categories?: CategoryBreakdownRow[];
      series?: MonthlySeriesRow[];
      budgets?: BudgetSummary;
      goals?: GoalSummary;
      cards?: CardSummaryRow[];
      cashFlow?: CashFlowRow[];
      incomeStatement?: IncomeStatementRow[];
      byCard?: SpendingRow[];
      byAccount?: SpendingRow[];
      byCostCenter?: CostCenterReportRow[];
      receivablesSummary?: ReceivablesSummary;
      payablesSummary?: PayablesSummary;
      receivables?: ReceivableReportRow[];
      payables?: ReceivableReportRow[];
      investmentsSummary?: InvestmentsSummary;
      debtSummary?: DebtSummary;
      investments?: InvestmentReportRow[];
      incomeTax?: IncomeTaxData;
    } = {},
  ) {}

  private record(scope: ReportingScope): void {
    this.scopes.push(scope);
  }

  async periodIndicators(scope: ReportingScope): Promise<PeriodIndicators> {
    this.record(scope);
    return (
      this.data.indicators ?? {
        income: 0,
        expense: 0,
        result: 0,
        netWorth: 0,
        currency: "BRL",
      }
    );
  }

  async spendingByCategory(
    scope: ReportingScope,
  ): Promise<CategoryBreakdownRow[]> {
    this.record(scope);
    return this.data.categories ?? [];
  }

  async monthlySeries(scope: ReportingScope): Promise<MonthlySeriesRow[]> {
    this.record(scope);
    return this.data.series ?? [];
  }

  async budgetSummary(scope: ReportingScope): Promise<BudgetSummary> {
    this.record(scope);
    return (
      this.data.budgets ?? { count: 0, planned: 0, actual: 0, exceeded: 0 }
    );
  }

  async goalSummary(): Promise<GoalSummary> {
    return (
      this.data.goals ?? {
        activeCount: 0,
        target: 0,
        current: 0,
        progress: 0,
      }
    );
  }

  async cardSummary(): Promise<CardSummaryRow[]> {
    return this.data.cards ?? [];
  }

  async spendingByCostCenter(
    scope: ReportingScope,
  ): Promise<CostCenterReportRow[]> {
    this.record(scope);
    return this.data.byCostCenter ?? [];
  }

  async receivablesSummary(
    scope: ReportingScope,
  ): Promise<ReceivablesSummary> {
    this.record(scope);
    return (
      this.data.receivablesSummary ?? {
        openCount: 0,
        openTotal: 0,
        overdueCount: 0,
        overdueTotal: 0,
        receivedTotal: 0,
        currency: "BRL",
      }
    );
  }

  async payablesSummary(scope: ReportingScope): Promise<PayablesSummary> {
    this.record(scope);
    return (
      this.data.payablesSummary ?? {
        openCount: 0,
        openTotal: 0,
        overdueCount: 0,
        overdueTotal: 0,
        paidTotal: 0,
        currency: "BRL",
      }
    );
  }

  async receivables(scope: ReportingScope): Promise<ReceivableReportRow[]> {
    this.record(scope);
    return this.data.receivables ?? [];
  }

  async payables(scope: ReportingScope): Promise<ReceivableReportRow[]> {
    this.record(scope);
    return this.data.payables ?? [];
  }

  async cashFlow(scope: ReportingScope): Promise<CashFlowRow[]> {
    this.record(scope);
    return this.data.cashFlow ?? [];
  }

  async incomeStatement(scope: ReportingScope): Promise<IncomeStatementRow[]> {
    this.record(scope);
    return this.data.incomeStatement ?? [];
  }

  async spendingByCard(scope: ReportingScope): Promise<SpendingRow[]> {
    this.record(scope);
    return this.data.byCard ?? [];
  }

  async spendingByAccount(scope: ReportingScope): Promise<SpendingRow[]> {
    this.record(scope);
    return this.data.byAccount ?? [];
  }

  async investmentsSummary(
    scope: ReportingScope,
  ): Promise<InvestmentsSummary> {
    this.record(scope);
    return (
      this.data.investmentsSummary ?? {
        investedAmount: 0,
        currentValue: 0,
        unrealizedResult: 0,
        realizedResult: 0,
        incomeReceived: 0,
        profitabilityPercent: 0,
        quoted: true,
        distributionByType: [],
        currency: "BRL",
      }
    );
  }

  async debtSummary(scope: ReportingScope): Promise<DebtSummary> {
    this.record(scope);
    return (
      this.data.debtSummary ?? {
        outstandingBalance: 0,
        dueInPeriod: 0,
        overdueAmount: 0,
        overdueCount: 0,
        currency: "BRL",
      }
    );
  }

  async investmentsReport(
    scope: ReportingScope,
    investmentType?: string,
  ): Promise<InvestmentReportRow[]> {
    this.record(scope);
    const rows = this.data.investments ?? [];
    return investmentType
      ? rows.filter((row) => row.investmentType === investmentType)
      : rows;
  }

  async incomeTaxData(companyId: string, year: number): Promise<IncomeTaxData> {
    return (
      this.data.incomeTax ?? {
        year,
        positions: [],
        incomeByInvestment: [],
        realizedResults: [],
        accountBalances: [],
        loanBalances: [],
      }
    );
  }
}

const PERIOD = { start: "2026-08-01", end: "2026-08-31" };

describe("Dashboard query validation", () => {
  it("falls back to the current month when no period is supplied", () => {
    const result = validateDashboardQuery({}, new Date("2026-08-05T00:00:00Z"));

    assert.ok(result.success);
    assert.equal(
      result.data.start.toISOString().slice(0, 10),
      "2026-08-01",
    );
    assert.equal(result.data.end.toISOString().slice(0, 10), "2026-08-31");
  });

  it("rejects a start later than the end", () => {
    const result = validateDashboardQuery({
      start: "2026-08-31",
      end: "2026-08-01",
    });

    assert.ok(!result.success);
    assert.equal(result.error.code, "VALIDATION_ERROR");
  });

  it("accepts accounts as a list or as a comma-separated value", () => {
    const list = validateDashboardQuery({
      ...PERIOD,
      accountIds: ["a", "b"],
    });
    assert.ok(list.success);
    assert.deepEqual(list.data.accountIds, ["a", "b"]);

    const csv = validateDashboardQuery({ ...PERIOD, accountIds: "a,b" });
    assert.ok(csv.success);
    assert.deepEqual(csv.data.accountIds, ["a", "b"]);
  });
});

describe("Dashboard", () => {
  it("returns the indicators, the breakdown, the series and the summaries", async () => {
    const reporting = new FakeReportingRepository({
      indicators: {
        income: 8000,
        expense: 6500,
        result: 1500,
        netWorth: 5000,
        currency: "BRL",
      },
      budgets: { count: 4, planned: 3200, actual: 3400, exceeded: 1 },
    });

    const result = await new DashboardController(reporting).overview(
      COMPANY_ID,
      PERIOD,
    );

    assert.equal(result.statusCode, 200);
    const body = result.body as Record<string, unknown>;
    assert.deepEqual(body.indicators, {
      income: 8000,
      expense: 6500,
      result: 1500,
      netWorth: 5000,
      currency: "BRL",
    });
    assert.deepEqual(
      (body.summaries as { budgets: BudgetSummary }).budgets,
      { count: 4, planned: 3200, actual: 3400, exceeded: 1 },
    );
  });

  it("returns empty summaries instead of failing when there is no data", async () => {
    const result = await new DashboardController(
      new FakeReportingRepository(),
    ).overview(COMPANY_ID, PERIOD);

    assert.equal(result.statusCode, 200);
    const body = result.body as Record<string, unknown>;
    assert.deepEqual(body.spendingByCategory, []);
    assert.deepEqual(
      (body.summaries as { cards: CardSummaryRow[] }).cards,
      [],
    );
  });

  it("scopes every query to the authenticated company and the filter", async () => {
    const reporting = new FakeReportingRepository();

    await new DashboardController(reporting).overview(COMPANY_ID, {
      ...PERIOD,
      accountIds: "account-1",
      // A company sent by the client must be ignored.
      companyId: "company-2",
    });

    assert.ok(reporting.scopes.length > 0);
    for (const scope of reporting.scopes) {
      assert.equal(scope.companyId, COMPANY_ID);
      assert.deepEqual(scope.accountIds, ["account-1"]);
    }
  });

  it("rejects an invalid period", async () => {
    const result = await new DashboardController(
      new FakeReportingRepository(),
    ).overview(COMPANY_ID, { start: "2026-08-31", end: "2026-08-01" });

    assert.equal(result.statusCode, 400);
  });
});

describe("Report query validation", () => {
  it("rejects an unknown report type", () => {
    const result = validateReportQuery("unknown", PERIOD);
    assert.ok(!result.success);
  });

  it("accepts every supported type", () => {
    for (const type of [
      "cash-flow",
      "income-statement",
      "by-category",
      "by-card",
      "by-account",
    ]) {
      assert.ok(validateReportQuery(type, PERIOD).success, type);
    }
  });
});

describe("Reports", () => {
  it("adds a totals line to the cash flow report", async () => {
    const reporting = new FakeReportingRepository({
      cashFlow: [
        {
          month: "2026-05",
          inflow: 1000,
          outflow: 400,
          result: 600,
          accumulated: 600,
        },
        {
          month: "2026-06",
          inflow: 500,
          outflow: 900,
          result: -400,
          accumulated: 200,
        },
      ],
    });

    const result = await new ReportController(reporting).generate(
      COMPANY_ID,
      "cash-flow",
      { start: "2026-05-01", end: "2026-06-30" },
    );

    const rows = (result.body as { rows: unknown[][] }).rows;
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.at(-1), ["Total", 1500, 1300, 200, 200]);
  });

  it("returns a zeroed report rather than an error for an empty period", async () => {
    const result = await new ReportController(
      new FakeReportingRepository(),
    ).generate(COMPANY_ID, "cash-flow", PERIOD);

    assert.equal(result.statusCode, 200);
    const rows = (result.body as { rows: unknown[][] }).rows;
    assert.deepEqual(rows, [["Total", 0, 0, 0, 0]]);
  });

  it("groups the income statement and closes with the net result", async () => {
    const reporting = new FakeReportingRepository({
      incomeStatement: [
        {
          group: "INCOME",
          categoryId: "c1",
          categoryName: "Vendas",
          amount: 20000,
        },
        {
          group: "EXPENSE",
          categoryId: "c2",
          categoryName: "Alimentação",
          amount: 14000,
        },
      ],
    });

    const result = await new ReportController(reporting).generate(
      COMPANY_ID,
      "income-statement",
      PERIOD,
    );

    const rows = (result.body as { rows: unknown[][] }).rows;
    assert.deepEqual(rows.at(-1), ["Total", "Resultado", 6000]);
  });

  it("carries the percentage of the total into the spending reports", async () => {
    const reporting = new FakeReportingRepository({
      byCard: [
        {
          dimensionId: "card-1",
          dimensionName: "Nubank",
          amount: 750,
          percent: 75,
        },
        {
          dimensionId: "card-2",
          dimensionName: "Itaú",
          amount: 250,
          percent: 25,
        },
      ],
    });

    const result = await new ReportController(reporting).generate(
      COMPANY_ID,
      "by-card",
      PERIOD,
    );

    assert.deepEqual((result.body as { columns: string[] }).columns, [
      "Cartão",
      "Valor",
      "% do total",
    ]);
    assert.deepEqual((result.body as { rows: unknown[][] }).rows, [
      ["Nubank", 750, 75],
      ["Itaú", 250, 25],
    ]);
  });

  it("exports the same rows as CSV, as an attachment", async () => {
    const reporting = new FakeReportingRepository({
      categories: [
        {
          categoryId: "c1",
          categoryName: "Alimentação",
          amount: 800,
          percent: 100,
        },
      ],
    });

    const result = await new ReportController(reporting).export(
      COMPANY_ID,
      "by-category",
      PERIOD,
    );

    assert.equal(result.headers?.["Content-Type"], "text/csv; charset=utf-8");
    assert.match(
      result.headers?.["Content-Disposition"] ?? "",
      /^attachment; filename="by-category-2026-08-01\.csv"$/,
    );
    assert.equal(
      result.body,
      'Categoria,Valor,% do total\r\nAlimentação,800,100',
    );
  });
});

describe("CSV serialization", () => {
  it("leaves plain values untouched", () => {
    assert.equal(escapeCsvField("Alimentação"), "Alimentação");
    assert.equal(escapeCsvField(1234.5), "1234.5");
    assert.equal(escapeCsvField(null), "");
  });

  it("quotes separators, quotes and line breaks", () => {
    assert.equal(escapeCsvField("Mercado, feira"), '"Mercado, feira"');
    assert.equal(escapeCsvField('Diz "oi"'), '"Diz ""oi"""');
    assert.equal(escapeCsvField("linha1\nlinha2"), '"linha1\nlinha2"');
  });

  it("keeps the header line and the column order", () => {
    const csv = toCsv({
      columns: ["A", "B"],
      rows: [
        [1, 2],
        [3, 4],
      ],
    });

    assert.equal(csv, "A,B\r\n1,2\r\n3,4");
  });
});

describe("Phase 3 dashboard and reports", () => {
  it("accepts cost centers as a list or as a comma-separated value", () => {
    const list = validateDashboardQuery({
      ...PERIOD,
      costCenterIds: ["cc-1", "cc-2"],
    });
    assert.ok(list.success);
    assert.deepEqual(list.data.costCenterIds, ["cc-1", "cc-2"]);

    const csv = validateDashboardQuery({
      ...PERIOD,
      costCenterIds: "cc-1,cc-2",
    });
    assert.ok(csv.success);
    assert.deepEqual(csv.data.costCenterIds, ["cc-1", "cc-2"]);
  });

  it("carries the cost center filter into every period-derived read", async () => {
    const reporting = new FakeReportingRepository();

    await new DashboardController(reporting).overview(COMPANY_ID, {
      ...PERIOD,
      costCenterIds: ["cc-marketing"],
    });

    assert.ok(reporting.scopes.length > 0);
    for (const scope of reporting.scopes) {
      assert.equal(scope.companyId, COMPANY_ID);
    }

    // The transaction-derived reads narrow with the filter …
    const filtered = reporting.scopes.filter(
      (scope) => scope.costCenterIds !== undefined,
    );
    assert.ok(filtered.length > 0);
    for (const scope of filtered) {
      assert.deepEqual(scope.costCenterIds, ["cc-marketing"]);
    }

    // … and exactly two reads deliberately do not: the investments summary and
    // the debt summary, since a position and a debt are not attributable to a
    // cost center (Phase 4 dashboard spec).
    const unfiltered = reporting.scopes.filter(
      (scope) => scope.costCenterIds === undefined,
    );
    assert.equal(unfiltered.length, 2);
  });

  it("returns the receivables and payables summaries", async () => {
    const reporting = new FakeReportingRepository({
      receivablesSummary: {
        openCount: 3,
        openTotal: 4532.5,
        overdueCount: 1,
        overdueTotal: 1532.5,
        receivedTotal: 0,
        currency: "BRL",
      },
      payablesSummary: {
        openCount: 2,
        openTotal: 1300,
        overdueCount: 1,
        overdueTotal: 300,
        paidTotal: 0,
        currency: "BRL",
      },
    });

    const result = await new DashboardController(reporting).overview(
      COMPANY_ID,
      PERIOD,
    );

    const summaries = (result.body as Record<string, unknown>)
      .summaries as Record<string, unknown>;

    assert.deepEqual(summaries.receivables, {
      openCount: 3,
      openTotal: 4532.5,
      overdueCount: 1,
      overdueTotal: 1532.5,
      receivedTotal: 0,
      currency: "BRL",
    });
    assert.deepEqual(summaries.payables, {
      openCount: 2,
      openTotal: 1300,
      overdueCount: 1,
      overdueTotal: 300,
      paidTotal: 0,
      currency: "BRL",
    });
  });

  it("zeroes both summaries when there is nothing open", async () => {
    const result = await new DashboardController(
      new FakeReportingRepository(),
    ).overview(COMPANY_ID, PERIOD);

    const summaries = (result.body as Record<string, unknown>)
      .summaries as {
      receivables: { openTotal: number; openCount: number };
      payables: { openTotal: number; openCount: number };
    };

    assert.equal(summaries.receivables.openTotal, 0);
    assert.equal(summaries.receivables.openCount, 0);
    assert.equal(summaries.payables.openTotal, 0);
    assert.equal(summaries.payables.openCount, 0);
  });

  it("accepts the three new report types", () => {
    for (const type of ["by-cost-center", "receivables", "payables"]) {
      const result = validateReportQuery(type, PERIOD);
      assert.ok(result.success, `${type} should be a valid report type`);
    }
  });

  it("renders by-cost-center with the rollup and the unclassified group", async () => {
    const reporting = new FakeReportingRepository({
      byCostCenter: [
        {
          costCenterId: "cc-marketing",
          costCenterName: "Marketing",
          ownAmount: 200,
          totalAmount: 500,
          percent: 62.5,
        },
        {
          costCenterId: "cc-midia",
          costCenterName: "Mídia Paga",
          ownAmount: 300,
          totalAmount: 300,
          percent: 37.5,
        },
        {
          costCenterId: null,
          costCenterName: "Sem classificação",
          ownAmount: 300,
          totalAmount: 300,
          percent: 37.5,
        },
      ],
    });

    const result = await new ReportController(reporting).generate(
      COMPANY_ID,
      "by-cost-center",
      PERIOD,
    );

    const body = result.body as { columns: string[]; rows: unknown[][] };
    assert.deepEqual(body.columns, [
      "Centro de custo",
      "Valor próprio",
      "Valor com filhos",
      "% do total",
    ]);
    // The parent shows its own 200 plus the child's 300.
    assert.deepEqual(body.rows[0], ["Marketing", 200, 500, 62.5]);
    assert.deepEqual(body.rows[2], ["Sem classificação", 300, 300, 37.5]);
  });

  it("renders receivables with the accrued charges and a total line", async () => {
    const reporting = new FakeReportingRepository({
      receivables: [
        {
          id: "charge-1",
          personId: "person-1",
          personName: "João Silva",
          status: "OVERDUE",
          dueDate: new Date("2026-08-15T00:00:00Z"),
          amount: 1500,
          charges: 32.5,
          totalDue: 1532.5,
          settledAmount: 0,
        },
      ],
    });

    const result = await new ReportController(reporting).generate(
      COMPANY_ID,
      "receivables",
      PERIOD,
    );

    const body = result.body as { columns: string[]; rows: unknown[][] };
    assert.deepEqual(body.rows[0], [
      "João Silva",
      "",
      "OVERDUE",
      "2026-08-15",
      1500,
      32.5,
      1532.5,
    ]);
    // Closing lines: issued, overdue and received totals.
    assert.deepEqual(body.rows.at(-3), [
      "Total emitido",
      "",
      "",
      "",
      "",
      "",
      0,
    ]);
    assert.deepEqual(body.rows.at(-2), [
      "Total vencido",
      "",
      "",
      "",
      "",
      "",
      1532.5,
    ]);
    assert.deepEqual(body.rows.at(-1), [
      "Total recebido",
      "",
      "",
      "",
      "",
      "",
      0,
    ]);
  });

  it("renders payables without accruing anything for lateness", async () => {
    const reporting = new FakeReportingRepository({
      payables: [
        {
          id: "payable-1",
          personId: "person-2",
          personName: "Fornecedor XYZ",
          status: "OVERDUE",
          dueDate: new Date("2026-08-10T00:00:00Z"),
          amount: 300,
          charges: 0,
          totalDue: 300,
          settledAmount: 0,
        },
      ],
    });

    const result = await new ReportController(reporting).generate(
      COMPANY_ID,
      "payables",
      PERIOD,
    );

    const body = result.body as { rows: unknown[][] };
    assert.deepEqual(body.rows[0], [
      "Fornecedor XYZ",
      "",
      "OVERDUE",
      "2026-08-10",
      "",
      "",
      300,
    ]);
    assert.deepEqual(body.rows.at(-2), [
      "Total vencido",
      "",
      "",
      "",
      "",
      "",
      300,
    ]);
  });

  it("exports the three new reports as CSV from the same table", async () => {
    const reporting = new FakeReportingRepository({
      byCostCenter: [
        {
          costCenterId: "cc-marketing",
          costCenterName: "Marketing",
          ownAmount: 200,
          totalAmount: 500,
          percent: 100,
        },
      ],
      receivables: [
        {
          id: "charge-1",
          personId: "person-1",
          personName: "João Silva",
          status: "ISSUED",
          dueDate: new Date("2026-08-15T00:00:00Z"),
          amount: 1500,
          charges: 0,
          totalDue: 1500,
          settledAmount: 0,
        },
      ],
      payables: [
        {
          id: "payable-1",
          personId: "person-2",
          personName: "Fornecedor XYZ",
          status: "PENDING",
          dueDate: new Date("2026-08-20T00:00:00Z"),
          amount: 300,
          charges: 0,
          totalDue: 300,
          settledAmount: 0,
        },
      ],
    });

    const controller = new ReportController(reporting);

    for (const type of ["by-cost-center", "receivables", "payables"] as const) {
      const exported = await controller.export(COMPANY_ID, type, PERIOD);

      assert.equal(exported.statusCode, 200);
      assert.equal(
        exported.headers?.["Content-Type"],
        "text/csv; charset=utf-8",
      );
      assert.match(
        String(exported.headers?.["Content-Disposition"] ?? ""),
        new RegExp(type),
      );
      assert.equal(typeof exported.body, "string");
      assert.ok(String(exported.body).length > 0);
    }
  });

  it("carries the cost center filter into the report scope", async () => {
    const reporting = new FakeReportingRepository();

    await new ReportController(reporting).generate(COMPANY_ID, "payables", {
      ...PERIOD,
      costCenterIds: ["cc-marketing"],
    });

    assert.deepEqual(reporting.scopes[0]?.costCenterIds, ["cc-marketing"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 4: net worth, investments and income tax                              */
/* -------------------------------------------------------------------------- */

/**
 * A net worth service backed by fixed components, so the controller behaviour
 * can be pinned without a database. The conversion itself is covered by
 * `net-worth-service.test.ts`.
 */
function fakeNetWorthService(
  components: NetWorthComponentRow[],
  options: { defaultCurrency?: string; rates?: ExchangeRateRecord[] } = {},
): NetWorthService {
  const exchange = new ExchangeService({
    async upsert(record: ExchangeRateRecord) {
      return record;
    },
    async findForDate(
      companyId: string,
      sourceCurrency: string,
      targetCurrency: string,
      date: Date,
    ) {
      return (
        (options.rates ?? []).find(
          (rate) =>
            rate.sourceCurrency === sourceCurrency &&
            rate.targetCurrency === targetCurrency &&
            rate.rateDate.getTime() <= date.getTime(),
        ) ?? null
      );
    },
    async findByCompany() {
      return { items: [], total: 0 };
    },
  });

  return new NetWorthService(
    {
      async netWorthAt() {
        return components;
      },
      async defaultCurrency() {
        return options.defaultCurrency ?? "BRL";
      },
    },
    exchange,
  );
}

function asset(component: string, amount: number, currency = "BRL"): NetWorthComponentRow {
  return {
    component: component as NetWorthComponentRow["component"],
    side: "ASSET",
    currency,
    amount,
  };
}

function liability(component: string, amount: number): NetWorthComponentRow {
  return {
    component: component as NetWorthComponentRow["component"],
    side: "LIABILITY",
    currency: "BRL",
    amount,
  };
}

const INVESTMENT_ROWS: InvestmentReportRow[] = [
  {
    investmentId: "inv-1",
    name: "Petrobras PN",
    investmentType: "STOCK",
    symbol: "PETR4",
    currency: "BRL",
    quantity: 100,
    averageCost: 32.5,
    investedAmount: 3250,
    currentValue: 3800,
    unrealizedResult: 550,
    realizedResultInPeriod: 0,
    incomeReceivedInPeriod: 50,
    profitabilityPercent: 18.46,
    quoted: true,
  },
  {
    investmentId: "inv-2",
    name: "Fundo Imobiliário",
    investmentType: "REIT",
    currency: "BRL",
    quantity: 10,
    averageCost: 100,
    investedAmount: 1000,
    currentValue: 1000,
    unrealizedResult: 0,
    realizedResultInPeriod: 0,
    incomeReceivedInPeriod: 0,
    profitabilityPercent: 0,
    quoted: false,
  },
];

describe("Phase 4 dashboard", () => {
  it("returns the investments and debt summaries", async () => {
    const reporting = new FakeReportingRepository({
      investmentsSummary: {
        investedAmount: 10000,
        currentValue: 11500,
        unrealizedResult: 1500,
        realizedResult: 0,
        incomeReceived: 0,
        profitabilityPercent: 15,
        quoted: true,
        distributionByType: [
          { investmentType: "STOCK", currentValue: 11500, sharePercent: 100 },
        ],
        currency: "BRL",
      },
      debtSummary: {
        outstandingBalance: 8000,
        dueInPeriod: 1040,
        overdueAmount: 1040,
        overdueCount: 2,
        currency: "BRL",
      },
    });

    const result = await new DashboardController(reporting).overview(
      COMPANY_ID,
      PERIOD,
    );

    const summaries = (result.body as Record<string, unknown>)
      .summaries as Record<string, unknown>;

    const investments = summaries.investments as Record<string, unknown>;
    assert.equal(investments.investedAmount, 10000);
    assert.equal(investments.currentValue, 11500);
    assert.equal(investments.unrealizedResult, 1500);
    assert.equal(investments.profitabilityPercent, 15);

    const debt = summaries.debt as Record<string, unknown>;
    assert.equal(debt.outstandingBalance, 8000);
    assert.equal(debt.overdueAmount, 1040);
    assert.equal(debt.overdueCount, 2);
  });

  it("zeroes both summaries for a company with neither investments nor loans", async () => {
    const reporting = new FakeReportingRepository();

    const result = await new DashboardController(reporting).overview(
      COMPANY_ID,
      PERIOD,
    );

    const summaries = (result.body as Record<string, unknown>)
      .summaries as Record<string, unknown>;

    assert.equal(
      (summaries.investments as Record<string, unknown>).currentValue,
      0,
    );
    assert.equal(
      (summaries.debt as Record<string, unknown>).outstandingBalance,
      0,
    );
  });

  it("reports net worth as assets minus liabilities", async () => {
    const reporting = new FakeReportingRepository();
    const service = fakeNetWorthService([
      asset("ACCOUNT_BALANCES", 5000),
      asset("INVESTMENT_PORTFOLIO", 10000),
      liability("LOAN_BALANCES", 4000),
    ]);

    const result = await new DashboardController(reporting, service).overview(
      COMPANY_ID,
      PERIOD,
    );

    const indicators = (result.body as Record<string, unknown>)
      .indicators as Record<string, unknown>;

    assert.equal(indicators.netWorth, 11000);
  });

  it("counts accounts in two currencies at the rate of the reference date", async () => {
    const reporting = new FakeReportingRepository();
    const service = fakeNetWorthService(
      [asset("ACCOUNT_BALANCES", 10000), asset("ACCOUNT_BALANCES", 1000, "USD")],
      {
        rates: [
          {
            id: "rate-1",
            companyId: COMPANY_ID,
            sourceCurrency: "USD",
            targetCurrency: "BRL",
            rate: 5.2,
            rateDate: new Date("2026-01-01T00:00:00Z"),
            source: "MANUAL",
          },
        ],
      },
    );

    const result = await new DashboardController(reporting, service).overview(
      COMPANY_ID,
      PERIOD,
    );

    const indicators = (result.body as Record<string, unknown>)
      .indicators as Record<string, unknown>;

    assert.equal(indicators.netWorth, 15200);
  });

  it("reports the missing rate instead of a partial net worth", async () => {
    const reporting = new FakeReportingRepository();
    const service = fakeNetWorthService([
      asset("ACCOUNT_BALANCES", 10000),
      asset("ACCOUNT_BALANCES", 1000, "USD"),
    ]);

    const result = await new DashboardController(reporting, service).overview(
      COMPANY_ID,
      PERIOD,
    );

    assert.equal(result.statusCode, 422);
    assert.match(
      String((result.body as Record<string, unknown>).error),
      /USD\/BRL/,
    );
  });

  it("defaults the display currency to the company's", async () => {
    const reporting = new FakeReportingRepository();
    const service = fakeNetWorthService([], { defaultCurrency: "USD" });

    const result = await new DashboardController(reporting, service).overview(
      COMPANY_ID,
      PERIOD,
    );

    assert.equal(
      (result.body as Record<string, unknown>).displayCurrency,
      "USD",
    );
  });

  it("honours an explicit display currency", async () => {
    const reporting = new FakeReportingRepository();
    const service = fakeNetWorthService([], { defaultCurrency: "USD" });

    const result = await new DashboardController(reporting, service).overview(
      COMPANY_ID,
      { ...PERIOD, displayCurrency: "BRL" },
    );

    assert.equal(
      (result.body as Record<string, unknown>).displayCurrency,
      "BRL",
    );
  });
});

describe("Phase 4 reports", () => {
  it("produces the net worth report in asset and liability sections", async () => {
    const reporting = new FakeReportingRepository();
    const service = fakeNetWorthService([
      asset("ACCOUNT_BALANCES", 20000),
      asset("INVESTMENT_PORTFOLIO", 30000),
      liability("LOAN_BALANCES", 10000),
    ]);

    const result = await new ReportController(reporting, service).generate(
      COMPANY_ID,
      "net-worth",
      { start: "2026-07-01", end: "2026-07-31" },
    );

    assert.equal(result.statusCode, 200);
    const body = result.body as Record<string, unknown>;
    const sections = body.sections as { title: string; rows: unknown[][] }[];

    assert.deepEqual(
      sections.map((section) => section.title),
      ["Ativos", "Passivos", "Patrimônio líquido"],
    );
    assert.equal(sections[0]?.rows.at(-1)?.at(-1), 50000);
    assert.equal(sections[1]?.rows.at(-1)?.at(-1), 10000);
    assert.equal(sections[2]?.rows[0]?.at(-1), 40000);
  });

  it("adds the monthly evolution when the period spans more than one month", async () => {
    const reporting = new FakeReportingRepository();
    const service = fakeNetWorthService([asset("ACCOUNT_BALANCES", 1000)]);

    const result = await new ReportController(reporting, service).generate(
      COMPANY_ID,
      "net-worth",
      { start: "2026-01-01", end: "2026-03-31" },
    );

    const sections = (result.body as Record<string, unknown>).sections as {
      title: string;
      rows: unknown[][];
    }[];

    const evolution = sections.find(
      (section) => section.title === "Evolução mensal",
    );
    assert.ok(evolution);
    assert.equal(evolution.rows.length, 3);
  });

  it("exports the net worth report with one header block per section", async () => {
    const reporting = new FakeReportingRepository();
    const service = fakeNetWorthService([
      asset("ACCOUNT_BALANCES", 20000),
      liability("LOAN_BALANCES", 10000),
    ]);

    const result = await new ReportController(reporting, service).export(
      COMPANY_ID,
      "net-worth",
      { start: "2026-07-01", end: "2026-07-31" },
    );

    const csv = String(result.body);

    assert.ok(csv.startsWith("Ativos\r\n"));
    assert.ok(csv.includes("\r\n\r\nPassivos\r\n"));
    assert.ok(csv.includes("Componente,"));
  });

  it("zeroes the net worth report for a company with no data", async () => {
    const reporting = new FakeReportingRepository();
    const service = fakeNetWorthService([]);

    const result = await new ReportController(reporting, service).generate(
      COMPANY_ID,
      "net-worth",
      { start: "2026-07-01", end: "2026-07-31" },
    );

    const sections = (result.body as Record<string, unknown>).sections as {
      title: string;
      rows: unknown[][];
    }[];

    assert.equal(sections[2]?.rows[0]?.at(-1), 0);
  });

  it("produces one line per investment plus totals and distribution", async () => {
    const reporting = new FakeReportingRepository({
      investments: INVESTMENT_ROWS,
    });

    const result = await new ReportController(reporting).generate(
      COMPANY_ID,
      "investments",
      { start: "2026-07-01", end: "2026-07-31" },
    );

    const sections = (result.body as Record<string, unknown>).sections as {
      title: string;
      rows: unknown[][];
    }[];

    const positions = sections[0];
    assert.ok(positions);
    // Two investments plus the totals line.
    assert.equal(positions.rows.length, 3);
    assert.equal(positions.rows[0]?.[0], "Petrobras PN");

    const totals = positions.rows[2];
    assert.ok(totals);
    assert.equal(totals[5], 4250);
    assert.equal(totals[6], 4800);

    const distribution = sections[1];
    assert.ok(distribution);
    assert.deepEqual(
      distribution.rows.map((row) => row[0]),
      ["STOCK", "REIT"],
    );
  });

  it("flags the line of an investment without a quote", async () => {
    const reporting = new FakeReportingRepository({
      investments: INVESTMENT_ROWS,
    });

    const result = await new ReportController(reporting).generate(
      COMPANY_ID,
      "investments",
      { start: "2026-07-01", end: "2026-07-31" },
    );

    const sections = (result.body as Record<string, unknown>).sections as {
      rows: unknown[][];
    }[];

    const reit = sections[0]?.rows[1];
    assert.ok(reit);
    // Value falls back to the invested amount and the "com cotação" flag is no.
    assert.equal(reit[5], 1000);
    assert.equal(reit[6], 1000);
    assert.equal(reit.at(-1), "não");
  });

  it("recomputes the totals over the filtered subset", async () => {
    const reporting = new FakeReportingRepository({
      investments: INVESTMENT_ROWS,
    });

    const result = await new ReportController(reporting).generate(
      COMPANY_ID,
      "investments",
      {
        start: "2026-07-01",
        end: "2026-07-31",
        investmentType: "STOCK",
      },
    );

    const sections = (result.body as Record<string, unknown>).sections as {
      rows: unknown[][];
    }[];

    const rows = sections[0]?.rows;
    assert.ok(rows);
    // One investment plus the totals line.
    assert.equal(rows.length, 2);
    assert.equal(rows[1]?.[5], 3250);
    assert.equal(rows[1]?.[6], 3800);
  });

  it("rejects an income tax period that is not a calendar year", async () => {
    const reporting = new FakeReportingRepository();

    const result = await new ReportController(reporting).generate(
      COMPANY_ID,
      "income-tax",
      { start: "2026-01-01", end: "2026-06-30" },
    );

    assert.equal(result.statusCode, 400);
    assert.match(
      String((result.body as Record<string, unknown>).error),
      /calendar year/,
    );
  });

  it("produces the income tax report for a calendar year without computing tax", async () => {
    const reporting = new FakeReportingRepository({
      incomeTax: {
        year: 2026,
        positions: [
          {
            investmentId: "inv-1",
            name: "Petrobras PN",
            investmentType: "STOCK",
            symbol: "PETR4",
            currency: "BRL",
            quantityAtYearEnd: 100,
            costAtYearEnd: 3250,
            quantityAtPreviousYearEnd: 50,
            costAtPreviousYearEnd: 1500,
          },
        ],
        incomeByInvestment: [
          {
            investmentId: "inv-1",
            name: "Petrobras PN",
            operationType: "DIVIDEND",
            amount: 120,
          },
        ],
        realizedResults: [
          { investmentId: "inv-1", name: "Petrobras PN", amount: 250 },
        ],
        accountBalances: [
          {
            accountId: "acc-1",
            name: "Conta Corrente",
            currency: "BRL",
            balance: 8000,
          },
        ],
        loanBalances: [
          {
            loanId: "loan-1",
            description: "Empréstimo",
            currency: "BRL",
            outstandingBalance: 6000,
          },
        ],
      },
    });

    const result = await new ReportController(reporting).generate(
      COMPANY_ID,
      "income-tax",
      { start: "2026-01-01", end: "2026-12-31" },
    );

    assert.equal(result.statusCode, 200);
    const sections = (result.body as Record<string, unknown>).sections as {
      title: string;
      rows: unknown[][];
    }[];

    assert.equal(sections.length, 6);
    assert.match(sections[0]?.title ?? "", /31\/12\/2026 e em 31\/12\/2025/);
    assert.equal(sections[0]?.rows[0]?.[4], 100);
    assert.equal(sections[0]?.rows[0]?.[6], 50);
    assert.equal(sections[1]?.rows[0]?.[2], 120);
    assert.equal(sections[2]?.rows[0]?.[1], 250);
    assert.equal(sections[3]?.rows[0]?.[2], 8000);
    assert.equal(sections[4]?.rows[0]?.[2], 6000);

    // No tax amount anywhere, and the report says so.
    assert.match(String(sections[5]?.rows[0]?.[0]), /não apura imposto devido/);
  });

  it("exports the income tax report with a header block per section", async () => {
    const reporting = new FakeReportingRepository();

    const result = await new ReportController(reporting).export(
      COMPANY_ID,
      "income-tax",
      { start: "2026-01-01", end: "2026-12-31" },
    );

    const csv = String(result.body);

    assert.ok(csv.includes("Proventos recebidos no ano"));
    assert.ok(csv.includes("Resultados realizados no ano"));
    assert.ok(csv.includes("Observação"));
  });
});
