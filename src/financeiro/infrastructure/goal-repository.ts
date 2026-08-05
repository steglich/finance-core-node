import type { Goal, GoalContribution } from "../domain/goal.js";
import type { QueryExecutor } from "./account-repository.js";

/**
 * Repository interface for the Goal aggregate root.
 * Every method is scoped by companyId (multi-tenancy invariant).
 */
export interface GoalRepository {
  /**
   * Runs `work` inside one database transaction, so a contribution row and the
   * goal's cached current amount are written together or not at all.
   */
  runAtomic<T>(work: (executor: QueryExecutor) => Promise<T>): Promise<T>;

  create(goal: Goal, executor?: QueryExecutor): Promise<void>;

  findById(companyId: string, id: string): Promise<Goal | null>;

  findByCompany(companyId: string, includeClosed?: boolean): Promise<Goal[]>;

  update(goal: Goal, executor?: QueryExecutor): Promise<void>;

  /**
   * Persists a contribution. Call it inside the same database transaction as the
   * goal update, so `current_amount` and the contributions never disagree.
   */
  addContribution(
    contribution: GoalContribution,
    executor?: QueryExecutor,
  ): Promise<void>;

  findContributions(
    companyId: string,
    goalId: string,
  ): Promise<GoalContribution[]>;
}
