import type { Knex } from "knex";
import { addMonths, toUtcDate } from "../domain/date-math.js";
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
} from "./reporting-repository.js";

const DEFAULT_CURRENCY = "BRL";

/**
 * Only confirmed transactions count. Cancelled and refunded ones are excluded
 * by this filter alone — they never carry the CONFIRMED status.
 */
const CONFIRMED = "CONFIRMED";

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentOf(amount: number, total: number): number {
  return total === 0 ? 0 : Number(((amount / total) * 100).toFixed(4));
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * Rows returned by `knex.raw` on the `pg` driver.
 */
function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/**
 * Knex-based read model for the dashboard and the reports.
 *
 * Every query is scoped by `company_id`, taken from the authenticated context by
 * the controller and never from the client.
 */
export class KnexReportingRepository implements ReportingRepository {
  constructor(private readonly knex: Knex) {}

  /**
   * Base transaction query: company, period, confirmed status and the optional
   * account filter, applied identically everywhere.
   */
  private scoped(scope: ReportingScope): Knex.QueryBuilder {
    const query = this.knex("transactions")
      .where("transactions.company_id", scope.companyId)
      .andWhere("transactions.status", CONFIRMED)
      .andWhere("transactions.date", ">=", scope.start)
      .andWhere("transactions.date", "<=", scope.end);

    if (scope.accountIds && scope.accountIds.length > 0) {
      query.whereIn("transactions.account_id", [...scope.accountIds]);
    }

    return query;
  }

  private async currencyOf(companyId: string): Promise<string> {
    const row = (await this.knex("accounts")
      .where({ company_id: companyId, is_deleted: false })
      .select("currency")
      .first()) as { currency: string } | undefined;

    return row?.currency ?? DEFAULT_CURRENCY;
  }

  async periodIndicators(scope: ReportingScope): Promise<PeriodIndicators> {
    const totals = (await this.scoped(scope)
      .select(
        this.knex.raw(
          "COALESCE(SUM(CASE WHEN type = 'INCOME' THEN net_amount ELSE 0 END), 0) AS income",
        ),
        this.knex.raw(
          "COALESCE(SUM(CASE WHEN type = 'EXPENSE' THEN net_amount ELSE 0 END), 0) AS expense",
        ),
      )
      .first()) as { income: string; expense: string } | undefined;

    const netWorthQuery = this.knex("accounts")
      .where({
        company_id: scope.companyId,
        is_active: true,
        is_deleted: false,
      })
      .select(this.knex.raw("COALESCE(SUM(balance), 0) AS total"));

    if (scope.accountIds && scope.accountIds.length > 0) {
      netWorthQuery.whereIn("id", [...scope.accountIds]);
    }

    const [netWorth, currency] = await Promise.all([
      netWorthQuery.first() as Promise<{ total: string } | undefined>,
      this.currencyOf(scope.companyId),
    ]);

    const income = num(totals?.income);
    const expense = num(totals?.expense);

    return {
      income,
      expense,
      result: Number((income - expense).toFixed(2)),
      netWorth: num(netWorth?.total),
      currency,
    };
  }

  /**
   * Maps every category of a company to its top-level ancestor, so subcategory
   * spending rolls up into the category the user actually budgets on.
   */
  private rootCategoryCte(): string {
    return `WITH RECURSIVE roots AS (
        SELECT id, id AS root_id, name AS root_name
          FROM categories
         WHERE company_id = ? AND parent_id IS NULL
        UNION ALL
        SELECT c.id, r.root_id, r.root_name
          FROM categories c
          JOIN roots r ON c.parent_id = r.id
         WHERE c.company_id = ?
      )`;
  }

  private accountFilterSql(scope: ReportingScope): {
    sql: string;
    bindings: string[];
  } {
    if (!scope.accountIds || scope.accountIds.length === 0) {
      return { sql: "", bindings: [] };
    }

    const placeholders = scope.accountIds.map(() => "?").join(", ");
    return {
      sql: ` AND t.account_id IN (${placeholders})`,
      bindings: [...scope.accountIds],
    };
  }

  async spendingByCategory(
    scope: ReportingScope,
  ): Promise<CategoryBreakdownRow[]> {
    const accounts = this.accountFilterSql(scope);

    const result = await this.knex.raw(
      `${this.rootCategoryCte()}
       SELECT r.root_id AS category_id,
              r.root_name AS category_name,
              COALESCE(SUM(t.net_amount), 0) AS amount
         FROM transactions t
         JOIN roots r ON r.id = t.category_id
        WHERE t.company_id = ?
          AND t.type = 'EXPENSE'
          AND t.status = ?
          AND t.date >= ?
          AND t.date <= ?${accounts.sql}
        GROUP BY r.root_id, r.root_name
        ORDER BY amount DESC`,
      [
        scope.companyId,
        scope.companyId,
        scope.companyId,
        CONFIRMED,
        scope.start,
        scope.end,
        ...accounts.bindings,
      ],
    );

    const rows = rowsOf<{
      category_id: string;
      category_name: string;
      amount: string;
    }>(result);

    const total = rows.reduce((sum, row) => sum + num(row.amount), 0);

    return rows.map((row) => ({
      categoryId: row.category_id,
      categoryName: row.category_name,
      amount: num(row.amount),
      percent: percentOf(num(row.amount), total),
    }));
  }

  /**
   * Builds the list of month keys a series must contain, so months with no
   * movement come back as zero instead of disappearing.
   */
  private monthKeysEndingAt(end: Date, count: number): string[] {
    const last = toUtcDate(end);
    const keys: string[] = [];

    for (let offset = count - 1; offset >= 0; offset -= 1) {
      keys.push(monthKey(addMonths(new Date(Date.UTC(
        last.getUTCFullYear(),
        last.getUTCMonth(),
        1,
      )), -offset)));
    }

    return keys;
  }

  private async monthlyTotals(
    scope: ReportingScope,
  ): Promise<Map<string, { income: number; expense: number }>> {
    const rows = (await this.scoped(scope)
      .select(
        this.knex.raw("to_char(date, 'YYYY-MM') AS month"),
        this.knex.raw(
          "COALESCE(SUM(CASE WHEN type = 'INCOME' THEN net_amount ELSE 0 END), 0) AS income",
        ),
        this.knex.raw(
          "COALESCE(SUM(CASE WHEN type = 'EXPENSE' THEN net_amount ELSE 0 END), 0) AS expense",
        ),
      )
      .groupByRaw("to_char(date, 'YYYY-MM')")) as {
      month: string;
      income: string;
      expense: string;
    }[];

    return new Map(
      rows.map((row) => [
        row.month,
        { income: num(row.income), expense: num(row.expense) },
      ]),
    );
  }

  async monthlySeries(scope: ReportingScope): Promise<MonthlySeriesRow[]> {
    const start = addMonths(
      new Date(
        Date.UTC(
          toUtcDate(scope.end).getUTCFullYear(),
          toUtcDate(scope.end).getUTCMonth(),
          1,
        ),
      ),
      -11,
    );

    const totals = await this.monthlyTotals({ ...scope, start });

    return this.monthKeysEndingAt(scope.end, 12).map((month) => ({
      month,
      income: totals.get(month)?.income ?? 0,
      expense: totals.get(month)?.expense ?? 0,
    }));
  }

  async budgetSummary(scope: ReportingScope): Promise<BudgetSummary> {
    const budgets = (await this.knex("budgets")
      .where("company_id", scope.companyId)
      .whereIn("status", ["ACTIVE", "CLOSED"])
      .andWhere("period_start", "<=", scope.end)
      .andWhere("period_end", ">=", scope.start)
      .select(
        "id",
        "category_id",
        "planned_amount",
        "actual_amount",
        "period_start",
        "period_end",
      )) as {
      id: string;
      category_id: string;
      planned_amount: string;
      actual_amount: string | null;
      period_start: string;
      period_end: string;
    }[];

    let planned = 0;
    let actual = 0;
    let exceeded = 0;

    for (const budget of budgets) {
      const spent =
        budget.actual_amount === null
          ? await this.categorySpending(
              scope.companyId,
              budget.category_id,
              new Date(budget.period_start),
              new Date(budget.period_end),
            )
          : num(budget.actual_amount);

      planned += num(budget.planned_amount);
      actual += spent;
      if (spent > num(budget.planned_amount)) {
        exceeded += 1;
      }
    }

    return {
      count: budgets.length,
      planned: Number(planned.toFixed(2)),
      actual: Number(actual.toFixed(2)),
      exceeded,
    };
  }

  /**
   * Confirmed expense of a category and its descendants inside a window — the
   * same rule `BudgetRepository.actualAmount` applies, reused here so the
   * dashboard summary and the budget detail cannot disagree.
   */
  private async categorySpending(
    companyId: string,
    categoryId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const result = await this.knex.raw(
      `WITH RECURSIVE scope AS (
         SELECT id FROM categories WHERE id = ? AND company_id = ?
         UNION ALL
         SELECT c.id FROM categories c JOIN scope s ON c.parent_id = s.id
          WHERE c.company_id = ?
       )
       SELECT COALESCE(SUM(t.net_amount), 0) AS total
         FROM transactions t
        WHERE t.company_id = ?
          AND t.type = 'EXPENSE'
          AND t.status = ?
          AND t.date >= ?
          AND t.date <= ?
          AND t.category_id IN (SELECT id FROM scope)`,
      [categoryId, companyId, companyId, companyId, CONFIRMED, start, end],
    );

    return num(rowsOf<{ total: string }>(result)[0]?.total);
  }

  async goalSummary(companyId: string): Promise<GoalSummary> {
    const row = (await this.knex("goals")
      .where("company_id", companyId)
      .whereIn("status", ["CREATED", "IN_PROGRESS"])
      .select(
        this.knex.raw("COUNT(*) AS active_count"),
        this.knex.raw("COALESCE(SUM(target_amount), 0) AS target"),
        this.knex.raw("COALESCE(SUM(current_amount), 0) AS current"),
      )
      .first()) as
      | { active_count: string; target: string; current: string }
      | undefined;

    const target = num(row?.target);
    const current = num(row?.current);

    return {
      activeCount: Number(row?.active_count ?? 0),
      target,
      current,
      progress: percentOf(current, target),
    };
  }

  async cardSummary(companyId: string): Promise<CardSummaryRow[]> {
    const result = await this.knex.raw(
      `SELECT c.id AS card_id,
              c.name AS name,
              c.type AS type,
              c.credit_limit AS credit_limit,
              COALESCE((
                SELECT SUM(t.net_amount)
                  FROM transactions t
                  LEFT JOIN invoices oi ON oi.id = t.invoice_id
                 WHERE t.card_id = c.id
                   AND t.company_id = c.company_id
                   AND t.status = ?
                   AND (t.invoice_id IS NULL OR oi.status = 'OPEN')
              ), 0) AS open_amount,
              COALESCE((
                SELECT SUM(i.total_amount - i.paid_amount)
                  FROM invoices i
                 WHERE i.card_id = c.id
                   AND i.status IN ('CLOSED', 'PARTIALLY_PAID', 'OVERDUE')
              ), 0) AS outstanding,
              (
                SELECT MIN(i.due_date)
                  FROM invoices i
                 WHERE i.card_id = c.id
                   AND i.status IN ('CLOSED', 'PARTIALLY_PAID', 'OVERDUE')
              ) AS next_due_date
         FROM cards c
        WHERE c.company_id = ?
          AND c.is_active = true
        ORDER BY c.name ASC`,
      [CONFIRMED, companyId],
    );

    return rowsOf<{
      card_id: string;
      name: string;
      type: string;
      credit_limit: string | null;
      open_amount: string;
      outstanding: string;
      next_due_date: string | null;
    }>(result).map((row) => {
      const limit = row.credit_limit === null ? null : num(row.credit_limit);
      const committed = num(row.open_amount) + num(row.outstanding);

      return {
        cardId: row.card_id,
        name: row.name,
        limit,
        // A debit card has no limit, therefore no available limit either.
        availableLimit:
          limit === null ? null : Number((limit - committed).toFixed(2)),
        openInvoiceAmount: num(row.open_amount),
        nextDueDate: row.next_due_date ? new Date(row.next_due_date) : null,
      };
    });
  }

  async cashFlow(scope: ReportingScope): Promise<CashFlowRow[]> {
    const totals = await this.monthlyTotals(scope);

    const months = this.monthsBetween(scope.start, scope.end);
    let accumulated = 0;

    return months.map((month) => {
      const inflow = totals.get(month)?.income ?? 0;
      const outflow = totals.get(month)?.expense ?? 0;
      const result = Number((inflow - outflow).toFixed(2));
      accumulated = Number((accumulated + result).toFixed(2));

      return { month, inflow, outflow, result, accumulated };
    });
  }

  /**
   * Every month key touched by the period, so a month without movement still
   * shows up as a zeroed line instead of vanishing from the report.
   */
  private monthsBetween(start: Date, end: Date): string[] {
    const first = toUtcDate(start);
    const last = toUtcDate(end);
    const months: string[] = [];

    let cursor = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1),
    );
    const limit = new Date(
      Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1),
    );

    while (cursor.getTime() <= limit.getTime()) {
      months.push(monthKey(cursor));
      cursor = addMonths(cursor, 1);
    }

    return months;
  }

  async incomeStatement(scope: ReportingScope): Promise<IncomeStatementRow[]> {
    const rows = (await this.scoped(scope)
      .leftJoin("categories", "categories.id", "transactions.category_id")
      .whereIn("transactions.type", ["INCOME", "EXPENSE"])
      .select(
        "transactions.type as group",
        "transactions.category_id as category_id",
        this.knex.raw(
          "COALESCE(categories.name, 'Sem categoria') AS category_name",
        ),
        this.knex.raw("COALESCE(SUM(transactions.net_amount), 0) AS amount"),
      )
      .groupBy(
        "transactions.type",
        "transactions.category_id",
        "categories.name",
      )
      .orderBy("group", "asc")
      .orderBy("amount", "desc")) as {
      group: "INCOME" | "EXPENSE";
      category_id: string | null;
      category_name: string;
      amount: string;
    }[];

    return rows.map((row) => ({
      group: row.group,
      categoryId: row.category_id,
      categoryName: row.category_name,
      amount: num(row.amount),
    }));
  }

  async spendingByCard(scope: ReportingScope): Promise<SpendingRow[]> {
    return this.spendingBy(scope, {
      table: "cards",
      column: "transactions.card_id",
      label: "cards.name",
    });
  }

  async spendingByAccount(scope: ReportingScope): Promise<SpendingRow[]> {
    return this.spendingBy(scope, {
      table: "accounts",
      column: "transactions.account_id",
      label: "accounts.name",
    });
  }

  /**
   * Shared shape of the "spending by <dimension>" reports.
   */
  private async spendingBy(
    scope: ReportingScope,
    dimension: { table: string; column: string; label: string },
  ): Promise<SpendingRow[]> {
    const rows = (await this.scoped(scope)
      .join(dimension.table, `${dimension.table}.id`, dimension.column)
      .andWhere("transactions.type", "EXPENSE")
      .select(
        `${dimension.column} as dimension_id`,
        `${dimension.label} as dimension_name`,
        this.knex.raw("COALESCE(SUM(transactions.net_amount), 0) AS amount"),
      )
      .groupBy(dimension.column, dimension.label)
      .orderBy("amount", "desc")) as {
      dimension_id: string;
      dimension_name: string;
      amount: string;
    }[];

    const total = rows.reduce((sum, row) => sum + num(row.amount), 0);

    return rows.map((row) => ({
      dimensionId: row.dimension_id,
      dimensionName: row.dimension_name,
      amount: num(row.amount),
      percent: percentOf(num(row.amount), total),
    }));
  }
}
