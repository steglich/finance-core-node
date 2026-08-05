import type { QueryExecutor } from "../../financeiro/infrastructure/account-repository.js";
import type { Payable, PayableStatus } from "../domain/payable.js";

/**
 * Filters accepted when listing payables.
 */
export interface PayableFilter {
  personId?: string | undefined;
  categoryId?: string | undefined;
  costCenterId?: string | undefined;
  status?: PayableStatus | undefined;
  dueFrom?: Date | undefined;
  dueTo?: Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * The record of a settlement.
 */
export interface PayablePaymentRecord {
  id: string;
  payableId: string;
  transactionId: string;
  accountId: string;
  amount: string;
  paidAt: Date;
}

/**
 * Repository interface for the Payable aggregate root.
 * Every method is scoped by companyId (multi-tenancy invariant).
 */
export interface PayableRepository {
  create(payable: Payable, executor?: QueryExecutor): Promise<void>;

  findById(companyId: string, id: string): Promise<Payable | null>;

  /**
   * Lists payables ordered by due date ascending — the order the supplier
   * ledger and the payment queue both want.
   */
  findByCompany(
    companyId: string,
    filter?: PayableFilter,
  ): Promise<{ items: Payable[]; total: number }>;

  /**
   * Persists the payable, guarded by the status it is allowed to move from.
   * Implementations MUST reject an update that matches no row.
   */
  update(payable: Payable, executor?: QueryExecutor): Promise<void>;

  /**
   * Payables still PENDING whose due date is earlier than `referenceDate`.
   */
  findOverdueCandidates(referenceDate: Date): Promise<Payable[]>;

  /**
   * Whether the person has payables that are neither paid nor cancelled.
   */
  hasOpenPayables(companyId: string, personId: string): Promise<number>;

  registerPayment(
    payment: PayablePaymentRecord,
    executor?: QueryExecutor,
  ): Promise<void>;

  /**
   * Whether the transaction was created by settling a payable.
   */
  isPaymentTransaction(
    companyId: string,
    transactionId: string,
  ): Promise<boolean>;

  listPayments(
    companyId: string,
    payableId: string,
  ): Promise<PayablePaymentRecord[]>;
}
