import type { Knex } from "knex";
import { Goal, GoalContribution, type GoalStatus } from "../domain/goal.js";
import { Money } from "../domain/money.js";
import type { QueryExecutor } from "./account-repository.js";
import type { GoalRepository } from "./goal-repository.js";

function toGoal(row: Record<string, unknown>): Goal {
  const currency = row.currency as string;

  return new Goal({
    id: row.id as string,
    companyId: row.company_id as string,
    accountId: row.account_id as string,
    name: row.name as string,
    targetAmount: Money.fromDecimalString(
      String(row.target_amount ?? "0"),
      currency,
    ),
    currentAmount: Money.fromDecimalString(
      String(row.current_amount ?? "0"),
      currency,
    ),
    currency,
    deadline: new Date(row.deadline as string),
    status: row.status as GoalStatus,
    achievedAt: row.achieved_at
      ? new Date(row.achieved_at as string)
      : undefined,
    contributionCount: Number(row.contribution_count ?? 0),
    createdAt: new Date(row.created_at as string),
  });
}

function toContribution(
  row: Record<string, unknown>,
  currency: string,
): GoalContribution {
  return new GoalContribution({
    id: row.id as string,
    goalId: row.goal_id as string,
    amount: Money.fromDecimalString(String(row.amount ?? "0"), currency),
    contributedAt: new Date(row.contributed_at as string),
    transactionId: (row.transaction_id as string | null) ?? undefined,
  });
}

/**
 * Knex-based implementation of GoalRepository.
 *
 * The contribution count is not a column: it is counted from
 * `goal_contributions` on every read, so it can never drift from the rows.
 */
export class KnexGoalRepository implements GoalRepository {
  constructor(private readonly knex: Knex) {}

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.knex;
  }

  async runAtomic<T>(
    work: (executor: QueryExecutor) => Promise<T>,
  ): Promise<T> {
    return this.knex.transaction(async (trx) => work(trx));
  }

  private baseQuery(companyId: string): Knex.QueryBuilder {
    return this.knex("goals")
      .where("goals.company_id", companyId)
      .select(
        "goals.*",
        this.knex.raw(
          "(SELECT COUNT(*) FROM goal_contributions gc WHERE gc.goal_id = goals.id) AS contribution_count",
        ),
      );
  }

  async create(goal: Goal, executor?: QueryExecutor): Promise<void> {
    await this.executor(executor)("goals").insert({
      id: goal.id,
      company_id: goal.companyId,
      account_id: goal.accountId,
      name: goal.name,
      target_amount: goal.targetAmount.toDecimalString(),
      current_amount: goal.currentAmount.toDecimalString(),
      currency: goal.currency,
      deadline: goal.deadline,
      status: goal.status,
      achieved_at: goal.achievedAt ?? null,
      created_at: goal.createdAt,
      updated_at: new Date(),
    });
  }

  async findById(companyId: string, id: string): Promise<Goal | null> {
    const row = await this.baseQuery(companyId).andWhere("goals.id", id).first();
    return row ? toGoal(row as Record<string, unknown>) : null;
  }

  async findByCompany(companyId: string, includeClosed = true): Promise<Goal[]> {
    const query = this.baseQuery(companyId).orderBy("goals.deadline", "asc");

    if (!includeClosed) {
      query.whereIn("goals.status", ["CREATED", "IN_PROGRESS"]);
    }

    const rows = (await query) as Record<string, unknown>[];
    return rows.map(toGoal);
  }

  async update(goal: Goal, executor?: QueryExecutor): Promise<void> {
    await this.executor(executor)("goals")
      .where({ id: goal.id, company_id: goal.companyId })
      .update({
        name: goal.name,
        target_amount: goal.targetAmount.toDecimalString(),
        current_amount: goal.currentAmount.toDecimalString(),
        deadline: goal.deadline,
        status: goal.status,
        achieved_at: goal.achievedAt ?? null,
        updated_at: new Date(),
      });
  }

  async addContribution(
    contribution: GoalContribution,
    executor?: QueryExecutor,
  ): Promise<void> {
    await this.executor(executor)("goal_contributions").insert({
      id: contribution.id,
      goal_id: contribution.goalId,
      transaction_id: contribution.transactionId ?? null,
      amount: contribution.amount.toDecimalString(),
      contributed_at: contribution.contributedAt,
    });
  }

  async findContributions(
    companyId: string,
    goalId: string,
  ): Promise<GoalContribution[]> {
    const rows = (await this.knex("goal_contributions")
      .join("goals", "goals.id", "goal_contributions.goal_id")
      .where({
        "goal_contributions.goal_id": goalId,
        "goals.company_id": companyId,
      })
      .select("goal_contributions.*", "goals.currency as currency")
      .orderBy("goal_contributions.contributed_at", "asc")) as Record<
      string,
      unknown
    >[];

    return rows.map((row) => toContribution(row, row.currency as string));
  }
}
