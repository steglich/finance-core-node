import type { Card } from "../domain/card.js";
import type { Money } from "../domain/money.js";
import type { QueryExecutor } from "./account-repository.js";

/**
 * Repository interface for the Card entity.
 * Every method is scoped by companyId (multi-tenancy invariant).
 */
export interface CardRepository {
  create(card: Card, executor?: QueryExecutor): Promise<void>;

  findById(companyId: string, id: string): Promise<Card | null>;

  findByCompany(companyId: string, includeInactive?: boolean): Promise<Card[]>;

  findByAccount(companyId: string, accountId: string): Promise<Card[]>;

  update(card: Card, executor?: QueryExecutor): Promise<void>;

  /**
   * Amount already charged to the card and not yet settled: confirmed purchases
   * of the open cycle plus the outstanding balance of unpaid invoices.
   *
   * The available limit is derived from this — it is never persisted (RN-02).
   * Pass `lockForUpdate` inside the transaction that inserts a purchase so the
   * limit check and the insert cannot interleave.
   */
  committedAmount(
    companyId: string,
    cardId: string,
    options?: { executor?: QueryExecutor; lockForUpdate?: boolean },
  ): Promise<Money>;

  /**
   * Number of active cards bound to an account; blocks account deactivation.
   */
  countActiveByAccount(companyId: string, accountId: string): Promise<number>;
}
