import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Account } from "../domain/account.js";
import type { AccountRepository } from "../infrastructure/account-repository.js";
import type { CardRepository } from "../infrastructure/card-repository.js";
import type { InvoiceRepository } from "../infrastructure/invoice-repository.js";
import type { WalletRepository } from "../infrastructure/wallet-repository.js";
import {
  validateCreateAccountRequest,
  validateUpdateAccountRequest,
} from "./dtos.js";

/**
 * Account endpoints. The company scope always comes from the token.
 */
export class AccountController {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly walletRepository: WalletRepository,
    private readonly cardRepository: CardRepository,
    private readonly invoiceRepository: InvoiceRepository,
  ) {}

  /**
   * POST /api/v1/accounts
   */
  async create(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateCreateAccountRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const wallet = await this.walletRepository.findById(
      companyId,
      validation.data.walletId,
    );
    if (!wallet) {
      return { statusCode: 404, body: { error: "Wallet not found" } };
    }

    const result = Account.create({ companyId, ...validation.data });
    if (result.isFailure || !result.value) {
      return this.fromDomainError(result.error);
    }

    const account = result.value;
    await this.accountRepository.create(account);
    account.clearEvents();

    return { statusCode: 201, body: account.toJSON() };
  }

  /**
   * GET /api/v1/accounts
   */
  async list(
    companyId: string,
    includeInactive = false,
  ): Promise<ControllerResult> {
    const accounts = await this.accountRepository.findByCompanyId(
      companyId,
      includeInactive,
    );

    return {
      statusCode: 200,
      body: { accounts: accounts.map((account) => account.toJSON()) },
    };
  }

  /**
   * GET /api/v1/accounts/:accountId — includes the balance derived from
   * confirmed transactions, so a divergent cache is corrected on read (RN-02).
   */
  async detail(companyId: string, accountId: string): Promise<ControllerResult> {
    const account = await this.accountRepository.findById(companyId, accountId);
    if (!account) {
      return { statusCode: 404, body: { error: "Account not found" } };
    }

    const entries = await this.accountRepository.listConfirmedEntries(
      companyId,
      accountId,
    );
    const reconciliation = account.reconcile(entries);

    if (reconciliation.isSuccess && reconciliation.value?.matched === false) {
      await this.accountRepository.update(account);
    }
    account.clearEvents();

    // An account owns its cards, so the detail exposes them.
    const cards = await this.cardRepository.findByAccount(companyId, accountId);

    return {
      statusCode: 200,
      body: {
        ...(account.toJSON() as Record<string, unknown>),
        reconciled: reconciliation.value?.matched ?? true,
        cards: cards.map((card) => card.toJSON()),
      },
    };
  }

  /**
   * PUT /api/v1/accounts/:accountId
   */
  async update(
    companyId: string,
    accountId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateUpdateAccountRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const account = await this.accountRepository.findById(companyId, accountId);
    if (!account) {
      return { statusCode: 404, body: { error: "Account not found" } };
    }

    let updated = account;

    if (validation.data.walletId) {
      const wallet = await this.walletRepository.findById(
        companyId,
        validation.data.walletId,
      );
      if (!wallet) {
        return { statusCode: 404, body: { error: "Wallet not found" } };
      }
      updated = updated.changeWallet(validation.data.walletId);
    }

    if (validation.data.name) {
      updated = updated.rename(validation.data.name);
    }

    await this.accountRepository.update(updated);

    return { statusCode: 200, body: updated.toJSON() };
  }

  /**
   * POST /api/v1/accounts/:accountId/deactivate
   */
  async deactivate(
    companyId: string,
    accountId: string,
  ): Promise<ControllerResult> {
    const account = await this.accountRepository.findById(companyId, accountId);
    if (!account) {
      return { statusCode: 404, body: { error: "Account not found" } };
    }

    const [pending, activeCards, unpaidInvoices] = await Promise.all([
      this.accountRepository.countPendingTransactions(companyId, accountId),
      this.cardRepository.countActiveByAccount(companyId, accountId),
      this.invoiceRepository.countUnpaidByAccount(companyId, accountId),
    ]);

    const result = account.deactivate(pending, activeCards, unpaidInvoices);
    if (result.isFailure) {
      return this.fromDomainError(result.error);
    }

    await this.accountRepository.update(account);
    account.clearEvents();

    return { statusCode: 200, body: account.toJSON() };
  }

  private fromDomainError(error: DomainError | undefined): ControllerResult {
    throw (
      error ??
      DomainError.create("BUSINESS_RULE_VIOLATION", "Operation not allowed")
    );
  }
}
