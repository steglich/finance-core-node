import type { Knex } from "knex";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Account, type AccountEntry, type AccountType } from "../domain/account.js";
import { Money } from "../domain/money.js";
import type {
  AccountRepository,
  QueryExecutor,
} from "./account-repository.js";

/**
 * Maps an `accounts` row into the Account aggregate.
 */
function toAccount(row: Record<string, unknown>): Account {
  const currency = row.currency as string;

  return new Account({
    id: row.id as string,
    companyId: row.company_id as string,
    walletId: row.wallet_id as string,
    name: row.name as string,
    number: row.number as string,
    type: row.type as AccountType,
    currency,
    balance: Money.fromDecimalString(String(row.balance ?? "0"), currency),
    blockedAmount: Money.fromDecimalString(
      String(row.blocked_amount ?? "0"),
      currency,
    ),
    isActive: Boolean(row.is_active),
    createdAt: new Date(row.created_at as string),
  });
}

/**
 * Knex-based implementation of AccountRepository.
 */
export class KnexAccountRepository implements AccountRepository {
  constructor(private readonly knex: Knex) {}

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.knex;
  }

  async create(account: Account, executor?: QueryExecutor): Promise<void> {
    await this.executor(executor)("accounts").insert({
      id: account.id,
      company_id: account.companyId,
      wallet_id: account.walletId,
      name: account.name,
      number: account.number,
      type: account.type,
      currency: account.currency,
      balance: account.balance.toDecimalString(),
      blocked_amount: account.blockedAmount.toDecimalString(),
      is_active: account.isActive,
      created_at: account.createdAt,
      updated_at: new Date(),
    });
  }

  async findById(companyId: string, id: string): Promise<Account | null> {
    const row = await this.knex("accounts")
      .where({ id, company_id: companyId, is_deleted: false })
      .first();

    return row ? toAccount(row as Record<string, unknown>) : null;
  }

  async findByCompanyId(
    companyId: string,
    includeInactive = false,
  ): Promise<Account[]> {
    const query = this.knex("accounts")
      .where({ company_id: companyId, is_deleted: false })
      .orderBy("name", "asc");

    if (!includeInactive) {
      query.andWhere("is_active", true);
    }

    const rows = await query;
    return rows.map((row) => toAccount(row as Record<string, unknown>));
  }

  async findByWalletId(
    companyId: string,
    walletId: string,
  ): Promise<Account[]> {
    const rows = await this.knex("accounts")
      .where({ company_id: companyId, wallet_id: walletId, is_deleted: false })
      .orderBy("name", "asc");

    return rows.map((row) => toAccount(row as Record<string, unknown>));
  }

  async update(account: Account, executor?: QueryExecutor): Promise<void> {
    await this.executor(executor)("accounts")
      .where({ id: account.id, company_id: account.companyId })
      .update({
        wallet_id: account.walletId,
        name: account.name,
        number: account.number,
        type: account.type,
        blocked_amount: account.blockedAmount.toDecimalString(),
        is_active: account.isActive,
        updated_at: new Date(),
      });
  }

  /**
   * Single-statement balance update: the new balance is computed by the database
   * from the current row, so two concurrent postings can never overwrite each
   * other with a stale in-memory value.
   */
  async applyMovement(
    companyId: string,
    entry: AccountEntry,
    executor?: QueryExecutor,
  ): Promise<Money> {
    const db = this.executor(executor);
    const delta = entry.amount.abs().toDecimalString();

    const operator = entry.direction === "CREDIT" ? "+" : "-";

    const rows = (await db("accounts")
      .where({ id: entry.accountId, company_id: companyId, is_active: true })
      .update({
        balance: db.raw(`balance ${operator} ?`, [delta]),
        updated_at: new Date(),
      })
      .returning(["balance", "currency"])) as unknown as {
      balance: string;
      currency: string;
    }[];

    const updated = rows[0];
    if (!updated) {
      throw DomainError.create(
        "ENTITY_NOT_FOUND",
        `Active account ${entry.accountId} not found for company ${companyId}`,
      );
    }

    return Money.fromDecimalString(
      String(updated.balance),
      updated.currency,
    );
  }

  async listConfirmedEntries(
    companyId: string,
    accountId: string,
  ): Promise<AccountEntry[]> {
    const rows = await this.knex("transactions")
      .where({
        company_id: companyId,
        account_id: accountId,
        status: "CONFIRMED",
      })
      .orderBy("date", "asc");

    return rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      const currency = row.currency as string;
      const netAmount = Money.fromDecimalString(
        String(row.net_amount ?? "0"),
        currency,
      );

      return {
        transactionId: row.id as string,
        accountId,
        direction: row.type === "INCOME" ? "CREDIT" : "DEBIT",
        amount: netAmount.abs(),
      } satisfies AccountEntry;
    });
  }

  async countPendingTransactions(
    companyId: string,
    accountId: string,
  ): Promise<number> {
    const result = (await this.knex("transactions")
      .where({
        company_id: companyId,
        account_id: accountId,
        status: "PENDING",
      })
      .count<{ count: string }[]>("id as count")) as { count: string }[];

    return Number(result[0]?.count ?? 0);
  }

  async deactivate(companyId: string, id: string): Promise<boolean> {
    const updated = await this.knex("accounts")
      .where({ id, company_id: companyId })
      .update({ is_active: false, updated_at: new Date() });

    return updated > 0;
  }
}
