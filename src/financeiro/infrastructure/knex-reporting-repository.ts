import type { Knex } from "knex";
import { addMonths, toUtcDate } from "../domain/date-math.js";
import { Percent } from "../domain/percent.js";
import { Money } from "../domain/money.js";
import {
  amountsDueFor,
  daysLate,
} from "../../pagamentos/domain/charge-math.js";
import type {
  BudgetSummary,
  DebtSummary,
  IncomeTaxData,
  InvestmentReportRow,
  InvestmentsSummary,
  CostCenterReportRow,
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

function round2(value: number): number {
  return Number(value.toFixed(2));
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

    // The filter descends the tree: asking for "Marketing" includes everything
    // charged to its children.
    if (scope.costCenterIds && scope.costCenterIds.length > 0) {
      query.whereIn(
        "transactions.cost_center_id",
        this.costCenterScope(scope.companyId, scope.costCenterIds),
      );
    }

    return query;
  }

  /**
   * Subquery listing the given cost centers and every descendant of theirs.
   */
  private costCenterScope(
    companyId: string,
    costCenterIds: readonly string[],
  ): Knex.QueryBuilder {
    return this.knex
      .withRecursive("scope", (builder) => {
        builder
          .select("id")
          .from("cost_centers")
          .whereIn("id", [...costCenterIds])
          .andWhere("company_id", companyId)
          .unionAll((union) =>
            union
              .select("cc.id")
              .from("cost_centers as cc")
              .join("scope as s", "cc.parent_id", "s.id")
              .where("cc.company_id", companyId),
          );
      })
      .select("id")
      .from("scope");
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
   * Confirmed expenses by cost center, with each subtree rolled up into its
   * root: a child's spending shows under the parent, which is what makes the
   * report add up to the period total.
   *
   * Transactions with no cost center are kept as their own group rather than
   * dropped — leaving them out would make the report disagree with the period
   * indicators.
   */
  async spendingByCostCenter(
    scope: ReportingScope,
  ): Promise<CostCenterReportRow[]> {
    const rows = (await this.scoped(scope)
      .andWhere("transactions.type", "EXPENSE")
      .leftJoin(
        "cost_centers",
        "cost_centers.id",
        "transactions.cost_center_id",
      )
      .select(
        "transactions.cost_center_id as cost_center_id",
        "cost_centers.name as cost_center_name",
        "cost_centers.parent_id as parent_id",
        this.knex.raw("COALESCE(SUM(transactions.net_amount), 0) AS amount"),
      )
      .groupBy(
        "transactions.cost_center_id",
        "cost_centers.name",
        "cost_centers.parent_id",
      )) as {
      cost_center_id: string | null;
      cost_center_name: string | null;
      parent_id: string | null;
      amount: string;
    }[];

    // The whole tree is needed to roll a grandchild all the way up, even when
    // the intermediate node had no spending of its own.
    const tree = (await this.knex("cost_centers")
      .where("company_id", scope.companyId)
      .select("id", "name", "parent_id")) as {
      id: string;
      name: string;
      parent_id: string | null;
    }[];

    const parentOf = new Map<string, string | null>();
    const nameOf = new Map<string, string>();
    for (const node of tree) {
      parentOf.set(node.id, node.parent_id);
      nameOf.set(node.id, node.name);
    }

    const own = new Map<string | null, number>();
    for (const row of rows) {
      own.set(row.cost_center_id, num(row.amount));
    }

    const totals = new Map<string | null, number>();
    for (const [id, amount] of own) {
      totals.set(id, (totals.get(id) ?? 0) + amount);

      // Walk up, guarding against a cycle in stored data.
      const seen = new Set<string>(id === null ? [] : [id]);
      let parent = id === null ? null : (parentOf.get(id) ?? null);
      while (parent !== null && !seen.has(parent)) {
        seen.add(parent);
        totals.set(parent, (totals.get(parent) ?? 0) + amount);
        parent = parentOf.get(parent) ?? null;
      }
    }

    const grandTotal = [...own.values()].reduce((sum, value) => sum + value, 0);

    const result: CostCenterReportRow[] = [...totals.entries()].map(
      ([id, total]) => ({
        costCenterId: id,
        costCenterName:
          id === null ? "Sem classificação" : (nameOf.get(id) ?? "—"),
        ownAmount: own.get(id) ?? 0,
        totalAmount: total,
        percent: percentOf(total, grandTotal),
      }),
    );

    return result.sort((a, b) => b.totalAmount - a.totalAmount);
  }

  async receivablesSummary(
    scope: ReportingScope,
  ): Promise<ReceivablesSummary> {
    const open = (await this.knex("charges")
      .where("company_id", scope.companyId)
      .whereIn("status", ["ISSUED", "OVERDUE"])
      .andWhere("due_date", ">=", scope.start)
      .andWhere("due_date", "<=", scope.end)
      .select(
        "id",
        "status",
        "due_date",
        "amount",
        "currency",
        "penalty_percent",
        "monthly_interest_percent",
      )) as Record<string, unknown>[];

    const received = (await this.knex("charge_receipts as r")
      .join("charges as c", "c.id", "r.charge_id")
      .where("c.company_id", scope.companyId)
      .andWhere("r.received_at", ">=", scope.start)
      .andWhere("r.received_at", "<=", scope.end)
      .sum<{ total: string }[]>("r.amount as total")) as { total: string }[];

    const currency =
      (open[0]?.currency as string) ?? (await this.currencyOf(scope.companyId));

    let openTotal = 0;
    let overdueTotal = 0;
    let overdueCount = 0;
    const reference = new Date();

    for (const row of open) {
      const due = this.chargeAmountsDue(row, reference);
      openTotal += due.totalDue.amount;

      if (daysLate(new Date(row.due_date as string), reference) > 0) {
        overdueCount += 1;
        overdueTotal += due.totalDue.amount;
      }
    }

    return {
      openCount: open.length,
      openTotal: round2(openTotal),
      overdueCount,
      overdueTotal: round2(overdueTotal),
      receivedTotal: num(received[0]?.total),
      currency,
    };
  }

  async payablesSummary(scope: ReportingScope): Promise<PayablesSummary> {
    const rows = (await this.knex("payables")
      .where("company_id", scope.companyId)
      .whereIn("status", ["PENDING", "OVERDUE"])
      .andWhere("due_date", ">=", scope.start)
      .andWhere("due_date", "<=", scope.end)
      .select("status", "due_date", "amount", "currency")) as Record<
      string,
      unknown
    >[];

    const paid = (await this.knex("payable_payments as p")
      .join("payables as pa", "pa.id", "p.payable_id")
      .where("pa.company_id", scope.companyId)
      .andWhere("p.paid_at", ">=", scope.start)
      .andWhere("p.paid_at", "<=", scope.end)
      .sum<{ total: string }[]>("p.amount as total")) as { total: string }[];

    const reference = new Date();
    let openTotal = 0;
    let overdueTotal = 0;
    let overdueCount = 0;

    for (const row of rows) {
      const amount = num(row.amount);
      openTotal += amount;

      if (daysLate(new Date(row.due_date as string), reference) > 0) {
        overdueCount += 1;
        overdueTotal += amount;
      }
    }

    return {
      openCount: rows.length,
      openTotal: round2(openTotal),
      overdueCount,
      overdueTotal: round2(overdueTotal),
      paidTotal: num(paid[0]?.total),
      currency:
        (rows[0]?.currency as string) ??
        (await this.currencyOf(scope.companyId)),
    };
  }

  async receivables(
    scope: ReportingScope,
    referenceDate: Date,
  ): Promise<ReceivableReportRow[]> {
    const query = this.knex("charges as c")
      .join("people as p", "p.id", "c.person_id")
      .leftJoin("charge_receipts as r", "r.charge_id", "c.id")
      .where("c.company_id", scope.companyId)
      .andWhere("c.due_date", ">=", scope.start)
      .andWhere("c.due_date", "<=", scope.end);

    if (scope.personId) query.andWhere("c.person_id", scope.personId);
    if (scope.status) query.andWhere("c.status", scope.status);

    const rows = (await query
      .groupBy("c.id", "p.name")
      .orderBy("c.due_date", "asc")
      .select(
        "c.id",
        "c.person_id",
        "p.name as person_name",
        "c.description",
        "c.status",
        "c.due_date",
        "c.amount",
        "c.currency",
        "c.penalty_percent",
        "c.monthly_interest_percent",
      )
      .sum({ settled: "r.amount" })) as Record<string, unknown>[];

    return rows.map((row) => {
      const due = this.chargeAmountsDue(row, referenceDate);

      return {
        id: row.id as string,
        personId: row.person_id as string,
        personName: row.person_name as string,
        description: (row.description as string | null) ?? undefined,
        status: row.status as string,
        dueDate: new Date(row.due_date as string),
        amount: due.original.amount,
        charges: due.penalty.add(due.interest).amount,
        totalDue: due.totalDue.amount,
        settledAmount: num(row.settled),
      };
    });
  }

  async payables(scope: ReportingScope): Promise<ReceivableReportRow[]> {
    const query = this.knex("payables as pa")
      .join("people as p", "p.id", "pa.person_id")
      .where("pa.company_id", scope.companyId)
      .andWhere("pa.due_date", ">=", scope.start)
      .andWhere("pa.due_date", "<=", scope.end)
      .orderBy("pa.due_date", "asc");

    if (scope.costCenterIds && scope.costCenterIds.length > 0) {
      query.whereIn(
        "pa.cost_center_id",
        this.costCenterScope(scope.companyId, scope.costCenterIds),
      );
    }

    if (scope.personId) query.andWhere("pa.person_id", scope.personId);
    if (scope.categoryId) query.andWhere("pa.category_id", scope.categoryId);
    if (scope.status) query.andWhere("pa.status", scope.status);

    const rows = (await query
      .leftJoin("payable_payments as pay", "pay.payable_id", "pa.id")
      .groupBy("pa.id", "p.name")
      .select(
        "pa.id",
        "pa.person_id",
        "p.name as person_name",
        "pa.description",
        "pa.status",
        "pa.due_date",
        "pa.amount",
        "pa.category_id",
        "pa.cost_center_id",
      )
      .sum({ settled: "pay.amount" })) as Record<string, unknown>[];

    // A payable owes exactly its amount however late it is: what a supplier
    // charges for lateness arrives on their own document.
    return rows.map((row) => ({
      id: row.id as string,
      personId: row.person_id as string,
      personName: row.person_name as string,
      description: (row.description as string | null) ?? undefined,
      status: row.status as string,
      dueDate: new Date(row.due_date as string),
      amount: num(row.amount),
      charges: 0,
      totalDue: num(row.amount),
      categoryId: (row.category_id as string | null) ?? undefined,
      costCenterId: (row.cost_center_id as string | null) ?? undefined,
      settledAmount: num(row.settled),
    }));
  }

  /**
   * Penalty and interest through the very functions the domain uses, so the
   * reports cannot drift from what the charge itself would say.
   */
  private chargeAmountsDue(
    row: Record<string, unknown>,
    referenceDate: Date,
  ): ReturnType<typeof amountsDueFor> {
    const currency = (row.currency as string) ?? DEFAULT_CURRENCY;
    const open = ["ISSUED", "OVERDUE"].includes(row.status as string);
    const days = open
      ? daysLate(new Date(row.due_date as string), referenceDate)
      : 0;

    return amountsDueFor(
      Money.fromDecimalString(String(row.amount), currency),
      Percent.create(num(row.penalty_percent)),
      Percent.create(num(row.monthly_interest_percent)),
      days,
    );
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

  /* ------------------------------------------------------------------------ */
  /* Phase 4: investments and debt                                             */
  /* ------------------------------------------------------------------------ */

  /**
   * Aggregated position of every investment at a reference date, priced by the
   * quote in force at it. Summed in SQL — the operations are never hydrated.
   */
  private investmentPositions(
    companyId: string,
    referenceDate: Date,
    periodStart?: Date,
  ): Knex.QueryBuilder {
    const positions = this.knex("investment_operations as o")
      .where("o.company_id", companyId)
      .andWhere("o.operated_at", "<=", referenceDate)
      .groupBy("o.investment_id")
      .select("o.investment_id")
      .select(
        this.knex.raw(
          `
          coalesce(sum(case when o.operation_type = 'BUY' then o.quantity
                            when o.operation_type = 'SELL' then -o.quantity
                            else 0 end), 0) as quantity,
          coalesce(sum(case when o.operation_type = 'BUY' then o.amount else 0 end), 0) as bought_amount,
          coalesce(sum(case when o.operation_type = 'BUY' then o.quantity else 0 end), 0) as bought_quantity,
          coalesce(sum(case when o.operation_type = 'SELL' then o.quantity else 0 end), 0) as sold_quantity,
          coalesce(sum(case when o.operation_type = 'SELL' then o.amount else 0 end), 0) as sold_amount,
          coalesce(sum(case when o.operation_type = 'SELL' and o.operated_at >= ? then o.quantity else 0 end), 0) as sold_quantity_period,
          coalesce(sum(case when o.operation_type = 'SELL' and o.operated_at >= ? then o.amount else 0 end), 0) as sold_amount_period,
          coalesce(sum(case when o.operation_type in ('DIVIDEND', 'INTEREST', 'AMORTIZATION') then o.amount else 0 end), 0) as income_received,
          coalesce(sum(case when o.operation_type in ('DIVIDEND', 'INTEREST', 'AMORTIZATION') and o.operated_at >= ? then o.amount else 0 end), 0) as income_received_period
        `,
          [
            periodStart ?? referenceDate,
            periodStart ?? referenceDate,
            periodStart ?? referenceDate,
          ],
        ),
      )
      .as("p");

    const quotes = this.knex("investment_quotes")
      .distinctOn("investment_id")
      .where("quote_date", "<=", referenceDate)
      .orderBy("investment_id")
      .orderBy("quote_date", "desc")
      .select("investment_id", "unit_price")
      .as("q");

    return this.knex("investments as i")
      .join(positions, "p.investment_id", "i.id")
      .leftJoin(quotes, "q.investment_id", "i.id")
      .where("i.company_id", companyId)
      .select(
        "i.id",
        "i.name",
        "i.investment_type",
        "i.symbol",
        "i.currency",
        "q.unit_price",
        "p.quantity",
        "p.bought_amount",
        "p.bought_quantity",
        "p.sold_quantity",
        "p.sold_amount",
        "p.sold_quantity_period",
        "p.sold_amount_period",
        "p.income_received",
        "p.income_received_period",
      );
  }

  /**
   * Turns one aggregated row into the derived figures.
   *
   * Because the cost policy is average — not FIFO — the average cost of what
   * remains is the average cost of everything bought, so the invested amount and
   * the realized result both follow from it without replaying the operations.
   */
  private investmentLine(row: Record<string, unknown>): InvestmentReportRow {
    const quantity = num(row.quantity);
    const boughtQuantity = num(row.bought_quantity);
    const boughtAmount = num(row.bought_amount);
    const averageCost = boughtQuantity > 0 ? boughtAmount / boughtQuantity : 0;

    const investedAmount = quantity > 0 ? round2(averageCost * quantity) : 0;
    const realizedResultInPeriod = round2(
      num(row.sold_amount_period) - averageCost * num(row.sold_quantity_period),
    );
    const realizedResultTotal = round2(
      num(row.sold_amount) - averageCost * num(row.sold_quantity),
    );
    const incomeReceivedInPeriod = round2(num(row.income_received_period));
    const incomeReceivedTotal = round2(num(row.income_received));

    const unitPrice =
      row.unit_price === null || row.unit_price === undefined
        ? undefined
        : num(row.unit_price);
    const quoted = unitPrice !== undefined && unitPrice > 0;

    // Without a quote the value falls back to the cost, and the line says so —
    // zero would erase real wealth and an error would break the dashboard.
    const currentValue = quoted
      ? round2(quantity * unitPrice)
      : investedAmount;

    const profitabilityPercent =
      investedAmount === 0
        ? 0
        : round2(
            ((currentValue +
              realizedResultTotal +
              incomeReceivedTotal -
              investedAmount) /
              investedAmount) *
              100,
          );

    return {
      investmentId: row.id as string,
      name: row.name as string,
      investmentType: row.investment_type as string,
      symbol: (row.symbol as string | null) ?? undefined,
      currency: row.currency as string,
      quantity,
      averageCost: round2(averageCost),
      investedAmount,
      currentValue,
      unrealizedResult: round2(currentValue - investedAmount),
      realizedResultInPeriod,
      incomeReceivedInPeriod,
      profitabilityPercent,
      quoted,
    };
  }

  async investmentsReport(
    scope: ReportingScope,
    investmentType?: string,
  ): Promise<InvestmentReportRow[]> {
    const query = this.investmentPositions(
      scope.companyId,
      scope.end,
      scope.start,
    ).orderBy("i.name", "asc");

    if (investmentType) {
      query.andWhere("i.investment_type", investmentType);
    }
    if (scope.accountIds && scope.accountIds.length > 0) {
      query.whereIn("i.account_id", [...scope.accountIds]);
    }

    const rows = (await query) as Record<string, unknown>[];

    return rows.map((row) => this.investmentLine(row));
  }

  async investmentsSummary(scope: ReportingScope): Promise<InvestmentsSummary> {
    const lines = await this.investmentsReport(scope);
    const currency = lines[0]?.currency ?? DEFAULT_CURRENCY;

    const totals = lines.reduce(
      (accumulator, line) => ({
        investedAmount: accumulator.investedAmount + line.investedAmount,
        currentValue: accumulator.currentValue + line.currentValue,
        realizedResult:
          accumulator.realizedResult + line.realizedResultInPeriod,
        incomeReceived:
          accumulator.incomeReceived + line.incomeReceivedInPeriod,
      }),
      {
        investedAmount: 0,
        currentValue: 0,
        realizedResult: 0,
        incomeReceived: 0,
      },
    );

    const investedAmount = round2(totals.investedAmount);
    const currentValue = round2(totals.currentValue);

    const byType = new Map<string, number>();
    for (const line of lines) {
      byType.set(
        line.investmentType,
        round2((byType.get(line.investmentType) ?? 0) + line.currentValue),
      );
    }

    return {
      investedAmount,
      currentValue,
      unrealizedResult: round2(currentValue - investedAmount),
      realizedResult: round2(totals.realizedResult),
      incomeReceived: round2(totals.incomeReceived),
      profitabilityPercent:
        investedAmount === 0
          ? 0
          : round2(((currentValue - investedAmount) / investedAmount) * 100),
      // The total is only as trustworthy as its least quoted line.
      quoted: lines.every((line) => line.quoted),
      distributionByType: [...byType.entries()].map(([type, value]) => ({
        investmentType: type,
        currentValue: value,
        sharePercent: percentOf(value, currentValue),
      })),
      currency,
    };
  }

  async debtSummary(scope: ReportingScope): Promise<DebtSummary> {
    // The outstanding balance is the sum of the principal portions still open,
    // exactly what `Loan.balanceFrom` derives in the domain.
    const open = (await this.knex("loan_installments as li")
      .join("loans as l", "l.id", "li.loan_id")
      .where("l.company_id", scope.companyId)
      .whereNot("l.status", "SETTLED")
      .whereNot("li.status", "PAID")
      .first(
        this.knex.raw(
          `coalesce(sum(li.principal_amount), 0) as outstanding,
           coalesce(sum(case when li.due_date between ? and ? then li.amount else 0 end), 0) as due_in_period,
           coalesce(sum(case when li.status = 'OVERDUE' then li.amount else 0 end), 0) as overdue_amount,
           count(case when li.status = 'OVERDUE' then 1 end) as overdue_count,
           min(l.currency) as currency`,
          [scope.start, scope.end],
        ),
      )) as Record<string, unknown> | undefined;

    return {
      outstandingBalance: round2(num(open?.outstanding)),
      dueInPeriod: round2(num(open?.due_in_period)),
      overdueAmount: round2(num(open?.overdue_amount)),
      overdueCount: Number(open?.overdue_count ?? 0),
      currency: (open?.currency as string | null) ?? DEFAULT_CURRENCY,
    };
  }

  /**
   * The raw figures of the income tax report. No tax is computed: the report
   * hands over consolidated data for the taxpayer to file.
   */
  async incomeTaxData(companyId: string, year: number): Promise<IncomeTaxData> {
    const yearEnd = new Date(Date.UTC(year, 11, 31));
    const previousYearEnd = new Date(Date.UTC(year - 1, 11, 31));
    const yearStart = new Date(Date.UTC(year, 0, 1));

    const scope: ReportingScope = {
      companyId,
      start: yearStart,
      end: yearEnd,
    };

    const [current, previous] = await Promise.all([
      this.investmentsReport(scope),
      this.investmentsReport({
        companyId,
        start: new Date(Date.UTC(year - 1, 0, 1)),
        end: previousYearEnd,
      }),
    ]);

    const previousById = new Map(
      previous.map((line) => [line.investmentId, line]),
    );

    const incomeRows = (await this.knex("investment_operations as o")
      .join("investments as i", "i.id", "o.investment_id")
      .where("o.company_id", companyId)
      .whereIn("o.operation_type", ["DIVIDEND", "INTEREST", "AMORTIZATION"])
      .andWhere("o.operated_at", ">=", yearStart)
      .andWhere("o.operated_at", "<=", yearEnd)
      .groupBy("i.id", "i.name", "o.operation_type")
      .orderBy("i.name", "asc")
      .select("i.id", "i.name", "o.operation_type")
      .sum({ amount: "o.amount" })) as Record<string, unknown>[];

    const accountRows = (await this.knex("accounts as a")
      .where("a.company_id", companyId)
      .andWhere("a.is_active", true)
      .leftJoin("transactions as t", function () {
        this.on("t.account_id", "=", "a.id");
      })
      .groupBy("a.id", "a.name", "a.currency")
      .orderBy("a.name", "asc")
      .select("a.id", "a.name", "a.currency")
      .select(
        this.knex.raw(
          `coalesce(sum(case
             when t.status = 'CONFIRMED' and t.date <= ? and t.invoice_id is null
               then (case when t.type = 'INCOME' then 1 else -1 end) * t.net_amount
             else 0 end), 0) as balance`,
          [yearEnd],
        ),
      )) as Record<string, unknown>[];

    const loanRows = (await this.knex("loan_installments as li")
      .join("loans as l", "l.id", "li.loan_id")
      .where("l.company_id", companyId)
      .whereNot("l.status", "SETTLED")
      .andWhere((builder) => {
        builder
          .whereNot("li.status", "PAID")
          .orWhere("li.paid_at", ">", yearEnd);
      })
      .groupBy("l.id", "l.description", "l.currency")
      .orderBy("l.description", "asc")
      .select("l.id", "l.description", "l.currency")
      .sum({ outstanding: "li.principal_amount" })) as Record<
      string,
      unknown
    >[];

    return {
      year,
      positions: current.map((line) => {
        const before = previousById.get(line.investmentId);
        return {
          investmentId: line.investmentId,
          name: line.name,
          investmentType: line.investmentType,
          symbol: line.symbol,
          currency: line.currency,
          quantityAtYearEnd: line.quantity,
          costAtYearEnd: line.investedAmount,
          quantityAtPreviousYearEnd: before?.quantity ?? 0,
          costAtPreviousYearEnd: before?.investedAmount ?? 0,
        };
      }),
      incomeByInvestment: incomeRows.map((row) => ({
        investmentId: row.id as string,
        name: row.name as string,
        operationType: row.operation_type as string,
        amount: round2(num(row.amount)),
      })),
      realizedResults: current
        .filter((line) => line.realizedResultInPeriod !== 0)
        .map((line) => ({
          investmentId: line.investmentId,
          name: line.name,
          amount: line.realizedResultInPeriod,
        })),
      accountBalances: accountRows.map((row) => ({
        accountId: row.id as string,
        name: row.name as string,
        currency: row.currency as string,
        balance: round2(num(row.balance)),
      })),
      loanBalances: loanRows.map((row) => ({
        loanId: row.id as string,
        description: row.description as string,
        currency: row.currency as string,
        outstandingBalance: round2(num(row.outstanding)),
      })),
    };
  }
}
