import type { Knex } from "knex";
import type { Account, AccountEntry } from "../domain/account.js";
import type { Money } from "../domain/money.js";

/**
 * Executor used to run a query either on the pool or inside an open
 * database transaction (used by transfers, which must be atomic — RN-04).
 */
export type QueryExecutor = Knex | Knex.Transaction;

/**
 * Repository interface for the Account aggregate root.
 * Every method is scoped by companyId (multi-tenancy invariant).
 */
export interface AccountRepository {
  create(account: Account, executor?: QueryExecutor): Promise<void>;

  findById(companyId: string, id: string): Promise<Account | null>;

  findByCompanyId(companyId: string, includeInactive?: boolean): Promise<Account[]>;

  findByWalletId(companyId: string, walletId: string): Promise<Account[]>;

  /**
   * Persists the mutable non-monetary fields. The balance is never written from
   * a stale in-memory value — use applyMovement() for that (RN-02).
   */
  update(account: Account, executor?: QueryExecutor): Promise<void>;

  /**
   * Applies a confirmed movement to the balance with a single atomic UPDATE,
   * so concurrent postings cannot lose each other's increments.
   * Returns the balance after the movement.
   */
  applyMovement(
    companyId: string,
    entry: AccountEntry,
    executor?: QueryExecutor,
  ): Promise<Money>;

  /**
   * Confirmed entries of an account, used to recompute the balance (RN-02).
   */
  listConfirmedEntries(
    companyId: string,
    accountId: string,
  ): Promise<AccountEntry[]>;

  /**
   * Number of transactions still pending on the account; blocks deactivation.
   */
  countPendingTransactions(
    companyId: string,
    accountId: string,
  ): Promise<number>;

  deactivate(companyId: string, id: string): Promise<boolean>;
}
