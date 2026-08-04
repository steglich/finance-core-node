import type { AggregateRoot } from "./aggregate-root.js";

/**
 * Filter criteria for repository queries.
 */
export type RepositoryFilter<T> = {
  [K in keyof T]?: T[K];
};

/**
 * Pagination options for repository queries.
 */
export type PaginationOptions = {
  limit?: number;
  offset?: number;
};

/**
 * Base interface for repositories with automatic companyId filtering.
 * All implementations must filter by companyId to ensure multi-tenancy isolation.
 */
export interface BaseRepository<
  T extends AggregateRoot<string>,
  TId extends string = string,
> {
  /**
   * The company ID this repository filters by.
   */
  readonly companyId: string;

  /**
   * Finds an entity by its ID.
   */
  findById(id: TId): Promise<T | null>;

  /**
   * Finds all entities matching the filter criteria.
   */
  findMany(filter?: RepositoryFilter<T>): Promise<T[]>;

  /**
   * Finds all entities with pagination support.
   */
  findManyPaginated(
    filter: RepositoryFilter<T>,
    options: PaginationOptions,
  ): Promise<{ items: T[]; total: number }>;

  /**
   * Saves an entity (create or update).
   */
  save(entity: T): Promise<void>;

  /**
   * Removes an entity (soft delete recommended for audit trail).
   */
  remove(id: TId): Promise<void>;
}
