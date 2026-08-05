import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import { ExchangeRate } from "../domain/exchange-rate.js";
import { Money } from "../domain/money.js";
import {
  Transaction,
  type TransactionStatus,
  type TransactionType,
} from "../domain/transaction.js";
import type { QueryExecutor } from "./account-repository.js";
import type {
  TransactionAttachment,
  TransactionFilter,
  TransactionRepository,
  TransferRecord,
} from "./transaction-repository.js";

interface RawExchangeRate {
  sourceCurrency: string;
  targetCurrency: string;
  rate: number;
  date: string;
}

/**
 * Rebuilds the ExchangeRate value object stored as JSON alongside the row.
 */
function toExchangeRate(value: unknown): ExchangeRate | undefined {
  if (!value) return undefined;

  const raw = (
    typeof value === "string" ? JSON.parse(value) : value
  ) as RawExchangeRate;

  return new ExchangeRate(
    raw.sourceCurrency,
    raw.targetCurrency,
    raw.rate,
    new Date(raw.date),
  );
}

function toTransaction(
  row: Record<string, unknown>,
  tags: readonly string[],
): Transaction {
  const currency = row.currency as string;

  return new Transaction({
    id: row.id as string,
    companyId: row.company_id as string,
    accountId: row.account_id as string,
    categoryId: (row.category_id as string | null) ?? undefined,
    type: row.type as TransactionType,
    status: row.status as TransactionStatus,
    grossAmount: Money.fromDecimalString(
      String(row.gross_amount ?? "0"),
      currency,
    ),
    discount: Money.fromDecimalString(String(row.discount ?? "0"), currency),
    interest: Money.fromDecimalString(String(row.interest ?? "0"), currency),
    penalty: Money.fromDecimalString(String(row.penalty ?? "0"), currency),
    currency,
    exchangeRate: toExchangeRate(row.exchange_rate),
    date: new Date(row.date as string),
    competence: new Date(row.competence as string),
    description: (row.description as string | null) ?? undefined,
    tags,
    parentTransactionId:
      (row.parent_transaction_id as string | null) ?? undefined,
    transferId: (row.transfer_id as string | null) ?? undefined,
    cardId: (row.card_id as string | null) ?? undefined,
    invoiceId: (row.invoice_id as string | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
  });
}

function toAttachment(row: Record<string, unknown>): TransactionAttachment {
  return {
    id: row.id as string,
    transactionId: row.transaction_id as string,
    filename: row.filename as string,
    mimeType: row.mime_type as string,
    size: Number(row.size ?? 0),
    url: row.url as string,
    createdAt: new Date(row.created_at as string),
  };
}

/**
 * Knex-based implementation of TransactionRepository.
 */
export class KnexTransactionRepository implements TransactionRepository {
  constructor(private readonly knex: Knex) {}

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.knex;
  }

  /**
   * Delegates to the database transaction mechanism, the strongest atomicity
   * guarantee available here (RN-04).
   */
  async runAtomic<T>(
    work: (executor: QueryExecutor) => Promise<T>,
  ): Promise<T> {
    return this.knex.transaction(async (trx) => work(trx));
  }

  private toRow(transaction: Transaction): Record<string, unknown> {
    return {
      id: transaction.id,
      company_id: transaction.companyId,
      account_id: transaction.accountId,
      category_id: transaction.categoryId ?? null,
      type: transaction.type,
      status: transaction.status,
      gross_amount: transaction.grossAmount.toDecimalString(),
      discount: transaction.discount.toDecimalString(),
      interest: transaction.interest.toDecimalString(),
      penalty: transaction.penalty.toDecimalString(),
      net_amount: transaction.netAmount.toDecimalString(),
      currency: transaction.currency,
      exchange_rate: transaction.exchangeRate
        ? JSON.stringify(transaction.exchangeRate.toJSON())
        : null,
      date: transaction.date,
      competence: transaction.competence,
      description: transaction.description ?? null,
      parent_transaction_id: transaction.parentTransactionId ?? null,
      transfer_id: transaction.transferId ?? null,
      card_id: transaction.cardId ?? null,
      invoice_id: transaction.invoiceId ?? null,
    };
  }

  async create(
    transaction: Transaction,
    executor?: QueryExecutor,
  ): Promise<void> {
    const db = this.executor(executor);

    await db("transactions").insert({
      ...this.toRow(transaction),
      created_at: transaction.createdAt,
      updated_at: new Date(),
    });

    await this.replaceTags(transaction.id, transaction.tags, db);
  }

  async recordTransfer(
    record: TransferRecord,
    executor?: QueryExecutor,
  ): Promise<void> {
    await this.executor(executor)("transfers").insert({
      id: record.transferId,
      company_id: record.companyId,
      source_account_id: record.sourceAccountId,
      target_account_id: record.targetAccountId,
      debit_transaction_id: record.debitTransactionId,
      credit_transaction_id: record.creditTransactionId,
      amount: record.amount,
      currency: record.currency,
      credited_amount: record.creditedAmount,
      target_currency: record.targetCurrency,
      exchange_rate: record.exchangeRate
        ? JSON.stringify(record.exchangeRate)
        : null,
      status: "COMPLETED",
      created_at: new Date(),
    });
  }

  async findById(companyId: string, id: string): Promise<Transaction | null> {
    const row = await this.knex("transactions")
      .where({ id, company_id: companyId })
      .first();

    if (!row) return null;

    const tags = await this.listTags([id]);
    return toTransaction(
      row as Record<string, unknown>,
      tags.get(id) ?? [],
    );
  }

  async findMany(
    companyId: string,
    filter: TransactionFilter = {},
  ): Promise<{ items: Transaction[]; total: number }> {
    const base = this.knex("transactions").where(
      "transactions.company_id",
      companyId,
    );

    if (filter.accountId) base.andWhere("account_id", filter.accountId);
    if (filter.categoryId) base.andWhere("category_id", filter.categoryId);
    if (filter.type) base.andWhere("transactions.type", filter.type);
    if (filter.status) base.andWhere("status", filter.status);
    if (filter.from) base.andWhere("date", ">=", filter.from);
    if (filter.to) base.andWhere("date", "<=", filter.to);
    if (filter.transferId) base.andWhere("transfer_id", filter.transferId);
    if (filter.parentTransactionId) {
      base.andWhere("parent_transaction_id", filter.parentTransactionId);
    }
    if (filter.cardId) base.andWhere("card_id", filter.cardId);
    if (filter.invoiceId) base.andWhere("invoice_id", filter.invoiceId);
    if (filter.tag) {
      base.whereIn(
        "transactions.id",
        this.knex("transaction_tags")
          .select("transaction_id")
          .where("name", filter.tag),
      );
    }

    const countQuery = base.clone().clearOrder();
    const countResult = (await countQuery.count<{ count: string }[]>(
      "transactions.id as count",
    )) as { count: string }[];
    const total = Number(countResult[0]?.count ?? 0);

    const rowsQuery = base
      .clone()
      .select("transactions.*")
      .orderBy("date", "desc")
      .orderBy("created_at", "desc");

    if (filter.limit !== undefined) rowsQuery.limit(filter.limit);
    if (filter.offset !== undefined) rowsQuery.offset(filter.offset);

    const rows = (await rowsQuery) as Record<string, unknown>[];
    const tags = await this.listTags(rows.map((row) => row.id as string));

    return {
      items: rows.map((row) =>
        toTransaction(row, tags.get(row.id as string) ?? []),
      ),
      total,
    };
  }

  async findByTransferId(
    companyId: string,
    transferId: string,
  ): Promise<Transaction[]> {
    const result = await this.findMany(companyId, { transferId });
    return result.items;
  }

  async update(
    transaction: Transaction,
    executor?: QueryExecutor,
  ): Promise<void> {
    const db = this.executor(executor);
    const { id: _id, company_id: _companyId, ...row } = this.toRow(transaction);

    await db("transactions")
      .where({ id: transaction.id, company_id: transaction.companyId })
      .update({ ...row, updated_at: new Date() });

    await this.replaceTags(transaction.id, transaction.tags, db);
  }

  async replaceTags(
    transactionId: string,
    tags: readonly string[],
    executor?: QueryExecutor,
  ): Promise<void> {
    const db = this.executor(executor);

    await db("transaction_tags").where("transaction_id", transactionId).del();

    if (tags.length === 0) {
      return;
    }

    await db("transaction_tags").insert(
      tags.map((name) => ({
        id: randomUUID(),
        transaction_id: transactionId,
        name,
      })),
    );
  }

  async countByCategoryId(
    companyId: string,
    categoryId: string,
  ): Promise<number> {
    const result = (await this.knex("transactions")
      .where({ company_id: companyId, category_id: categoryId })
      .count<{ count: string }[]>("id as count")) as { count: string }[];

    return Number(result[0]?.count ?? 0);
  }

  async addAttachment(
    companyId: string,
    attachment: Omit<TransactionAttachment, "createdAt">,
  ): Promise<TransactionAttachment> {
    const owned = await this.knex("transactions")
      .where({ id: attachment.transactionId, company_id: companyId })
      .first();

    if (!owned) {
      throw new Error(
        `Transaction ${attachment.transactionId} not found for company ${companyId}`,
      );
    }

    const createdAt = new Date();

    await this.knex("transaction_attachments").insert({
      id: attachment.id,
      transaction_id: attachment.transactionId,
      filename: attachment.filename,
      mime_type: attachment.mimeType,
      size: attachment.size,
      url: attachment.url,
      created_at: createdAt,
    });

    return { ...attachment, createdAt };
  }

  async listAttachments(
    companyId: string,
    transactionId: string,
  ): Promise<TransactionAttachment[]> {
    const rows = (await this.attachmentQuery(companyId, transactionId).orderBy(
      "transaction_attachments.created_at",
      "asc",
    )) as Record<string, unknown>[];

    return rows.map(toAttachment);
  }

  async findAttachment(
    companyId: string,
    transactionId: string,
    attachmentId: string,
  ): Promise<TransactionAttachment | null> {
    const row = await this.attachmentQuery(companyId, transactionId)
      .andWhere("transaction_attachments.id", attachmentId)
      .first();

    return row ? toAttachment(row as Record<string, unknown>) : null;
  }

  /**
   * Attachments are only reachable through a transaction of the company, so the
   * join keeps the tenant scope even though the table has no company column.
   */
  private attachmentQuery(
    companyId: string,
    transactionId: string,
  ): Knex.QueryBuilder {
    return this.knex("transaction_attachments")
      .join(
        "transactions",
        "transactions.id",
        "transaction_attachments.transaction_id",
      )
      .where({
        "transaction_attachments.transaction_id": transactionId,
        "transactions.company_id": companyId,
      })
      .select("transaction_attachments.*");
  }

  private async listTags(
    transactionIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const tags = new Map<string, string[]>();

    if (transactionIds.length === 0) {
      return tags;
    }

    const rows = await this.knex("transaction_tags")
      .whereIn("transaction_id", [...transactionIds])
      .orderBy("name", "asc");

    for (const raw of rows as Record<string, unknown>[]) {
      const transactionId = raw.transaction_id as string;
      const current = tags.get(transactionId) ?? [];
      current.push(raw.name as string);
      tags.set(transactionId, current);
    }

    return tags;
  }
}
