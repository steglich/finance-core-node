import type { QueryExecutor } from "../../financeiro/infrastructure/account-repository.js";

/**
 * Direction of a PIX movement, from the company's point of view.
 */
export type PixDirection = "SENT" | "RECEIVED";

/**
 * A PIX movement, recorded alongside the transaction it produced.
 *
 * It lives in its own table rather than as columns on `transactions`: payment
 * method details would be null on nearly every transaction row and would invite
 * the table to become a dumping ground for every future method.
 */
export interface PixPaymentRecord {
  id: string;
  companyId: string;
  transactionId: string;
  direction: PixDirection;
  pixKey: string;
  personId?: string | undefined;
  bankAccountId?: string | undefined;
  chargeId?: string | undefined;
  occurredAt: Date;
}

/**
 * Repository interface for PIX records.
 * Every method is scoped by companyId (multi-tenancy invariant).
 */
export interface PixRepository {
  create(record: PixPaymentRecord, executor?: QueryExecutor): Promise<void>;

  findById(companyId: string, id: string): Promise<PixPaymentRecord | null>;

  findByCompany(
    companyId: string,
    filter?: {
      direction?: PixDirection | undefined;
      personId?: string | undefined;
      from?: Date | undefined;
      to?: Date | undefined;
    },
  ): Promise<PixPaymentRecord[]>;
}
