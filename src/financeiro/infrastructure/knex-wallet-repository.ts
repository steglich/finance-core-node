import type { Knex } from "knex";
import { Wallet } from "../domain/wallet.js";
import type { WalletRepository } from "./wallet-repository.js";

/**
 * Maps a `wallets` row into the Wallet entity.
 */
function toWallet(row: Record<string, unknown>): Wallet {
  return new Wallet(
    row.id as string,
    row.company_id as string,
    row.name as string,
    (row.institution as string | null) ?? undefined,
    new Date(row.created_at as string),
  );
}

/**
 * Knex-based implementation of WalletRepository.
 */
export class KnexWalletRepository implements WalletRepository {
  constructor(private readonly knex: Knex) {}

  async create(wallet: Wallet): Promise<void> {
    await this.knex("wallets").insert({
      id: wallet.id,
      company_id: wallet.companyId,
      name: wallet.name,
      institution: wallet.institution ?? null,
      created_at: wallet.createdAt,
      updated_at: new Date(),
    });
  }

  async findById(companyId: string, id: string): Promise<Wallet | null> {
    const row = await this.knex("wallets")
      .where({ id, company_id: companyId })
      .first();

    return row ? toWallet(row as Record<string, unknown>) : null;
  }

  async findByCompanyId(companyId: string): Promise<Wallet[]> {
    const rows = await this.knex("wallets")
      .where("company_id", companyId)
      .orderBy("name", "asc");

    return rows.map((row) => toWallet(row as Record<string, unknown>));
  }

  async update(wallet: Wallet): Promise<void> {
    await this.knex("wallets")
      .where({ id: wallet.id, company_id: wallet.companyId })
      .update({
        name: wallet.name,
        institution: wallet.institution ?? null,
        updated_at: new Date(),
      });
  }

  async delete(companyId: string, id: string): Promise<boolean> {
    const linkedAccount = await this.knex("accounts")
      .where({ wallet_id: id, company_id: companyId })
      .first();

    if (linkedAccount) {
      return false;
    }

    const removed = await this.knex("wallets")
      .where({ id, company_id: companyId })
      .del();

    return removed > 0;
  }
}
