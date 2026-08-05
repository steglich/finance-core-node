import type { QueryExecutor } from "../../financeiro/infrastructure/account-repository.js";
import type { Charge, ChargeStatus } from "../domain/charge.js";

/**
 * Filters accepted when listing charges.
 */
export interface ChargeFilter {
  personId?: string | undefined;
  status?: ChargeStatus | undefined;
  dueFrom?: Date | undefined;
  dueTo?: Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * The frozen record of a settlement: what was actually charged on the day the
 * money came in.
 */
export interface ChargeReceiptRecord {
  id: string;
  chargeId: string;
  transactionId: string;
  accountId: string;
  amount: string;
  penaltyAmount: string;
  interestAmount: string;
  receivedAt: Date;
}

/**
 * Repository interface for the Charge aggregate root.
 * Every method is scoped by companyId (multi-tenancy invariant).
 */
export interface ChargeRepository {
  create(charge: Charge, executor?: QueryExecutor): Promise<void>;

  findById(companyId: string, id: string): Promise<Charge | null>;

  findByCompany(
    companyId: string,
    filter?: ChargeFilter,
  ): Promise<{ items: Charge[]; total: number }>;

  /**
   * Persists the charge, guarded by the status it is allowed to move from.
   * Implementations MUST emit a conditional UPDATE and reject when it matches
   * no row — that is what stops a charge being settled twice under concurrency.
   */
  update(charge: Charge, executor?: QueryExecutor): Promise<void>;

  /**
   * Charges still ISSUED whose due date is earlier than `referenceDate`.
   * Feeds the daily overdue pass.
   */
  findOverdueCandidates(referenceDate: Date): Promise<Charge[]>;

  /**
   * Whether the person has charges that are neither paid nor cancelled.
   */
  hasOpenCharges(companyId: string, personId: string): Promise<number>;

  registerReceipt(
    receipt: ChargeReceiptRecord,
    executor?: QueryExecutor,
  ): Promise<void>;

  /**
   * Whether the transaction was created by settling a charge.
   */
  isReceiptTransaction(
    companyId: string,
    transactionId: string,
  ): Promise<boolean>;

  listReceipts(
    companyId: string,
    chargeId: string,
  ): Promise<ChargeReceiptRecord[]>;
}
