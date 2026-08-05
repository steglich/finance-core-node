import type { Loan, LoanStatus } from "../domain/loan.js";
import type { LoanInstallment } from "../domain/loan-installment.js";
import type { QueryExecutor } from "./account-repository.js";

/**
 * Filters accepted when listing loans.
 */
export interface LoanFilter {
  status?: LoanStatus | undefined;
  personId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * A payment or an extra amortization, as stored.
 */
export interface LoanPaymentRecord {
  id: string;
  companyId: string;
  loanId: string;
  loanInstallmentId?: string | undefined;
  transactionId?: string | undefined;
  accountId: string;
  paymentType: "INSTALLMENT" | "EXTRA_AMORTIZATION";
  amount: string;
  principalAmount: string;
  paidAt: Date;
}

/**
 * Repository interface for the Loan aggregate root.
 * Every method is scoped by companyId (multi-tenancy invariant).
 */
export interface LoanRepository {
  /**
   * Writes the loan together with its whole schedule — a loan without
   * installments is not a state the system should ever be able to observe.
   */
  create(
    loan: Loan,
    installments: readonly LoanInstallment[],
    executor?: QueryExecutor,
  ): Promise<void>;

  findById(companyId: string, id: string): Promise<Loan | null>;

  /**
   * Reads the loan with its row locked. Required by the extra amortization,
   * which decides which installments to settle from a summed balance
   * (design, decision 7).
   */
  findByIdForUpdate(
    companyId: string,
    id: string,
    executor: QueryExecutor,
  ): Promise<Loan | null>;

  findByCompany(
    companyId: string,
    filter?: LoanFilter,
  ): Promise<{ items: Loan[]; total: number }>;

  update(loan: Loan, executor?: QueryExecutor): Promise<void>;

  /**
   * The principal already amortized by extra amortizations, summed in SQL.
   */
  extraAmortizations(companyId: string, loanId: string): Promise<string>;

  registerPayment(
    record: LoanPaymentRecord,
    executor?: QueryExecutor,
  ): Promise<void>;

  listPayments(
    companyId: string,
    loanId: string,
  ): Promise<LoanPaymentRecord[]>;

  /**
   * Whether the transaction was created by a loan payment of this company.
   */
  isPaymentTransaction(
    companyId: string,
    transactionId: string,
  ): Promise<boolean>;
}

/**
 * Repository interface for the installments of a loan.
 */
export interface LoanInstallmentRepository {
  create(
    installments: readonly LoanInstallment[],
    executor?: QueryExecutor,
  ): Promise<void>;

  findById(companyId: string, id: string): Promise<LoanInstallment | null>;

  findByNumber(
    companyId: string,
    loanId: string,
    number: number,
  ): Promise<LoanInstallment | null>;

  listByLoan(
    companyId: string,
    loanId: string,
    executor?: QueryExecutor,
  ): Promise<LoanInstallment[]>;

  /**
   * Writes the installment with the statuses it was allowed to move from in the
   * WHERE clause, demanding exactly one row.
   *
   * Two concurrent payments of the same installment would otherwise create two
   * expense transactions — data corruption, not merely a race. The second
   * update matches zero rows, throws, and the surrounding `runAtomic` takes its
   * transaction down with it (design, decision 7).
   */
  update(
    installment: LoanInstallment,
    executor?: QueryExecutor,
  ): Promise<void>;

  /**
   * Pending installments whose due date has passed, for the scheduler.
   */
  findOverdueCandidates(referenceDate: Date): Promise<LoanInstallment[]>;
}
