import type { Recurrence, RecurrenceStatus } from "../domain/recurrence.js";
import type { QueryExecutor } from "./account-repository.js";

/**
 * Filters accepted when listing recurrences.
 */
export interface RecurrenceFilter {
  status?: RecurrenceStatus | undefined;
  accountId?: string | undefined;
  categoryId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * Repository interface for the Recurrence aggregate root.
 * Every method is scoped by companyId (multi-tenancy invariant).
 */
export interface RecurrenceRepository {
  create(recurrence: Recurrence, executor?: QueryExecutor): Promise<void>;

  findById(companyId: string, id: string): Promise<Recurrence | null>;

  findMany(
    companyId: string,
    filter?: RecurrenceFilter,
  ): Promise<{ items: Recurrence[]; total: number }>;

  /**
   * Active recurrences of every company, used by the scheduler.
   */
  findActive(): Promise<Recurrence[]>;

  update(recurrence: Recurrence, executor?: QueryExecutor): Promise<void>;
}
