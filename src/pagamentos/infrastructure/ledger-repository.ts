/**
 * One line of a customer's charge history.
 */
export interface CustomerLedgerEntry {
  chargeId: string;
  status: string;
  dueDate: Date;
  originalAmount: string;
  /** Penalty plus interest accrued at the reference date; zero when settled. */
  chargesAccrued: string;
  totalDue: string;
  settledAmount: string;
  settledAt?: Date | undefined;
}

/**
 * Derived view of what a customer owes. Nothing here is stored: every value is
 * computed from the charges themselves, the same discipline the account balance
 * follows.
 */
export interface CustomerLedger {
  personId: string;
  currency: string;
  outstandingTotal: string;
  lastChargeDate?: Date | undefined;
  lastChargeAmount?: string | undefined;
  history: CustomerLedgerEntry[];
}

/**
 * One line of a supplier's payable list.
 */
export interface SupplierLedgerEntry {
  payableId: string;
  status: string;
  dueDate: Date;
  amount: string;
  documentNumber?: string | undefined;
}

/**
 * Derived view of what is owed to a supplier.
 */
export interface SupplierLedger {
  personId: string;
  currency: string;
  owedTotal: string;
  overdueTotal: string;
  pending: SupplierLedgerEntry[];
}

/**
 * Read-side repository for the customer and supplier ledgers.
 * Aggregation is the database's job — no aggregate is hydrated here.
 */
export interface LedgerRepository {
  customerLedger(
    companyId: string,
    personId: string,
    referenceDate: Date,
  ): Promise<CustomerLedger>;

  supplierLedger(
    companyId: string,
    personId: string,
    referenceDate: Date,
  ): Promise<SupplierLedger>;
}
