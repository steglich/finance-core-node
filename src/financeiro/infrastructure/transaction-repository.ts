import type { Transaction } from "../domain/transaction.js";
import type {
  TransactionStatus,
  TransactionType,
} from "../domain/transaction.js";
import type { QueryExecutor } from "./account-repository.js";

/**
 * Filters accepted when listing transactions.
 */
export interface TransactionFilter {
  accountId?: string | undefined;
  categoryId?: string | undefined;
  type?: TransactionType | undefined;
  status?: TransactionStatus | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  transferId?: string | undefined;
  parentTransactionId?: string | undefined;
  tag?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * Metadata of a file attached to a transaction.
 */
export interface TransactionAttachment {
  id: string;
  transactionId: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: Date;
}

/**
 * Header row of a completed transfer, linking both legs (RN-04).
 */
export interface TransferRecord {
  transferId: string;
  companyId: string;
  sourceAccountId: string;
  targetAccountId: string;
  debitTransactionId: string;
  creditTransactionId: string;
  amount: string;
  currency: string;
  creditedAmount: string;
  targetCurrency: string;
  exchangeRate?: unknown;
}

/**
 * Repository interface for the Transaction aggregate root.
 * Every method is scoped by companyId (multi-tenancy invariant).
 */
export interface TransactionRepository {
  /**
   * Runs `work` inside a single database transaction so multi-step operations
   * (transfers, parceled purchases) are all-or-nothing — RN-04.
   */
  runAtomic<T>(work: (executor: QueryExecutor) => Promise<T>): Promise<T>;

  create(transaction: Transaction, executor?: QueryExecutor): Promise<void>;

  /**
   * Writes the transfer header. Call it inside runAtomic together with both legs.
   */
  recordTransfer(
    record: TransferRecord,
    executor?: QueryExecutor,
  ): Promise<void>;

  findById(companyId: string, id: string): Promise<Transaction | null>;

  findMany(
    companyId: string,
    filter?: TransactionFilter,
  ): Promise<{ items: Transaction[]; total: number }>;

  findByTransferId(companyId: string, transferId: string): Promise<Transaction[]>;

  update(transaction: Transaction, executor?: QueryExecutor): Promise<void>;

  replaceTags(
    transactionId: string,
    tags: readonly string[],
    executor?: QueryExecutor,
  ): Promise<void>;

  countByCategoryId(companyId: string, categoryId: string): Promise<number>;

  addAttachment(
    companyId: string,
    attachment: Omit<TransactionAttachment, "createdAt">,
  ): Promise<TransactionAttachment>;

  listAttachments(
    companyId: string,
    transactionId: string,
  ): Promise<TransactionAttachment[]>;

  findAttachment(
    companyId: string,
    transactionId: string,
    attachmentId: string,
  ): Promise<TransactionAttachment | null>;
}
