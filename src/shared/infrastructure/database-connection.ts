import type { Logger } from "./logger.js";
import knexLib from "knex";
import type { Knex } from "knex";

/**
 * Database connection interface.
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

  /**
   * Returns the Knex instance for advanced queries.
   */
  getKnex(): Knex;
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
 * Transport security for the database connection.
 *
 * `false` disables TLS entirely and is only appropriate for a local socket.
 * `{ rejectUnauthorized: true }` requires the server certificate to verify
 * against a trusted CA; `false` encrypts without verifying, which stops passive
 * capture but not an active man in the middle.
 */
export type DatabaseSslConfig = false | { rejectUnauthorized: boolean };

/**
 * Reads the transport configuration from the environment.
 *
 * Kept explicit instead of letting the connection string decide: `sslmode` in a
 * URL is easy to drop when copying between environments, and the failure is
 * silent — the connection just goes plaintext.
 *
 * - `DATABASE_SSL=false` — no TLS (local development)
 * - `DATABASE_SSL_REJECT_UNAUTHORIZED=false` — TLS without certificate
 *   verification, for a managed database presenting a self-signed certificate
 *
 * Both default to the strict setting, so an unconfigured deployment fails
 * closed rather than open.
 */
export function resolveDatabaseSsl(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseSslConfig {
  if (env.DATABASE_SSL === "false") {
    return false;
  }

  return {
    rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
  };
}

/**
 * Creates a database connection from environment configuration.
 * Uses DATABASE_URL environment variable.
 */
export function createDatabaseConnection(logger: Logger): DatabaseConnection {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  return new KnexDatabaseConnection(databaseUrl, logger, resolveDatabaseSsl());
}

/**
 * Knex-based implementation of DatabaseConnection.
 */
class KnexDatabaseConnection implements DatabaseConnection {
  private readonly knex: Knex;
  private _isConnected = false;

  constructor(
    databaseUrl: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _logger: Logger,
    ssl: DatabaseSslConfig,
  ) {
    this.knex = knexLib({
      client: "pg",
      // The connection string is passed as an object so `ssl` wins over
      // whatever `sslmode` the URL happens to carry.
      connection: { connectionString: databaseUrl, ssl },
      migrations: {
        directory: "./migrations",
        tableName: "knex_migrations",
      },
    });
  }

  async raw(query: string, params?: unknown[]): Promise<unknown[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await this.knex.raw(query, params as any);
    if (Array.isArray(result)) {
      return (result[0] as unknown[] | undefined) ?? [];
    }
    return ((result as { rows?: unknown[] }).rows as unknown[]) ?? [];
  }

  async transaction<T>(fn: (trx: Transaction) => Promise<T>): Promise<T> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.knex.transaction(async (trx: any) => {
      const tx: Transaction = {
        raw: async (query: string, params?: unknown[]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result: any = await trx.raw(query, params);
          if (Array.isArray(result)) {
            return (result[0] as unknown[] | undefined) ?? [];
          }
          return ((result as { rows?: unknown[] }).rows as unknown[]) ?? [];
        },
        commit: async () => {
          // Knex handles commit automatically on successful resolution
        },
        rollback: async () => {
          throw new Error("Manual rollback triggered");
        },
      };
      return fn(tx);
    }) as Promise<T>;
  }

  async isConnected(): Promise<boolean> {
    try {
      await this.knex.raw("SELECT 1");
      this._isConnected = true;
      return true;
    } catch {
      this._isConnected = false;
      return false;
    }
  }

  async close(): Promise<void> {
    await this.knex.destroy();
    this._isConnected = false;
  }

  getKnex(): Knex {
    return this.knex;
  }
}
