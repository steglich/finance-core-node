import type { Knex } from "knex";
import { Budget, type BudgetStatus } from "../domain/budget.js";
import { Money } from "../domain/money.js";
import { Period } from "../domain/period.js";
import type { QueryExecutor } from "./account-repository.js";
import type { BudgetRepository } from "./budget-repository.js";

function toBudget(row: Record<string, unknown>): Budget {
  const currency = row.currency as string;

  return new Budget({
    id: row.id as string,
    companyId: row.company_id as string,
    categoryId: row.category_id as string,
    period: Period.create(
      new Date(row.period_start as string),
      new Date(row.period_end as string),
    ),
    plannedAmount: Money.fromDecimalString(
      String(row.planned_amount ?? "0"),
      currency,
    ),
    currency,
    status: row.status as BudgetStatus,
    exceededNotified: Boolean(row.exceeded_notified),
    actualAmount:
      row.actual_amount === null || row.actual_amount === undefined
        ? undefined
        : Money.fromDecimalString(String(row.actual_amount), currency),
    closedAt: row.closed_at ? new Date(row.closed_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
  });
}

/**
 * Knex-based implementation of BudgetRepository.
 *
 * The frozen actual amount only exists once the period closes; while the period
 * is open, `actualAmount()` recomputes it from the transactions themselves.
 */
export class KnexBudgetRepository implements BudgetRepository {
  constructor(private readonly knex: Knex) {}

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.knex;
  }

  private toRow(budget: Budget): Record<string, unknown> {
    return {
      company_id: budget.companyId,
      category_id: budget.categoryId,
      period_start: budget.period.startDate,
      period_end: budget.period.endDate,
      planned_amount: budget.plannedAmount.toDecimalString(),
      currency: budget.currency,
      status: budget.status,
      exceeded_notified: budget.exceededNotified,
      actual_amount: budget.frozenActualAmount?.toDecimalString() ?? null,
      closed_at: budget.closedAt ?? null,
    };
  }

  async create(budget: Budget, executor?: QueryExecutor): Promise<void> {
    await this.executor(executor)("budgets").insert({
      id: budget.id,
      ...this.toRow(budget),
      created_at: budget.createdAt,
      updated_at: new Date(),
    });
  }

  async findById(companyId: string, id: string): Promise<Budget | null> {
    const row = await this.knex("budgets")
      .where({ id, company_id: companyId })
      .first();

    return row ? toBudget(row as Record<string, unknown>) : null;
  }

  async findByCompanyAndPeriod(
    companyId: string,
    period?: { start: Date; end: Date },
    includeInactive = false,
  ): Promise<Budget[]> {
    const query = this.knex("budgets")
      .where("company_id", companyId)
      .orderBy("period_start", "desc");

    if (period) {
      // Overlap, not containment: a budget counts for a window it touches.
      query
        .andWhere("period_start", "<=", period.end)
        .andWhere("period_end", ">=", period.start);
    }

    if (!includeInactive) {
      query.whereIn("status", ["ACTIVE", "CLOSED"]);
    }

    const rows = (await query) as Record<string, unknown>[];
    return rows.map(toBudget);
  }

  async findActiveByCategory(
    companyId: string,
    categoryIds: readonly string[],
  ): Promise<Budget[]> {
    if (categoryIds.length === 0) {
      return [];
    }

    const rows = (await this.knex("budgets")
      .where({ company_id: companyId, status: "ACTIVE" })
      .whereIn("category_id", [...categoryIds])) as Record<string, unknown>[];

    return rows.map(toBudget);
  }

  async findPeriodsToClose(referenceDate: Date): Promise<Budget[]> {
    const rows = (await this.knex("budgets")
      .where("status", "ACTIVE")
      .andWhere("period_end", "<", referenceDate)
      .orderBy("period_end", "asc")) as Record<string, unknown>[];

    return rows.map(toBudget);
  }

  async existsOverlapping(
    companyId: string,
    categoryId: string,
    period: { start: Date; end: Date },
    excludeBudgetId?: string,
  ): Promise<boolean> {
    const query = this.knex("budgets")
      .where({
        company_id: companyId,
        category_id: categoryId,
        status: "ACTIVE",
      })
      .andWhere("period_start", "<=", period.end)
      .andWhere("period_end", ">=", period.start);

    if (excludeBudgetId) {
      query.andWhereNot("id", excludeBudgetId);
    }

    const row = await query.first();
    return row !== undefined && row !== null;
  }

  async update(budget: Budget, executor?: QueryExecutor): Promise<void> {
    const { company_id: _companyId, ...row } = this.toRow(budget);

    await this.executor(executor)("budgets")
      .where({ id: budget.id, company_id: budget.companyId })
      .update({ ...row, updated_at: new Date() });
  }

  /**
   * Sums the confirmed expenses of the budget's category and every descendant
   * inside the period. Cancelled and refunded transactions are excluded by the
   * status filter.
   */
  async actualAmount(budget: Budget): Promise<Money> {
    const result = await this.knex.raw(
      `WITH RECURSIVE scope AS (
         SELECT id
           FROM categories
          WHERE id = ? AND company_id = ?
         UNION ALL
         SELECT c.id
           FROM categories c
           JOIN scope s ON c.parent_id = s.id
          WHERE c.company_id = ?
       )
       SELECT COALESCE(SUM(t.net_amount), 0) AS total
         FROM transactions t
        WHERE t.company_id = ?
          AND t.type = 'EXPENSE'
          AND t.status = 'CONFIRMED'
          AND t.date >= ?
          AND t.date <= ?
          AND t.category_id IN (SELECT id FROM scope)`,
      [
        budget.categoryId,
        budget.companyId,
        budget.companyId,
        budget.companyId,
        budget.period.startDate,
        budget.period.endDate,
      ],
    );

    const rows = (result as { rows?: { total: string }[] }).rows ?? [];
    return Money.fromDecimalString(
      String(rows[0]?.total ?? "0"),
      budget.currency,
    );
  }
}
