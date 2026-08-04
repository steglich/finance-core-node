import type { Logger } from "./logger.js";

/**
 * Database connection interface.
 * Concrete implementations will use Knex, Drizzle, or other query builders after approval.
 */
export interface DatabaseConnection {
  /**
   * Executes a raw SQL query.
   */
  raw(query: string, params?: unknown[]): Promise<unknown[]>;

  /**
   * Starts a transaction.
   */
  transaction<T>(fn: (trx: Transaction) => Promise<T>): Promise<T>;

  /**
   * Checks if the connection is alive.
   */
  isConnected(): Promise<boolean>;

  /**
   * Closes the connection.
   */
  close(): Promise<void>;
}

/**
 * Transaction interface for atomic operations.
 */
export interface Transaction {
  /**
   * Executes a raw SQL query within the transaction.
   */
  raw(query: string, params?: unknown[]): Promise<unknown[]>;

  /**
   * Commits the transaction.
   */
  commit(): Promise<void>;

  /**
   * Rolls back the transaction.
   */
  rollback(): Promise<void>;
}

/**
 * Creates a database connection from environment configuration.
 * Uses DATABASE_URL environment variable.
 */
export function createDatabaseConnection(): DatabaseConnection {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  // This will be implemented with Knex after approval
  return new NoOpDatabaseConnection(databaseUrl);
}

/**
 * No-op implementation for development before database dependency is approved.
 */
class NoOpDatabaseConnection implements DatabaseConnection {
  private readonly url: string;
  private _isConnected = false;

  constructor(url: string) {
    this.url = url;
  }

  async raw(_query: string, _params?: unknown[]): Promise<unknown[]> {
    throw new Error(
      "Database not configured. Install Knex after dependency approval.",
    );
  }

  async transaction<T>(_fn: (trx: Transaction) => Promise<T>): Promise<T> {
    throw new Error(
      "Database not configured. Install Knex after dependency approval.",
    );
  }

  async isConnected(): Promise<boolean> {
    return this._isConnected;
  }

  async close(): Promise<void> {
    this._isConnected = false;
  }
}
