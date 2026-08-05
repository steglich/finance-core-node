import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DashboardController } from "./dashboard-controller.js";
import { ReportController } from "./report-controller.js";
import { escapeCsvField, toCsv } from "./csv.js";
import { validateDashboardQuery, validateReportQuery } from "./dtos.js";
import type {
  BudgetSummary,
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
