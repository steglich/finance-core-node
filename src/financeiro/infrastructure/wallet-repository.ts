import type { Wallet } from "../domain/wallet.js";

/**
 * Repository interface for the Wallet entity.
 * Every method is scoped by companyId (multi-tenancy invariant).
 */
export interface WalletRepository {
  create(wallet: Wallet): Promise<void>;

  findById(companyId: string, id: string): Promise<Wallet | null>;

  findByCompanyId(companyId: string): Promise<Wallet[]>;

  update(wallet: Wallet): Promise<void>;

  /**
   * Removes a wallet. Returns false when it still holds accounts.
   */
  delete(companyId: string, id: string): Promise<boolean>;
}
