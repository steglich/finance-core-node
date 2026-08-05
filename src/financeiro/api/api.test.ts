import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import { DomainError } from "../../shared/domain/domain-error.js";
import { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import { toHttpStatusCode } from "../../shared/api/controller-result.js";
import { registerRoutes } from "../../routes/index.js";
import { Account, type AccountEntry } from "../domain/account.js";
import { Category } from "../domain/category.js";
import { Installment } from "../domain/installment.js";
import { Money } from "../domain/money.js";
import type { Recurrence } from "../domain/recurrence.js";
import type { Transaction } from "../domain/transaction.js";
import { TransferService } from "../domain/transfer-service.js";
import { Wallet } from "../domain/wallet.js";
import type {
  AccountRepository,
  QueryExecutor,
} from "../infrastructure/account-repository.js";
import type { CategoryRepository } from "../infrastructure/category-repository.js";
import type {
  InstallmentFilter,
  InstallmentRepository,
} from "../infrastructure/installment-repository.js";
import type {
  RecurrenceFilter,
  RecurrenceRepository,
} from "../infrastructure/recurrence-repository.js";
import type {
  TransactionAttachment,
  TransactionFilter,
  TransactionRepository,
} from "../infrastructure/transaction-repository.js";
import type { WalletRepository } from "../infrastructure/wallet-repository.js";
import { AccountController } from "./account-controller.js";
import { CategoryController } from "./category-controller.js";
import { InstallmentController } from "./installment-controller.js";
import { RecurrenceController } from "./recurrence-controller.js";
import { TransactionController } from "./transaction-controller.js";
import { TransferController } from "./transfer-controller.js";

const COMPANY_ID = "company-1";
const OTHER_COMPANY_ID = "company-2";

/* -------------------------------------------------------------------------- */
/* In-memory repositories                                                      */
/* -------------------------------------------------------------------------- */

class InMemoryWalletRepository implements WalletRepository {
  readonly items = new Map<string, Wallet>();

  async create(wallet: Wallet): Promise<void> {
    this.items.set(wallet.id, wallet);
  }

  async findById(companyId: string, id: string): Promise<Wallet | null> {
    const wallet = this.items.get(id);
    return wallet && wallet.companyId === companyId ? wallet : null;
  }

  async findByCompanyId(companyId: string): Promise<Wallet[]> {
    return [...this.items.values()].filter(
      (wallet) => wallet.companyId === companyId,
    );
  }

  async update(wallet: Wallet): Promise<void> {
    this.items.set(wallet.id, wallet);
  }

  async delete(): Promise<boolean> {
    return true;
  }
}

class InMemoryAccountRepository implements AccountRepository {
  readonly items = new Map<string, Account>();
  private readonly transactions: InMemoryTransactionRepository;

  constructor(transactions: InMemoryTransactionRepository) {
    this.transactions = transactions;
  }

  async create(account: Account): Promise<void> {
    this.items.set(account.id, account);
  }

  async findById(companyId: string, id: string): Promise<Account | null> {
    const account = this.items.get(id);
    return account && account.companyId === companyId ? account : null;
  }

  async findByCompanyId(
    companyId: string,
    includeInactive = false,
  ): Promise<Account[]> {
    return [...this.items.values()].filter(
      (account) =>
        account.companyId === companyId &&
        (includeInactive || account.isActive),
    );
  }

  async findByWalletId(
    companyId: string,
    walletId: string,
  ): Promise<Account[]> {
    return (await this.findByCompanyId(companyId, true)).filter(
      (account) => account.walletId === walletId,
    );
  }

  async update(account: Account): Promise<void> {
    this.items.set(account.id, account);
  }

  async applyMovement(
    companyId: string,
    entry: AccountEntry,
  ): Promise<Money> {
    const account = await this.findById(companyId, entry.accountId);
    if (!account) {
      throw DomainError.create("ENTITY_NOT_FOUND", "Account not found");
    }

    const result =
      entry.direction === "CREDIT"
        ? account.credit(entry)
        : account.debit(entry);

    if (result.isFailure) {
      throw result.error ?? new Error("movement failed");
    }

    account.clearEvents();
    return account.balance;
  }

  async listConfirmedEntries(
    companyId: string,
    accountId: string,
  ): Promise<AccountEntry[]> {
    const { items } = await this.transactions.findMany(companyId, {
      accountId,
      status: "CONFIRMED",
    });

    return items.map((transaction) => ({
      transactionId: transaction.id,
      accountId,
      direction: transaction.direction,
      amount: transaction.netAmount,
    }));
  }

  async countPendingTransactions(
    companyId: string,
    accountId: string,
  ): Promise<number> {
    const { total } = await this.transactions.findMany(companyId, {
      accountId,
      status: "PENDING",
    });
    return total;
  }

  async deactivate(): Promise<boolean> {
    return true;
  }
}

class InMemoryCategoryRepository implements CategoryRepository {
  readonly items = new Map<string, Category>();

  async create(category: Category): Promise<void> {
    this.items.set(category.id, category);
  }

  async findById(companyId: string, id: string): Promise<Category | null> {
    const category = this.items.get(id);
    return category && category.companyId === companyId && !category.isDeleted
      ? category
      : null;
  }

  async findByCompanyId(companyId: string): Promise<Category[]> {
    return [...this.items.values()].filter(
      (category) => category.companyId === companyId && !category.isDeleted,
    );
  }

  async findByParentId(
    companyId: string,
    parentId: string,
  ): Promise<Category[]> {
    return (await this.findByCompanyId(companyId)).filter(
      (category) => category.parentId === parentId,
    );
  }

  async findAncestorIds(companyId: string, id: string): Promise<string[]> {
    const ancestors: string[] = [];
    let current = await this.findById(companyId, id);

    while (current?.parentId) {
      ancestors.push(current.parentId);
      current = await this.findById(companyId, current.parentId);
    }

    return ancestors;
  }

  async findDescendantIds(companyId: string, id: string): Promise<string[]> {
    const children = await this.findByParentId(companyId, id);
    const descendants = children.map((child) => child.id);

    for (const child of children) {
      descendants.push(...(await this.findDescendantIds(companyId, child.id)));
    }

    return descendants;
  }

  async countSubcategories(companyId: string, id: string): Promise<number> {
    return (await this.findByParentId(companyId, id)).length;
  }

  async update(category: Category): Promise<void> {
    this.items.set(category.id, category);
  }

  async delete(companyId: string, id: string): Promise<boolean> {
    const category = await this.findById(companyId, id);
    if (!category) return false;

    const deleted = category.delete({
      transactionCount: 0,
      subcategoryCount: 0,
    });
    if (deleted.isFailure || !deleted.value) return false;

    this.items.set(id, deleted.value);
    return true;
  }

  async createDefaultCategories(): Promise<void> {
    // not exercised by these tests
  }
}

class InMemoryTransactionRepository implements TransactionRepository {
  readonly items = new Map<string, Transaction>();
  readonly attachments: TransactionAttachment[] = [];

  async runAtomic<T>(work: (executor: QueryExecutor) => Promise<T>): Promise<T> {
    return work(undefined as unknown as QueryExecutor);
  }

  async create(transaction: Transaction): Promise<void> {
    this.items.set(transaction.id, transaction);
  }

  async findById(companyId: string, id: string): Promise<Transaction | null> {
    const transaction = this.items.get(id);
    return transaction && transaction.companyId === companyId
      ? transaction
      : null;
  }

  async findMany(
    companyId: string,
    filter: TransactionFilter = {},
  ): Promise<{ items: Transaction[]; total: number }> {
    const items = [...this.items.values()].filter((transaction) => {
      if (transaction.companyId !== companyId) return false;
      if (filter.accountId && transaction.accountId !== filter.accountId)
        return false;
      if (filter.categoryId && transaction.categoryId !== filter.categoryId)
        return false;
      if (filter.type && transaction.type !== filter.type) return false;
      if (filter.status && transaction.status !== filter.status) return false;
      if (filter.from && transaction.date < filter.from) return false;
      if (filter.to && transaction.date > filter.to) return false;
      if (filter.transferId && transaction.transferId !== filter.transferId)
        return false;
      if (filter.tag && !transaction.tags.includes(filter.tag)) return false;
      return true;
    });

    return { items, total: items.length };
  }

  async findByTransferId(
    companyId: string,
    transferId: string,
  ): Promise<Transaction[]> {
    return (await this.findMany(companyId, { transferId })).items;
  }

  async update(transaction: Transaction): Promise<void> {
    this.items.set(transaction.id, transaction);
  }

  async recordTransfer(): Promise<void> {
    // the transfer header is not exercised by these tests
  }

  async replaceTags(): Promise<void> {
    // tags live on the aggregate in this fake
  }

  async countByCategoryId(
    companyId: string,
    categoryId: string,
  ): Promise<number> {
    return (await this.findMany(companyId, { categoryId })).total;
  }

  async addAttachment(
    _companyId: string,
    attachment: Omit<TransactionAttachment, "createdAt">,
  ): Promise<TransactionAttachment> {
    const stored = { ...attachment, createdAt: new Date() };
    this.attachments.push(stored);
    return stored;
  }

  async listAttachments(
    _companyId: string,
    transactionId: string,
  ): Promise<TransactionAttachment[]> {
    return this.attachments.filter(
      (attachment) => attachment.transactionId === transactionId,
    );
  }

  async findAttachment(
    _companyId: string,
    transactionId: string,
    attachmentId: string,
  ): Promise<TransactionAttachment | null> {
    return (
      this.attachments.find(
        (attachment) =>
          attachment.transactionId === transactionId &&
          attachment.id === attachmentId,
      ) ?? null
    );
  }
}

class InMemoryInstallmentRepository implements InstallmentRepository {
  readonly items = new Map<string, Installment>();

  async createMany(installments: readonly Installment[]): Promise<void> {
    for (const installment of installments) {
      this.items.set(installment.id, installment);
    }
  }

  async findById(companyId: string, id: string): Promise<Installment | null> {
    const installment = this.items.get(id);
    return installment && installment.companyId === companyId
      ? installment
      : null;
  }

  async findMany(
    companyId: string,
    filter: InstallmentFilter = {},
  ): Promise<{ items: Installment[]; total: number }> {
    const items = [...this.items.values()].filter((installment) => {
      if (installment.companyId !== companyId) return false;
      if (filter.status && installment.status !== filter.status) return false;
      if (filter.accountId && installment.accountId !== filter.accountId)
        return false;
      if (
        filter.parentTransactionId &&
        installment.parentTransactionId !== filter.parentTransactionId
      )
        return false;
      return true;
    });

    return { items, total: items.length };
  }

  async findByParentTransactionId(
    companyId: string,
    parentTransactionId: string,
  ): Promise<Installment[]> {
    return (await this.findMany(companyId, { parentTransactionId })).items;
  }

  async findOverdueCandidates(
    companyId: string,
    referenceDate: Date,
  ): Promise<Installment[]> {
    const { items } = await this.findMany(companyId, { status: "PENDING" });
    return items.filter((installment) => installment.dueDate < referenceDate);
  }

  async update(installment: Installment): Promise<void> {
    this.items.set(installment.id, installment);
  }
}

class InMemoryRecurrenceRepository implements RecurrenceRepository {
  readonly items = new Map<string, Recurrence>();

  async create(recurrence: Recurrence): Promise<void> {
    this.items.set(recurrence.id, recurrence);
  }

  async findById(companyId: string, id: string): Promise<Recurrence | null> {
    const recurrence = this.items.get(id);
    return recurrence && recurrence.companyId === companyId
      ? recurrence
      : null;
  }

  async findMany(
    companyId: string,
    filter: RecurrenceFilter = {},
  ): Promise<{ items: Recurrence[]; total: number }> {
    const items = [...this.items.values()].filter(
      (recurrence) =>
        recurrence.companyId === companyId &&
        (!filter.status || recurrence.status === filter.status),
    );

    return { items, total: items.length };
  }

  async findActive(): Promise<Recurrence[]> {
    return [...this.items.values()].filter((item) => item.isActive);
  }

  async update(recurrence: Recurrence): Promise<void> {
    this.items.set(recurrence.id, recurrence);
  }
}

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

interface Harness {
  app: FastifyInstance;
  wallets: InMemoryWalletRepository;
  accounts: InMemoryAccountRepository;
  categories: InMemoryCategoryRepository;
  transactions: InMemoryTransactionRepository;
  installments: InMemoryInstallmentRepository;
  recurrences: InMemoryRecurrenceRepository;
}

/**
 * Boots the real route tree and controllers over in-memory repositories, with
 * an authenticate hook that injects the company scope a token would carry.
 */
async function buildHarness(companyId = COMPANY_ID): Promise<Harness> {
  const app = Fastify({ logger: false });

  const transactions = new InMemoryTransactionRepository();
  const accounts = new InMemoryAccountRepository(transactions);
  const wallets = new InMemoryWalletRepository();
  const categories = new InMemoryCategoryRepository();
  const installments = new InMemoryInstallmentRepository();
  const recurrences = new InMemoryRecurrenceRepository();
  const eventBus = new DomainEventBus();

  app.setErrorHandler((error: Error, _request, reply) => {
    if (error instanceof DomainError) {
      return reply
        .code(toHttpStatusCode(error.code))
        .send({ error: error.message });
    }
    return reply.code(500).send({ error: error.message });
  });

  const stub = new Proxy(
    {},
    { get: () => async () => ({ statusCode: 501, body: {} }) },
  ) as never;

  // Phase 1 routes never touch cards or invoices; empty repositories keep the
  // transaction controller on its non-card path.
  const cards = {
    findById: async () => null,
    findByCompany: async () => [],
    findByAccount: async () => [],
    countActiveByAccount: async () => 0,
  } as never;
  const invoices = {
    findById: async () => null,
    findByCard: async () => [],
    findOpenByCard: async () => null,
    listPayments: async () => [],
    countOpenByCard: async () => 0,
    countUnpaidByCard: async () => 0,
    countUnpaidByAccount: async () => 0,
  } as never;

  await registerRoutes(app, {
    authController: stub,
    companyController: stub,
    profileController: stub,
    auditController: stub,
    personController: stub,
    costCenterController: stub,
    ledgerController: stub,
    chargeController: stub,
    payableController: stub,
    pixController: stub,
    requireAuditManage: (async () => undefined) as never,
    accountController: new AccountController(accounts, wallets, cards, invoices),
    categoryController: new CategoryController(categories, transactions),
    transactionController: new TransactionController(
      transactions,
      accounts,
      categories,
      installments,
      cards,
      invoices,
      eventBus,
    ),
    installmentController: new InstallmentController(
      installments,
      transactions,
      accounts,
      eventBus,
    ),
    transferController: new TransferController(
      transactions,
      accounts,
      new TransferService(),
      eventBus,
    ),
    recurrenceController: new RecurrenceController(
      recurrences,
      accounts,
      eventBus,
    ),
    cardController: stub,
    invoiceController: stub,
    budgetController: stub,
    goalController: stub,
    dashboardController: stub,
    reportController: stub,
    authenticate: (async (request: FastifyRequest) => {
      request.authContext = { userId: "user-1", companyId };
    }) as never,
  });

  await app.ready();

  return {
    app,
    wallets,
    accounts,
    categories,
    transactions,
    installments,
    recurrences,
  };
}

async function seedAccount(
  harness: Harness,
  currency = "BRL",
  initialBalance = 1000,
  companyId = COMPANY_ID,
): Promise<Account> {
  const wallet = Wallet.create({ companyId, name: "Banco" });
  assert.ok(wallet.value);
  await harness.wallets.create(wallet.value);

  const account = Account.create({
    companyId,
    walletId: wallet.value.id,
    name: `Conta ${currency}`,
    number: randomUUID().slice(0, 8),
    type: "CHECKING",
    currency,
    initialBalance,
  });

  assert.ok(account.value);
  account.value.clearEvents();
  await harness.accounts.create(account.value);

  return account.value;
}

async function seedCategory(
  harness: Harness,
  name = "Alimentação",
  companyId = COMPANY_ID,
): Promise<Category> {
  const category = Category.create({ companyId, name, type: "EXPENSE" });
  assert.ok(category.value);
  await harness.categories.create(category.value);
  return category.value;
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe("Accounts API", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await buildHarness();
  });

  it("creates an account", async () => {
    const wallet = Wallet.create({ companyId: COMPANY_ID, name: "Banco" });
    assert.ok(wallet.value);
    await harness.wallets.create(wallet.value);

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: {
        walletId: wallet.value.id,
        name: "Conta Corrente",
        number: "12345",
        type: "CHECKING",
        currency: "BRL",
        initialBalance: 2000,
      },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().balance, 2000);
  });

  it("rejects an invalid payload", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: { name: "Sem carteira" },
    });

    assert.equal(response.statusCode, 400);
  });

  it("404s for a wallet of another company", async () => {
    const wallet = Wallet.create({
      companyId: OTHER_COMPANY_ID,
      name: "Outro banco",
    });
    assert.ok(wallet.value);
    await harness.wallets.create(wallet.value);

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: {
        walletId: wallet.value.id,
        name: "Conta",
        number: "1",
        type: "CHECKING",
        currency: "BRL",
      },
    });

    assert.equal(response.statusCode, 404);
  });

  it("lists and details accounts", async () => {
    const account = await seedAccount(harness);

    const list = await harness.app.inject({ url: "/api/v1/accounts" });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().accounts.length, 1);

    const detail = await harness.app.inject({
      url: `/api/v1/accounts/${account.id}`,
    });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().id, account.id);
  });

  it("404s on an unknown account", async () => {
    const response = await harness.app.inject({
      url: `/api/v1/accounts/${randomUUID()}`,
    });

    assert.equal(response.statusCode, 404);
  });

  it("renames an account and deactivates it", async () => {
    const account = await seedAccount(harness);

    const update = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/accounts/${account.id}`,
      payload: { name: "Conta Renomeada" },
    });
    assert.equal(update.statusCode, 200);
    assert.equal(update.json().name, "Conta Renomeada");

    const deactivate = await harness.app.inject({
      method: "POST",
      url: `/api/v1/accounts/${account.id}/deactivate`,
    });
    assert.equal(deactivate.statusCode, 200);
    assert.equal(deactivate.json().isActive, false);
  });
});

describe("Categories API", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await buildHarness();
  });

  it("creates, lists, edits and soft-deletes a category", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/categories",
      payload: { name: "Alimentação", type: "EXPENSE" },
    });
    assert.equal(created.statusCode, 201);

    const id = created.json().id as string;

    const list = await harness.app.inject({ url: "/api/v1/categories" });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().tree.length, 1);

    const updated = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/categories/${id}`,
      payload: { name: "Mercado" },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().name, "Mercado");

    const deleted = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/categories/${id}`,
    });
    assert.equal(deleted.statusCode, 204);
    assert.equal((await harness.app.inject({ url: "/api/v1/categories" })).json()
      .categories.length, 0);
  });

  it("moves a category under a parent and refuses a cycle", async () => {
    const parent = await seedCategory(harness, "Casa");
    const child = await seedCategory(harness, "Luz");

    const move = await harness.app.inject({
      method: "POST",
      url: `/api/v1/categories/${child.id}/move`,
      payload: { parentId: parent.id },
    });
    assert.equal(move.statusCode, 200);
    assert.equal(move.json().parentId, parent.id);

    const cycle = await harness.app.inject({
      method: "POST",
      url: `/api/v1/categories/${parent.id}/move`,
      payload: { parentId: child.id },
    });
    assert.equal(cycle.statusCode, 400);
  });

  it("blocks deleting a category with transactions", async () => {
    const account = await seedAccount(harness);
    const category = await seedCategory(harness);

    await harness.app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      payload: {
        accountId: account.id,
        categoryId: category.id,
        type: "EXPENSE",
        grossAmount: 10,
        date: "2024-08-01",
      },
    });

    const response = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/categories/${category.id}`,
    });

    assert.equal(response.statusCode, 400);
  });
});

describe("Transactions API", () => {
  let harness: Harness;
  let account: Account;

  beforeEach(async () => {
    harness = await buildHarness();
    account = await seedAccount(harness);
  });

  it("registers an expense and computes the net amount", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      payload: {
        accountId: account.id,
        type: "EXPENSE",
        grossAmount: 200,
        discount: 20,
        date: "2024-08-01",
        tags: ["urgente"],
      },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().netAmount, 180);
    assert.equal(response.json().status, "PENDING");
    assert.deepEqual(response.json().tags, ["urgente"]);
  });

  it("rejects a transaction without an account", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      payload: { type: "EXPENSE", grossAmount: 10, date: "2024-08-01" },
    });

    assert.equal(response.statusCode, 400);
  });

  it("404s when the account belongs to another company", async () => {
    const foreign = await seedAccount(harness, "BRL", 100, OTHER_COMPANY_ID);

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      payload: {
        accountId: foreign.id,
        type: "EXPENSE",
        grossAmount: 10,
        date: "2024-08-01",
      },
    });

    assert.equal(response.statusCode, 404);
  });

  it("confirms a transaction and moves the balance", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      payload: {
        accountId: account.id,
        type: "EXPENSE",
        grossAmount: 100,
        date: "2024-08-01",
      },
    });

    const id = created.json().id as string;

    const confirmed = await harness.app.inject({
      method: "POST",
      url: `/api/v1/transactions/${id}/confirm`,
    });

    assert.equal(confirmed.statusCode, 200);
    assert.equal(confirmed.json().status, "CONFIRMED");
    assert.equal(
      harness.accounts.items.get(account.id)?.balance.amount,
      900,
    );
  });

  it("refuses to cancel a confirmed transaction and refunds it instead", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      payload: {
        accountId: account.id,
        type: "EXPENSE",
        grossAmount: 100,
        date: "2024-08-01",
      },
    });
    const id = created.json().id as string;

    await harness.app.inject({
      method: "POST",
      url: `/api/v1/transactions/${id}/confirm`,
    });

    const cancelled = await harness.app.inject({
      method: "POST",
      url: `/api/v1/transactions/${id}/cancel`,
    });
    assert.equal(cancelled.statusCode, 400);

    const refunded = await harness.app.inject({
      method: "POST",
      url: `/api/v1/transactions/${id}/refund`,
      payload: { reason: "devolução" },
    });
    assert.equal(refunded.statusCode, 200);
    assert.equal(refunded.json().status, "REFUNDED");
    assert.equal(
      harness.accounts.items.get(account.id)?.balance.amount,
      1000,
    );
  });

  it("edits a pending transaction and rejects editing a confirmed one", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      payload: {
        accountId: account.id,
        type: "EXPENSE",
        grossAmount: 100,
        date: "2024-08-01",
      },
    });
    const id = created.json().id as string;

    const edited = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/transactions/${id}`,
      payload: { grossAmount: 120 },
    });
    assert.equal(edited.statusCode, 200);
    assert.equal(edited.json().grossAmount, 120);
    assert.equal(edited.json().changes.length, 1);

    await harness.app.inject({
      method: "POST",
      url: `/api/v1/transactions/${id}/confirm`,
    });

    const rejected = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/transactions/${id}`,
      payload: { grossAmount: 150 },
    });
    assert.equal(rejected.statusCode, 400);
  });

  it("filters the transaction list", async () => {
    for (const amount of [10, 20]) {
      await harness.app.inject({
        method: "POST",
        url: "/api/v1/transactions",
        payload: {
          accountId: account.id,
          type: "EXPENSE",
          grossAmount: amount,
          date: "2024-08-01",
        },
      });
    }

    const all = await harness.app.inject({ url: "/api/v1/transactions" });
    assert.equal(all.json().total, 2);

    const income = await harness.app.inject({
      url: "/api/v1/transactions?type=INCOME",
    });
    assert.equal(income.json().total, 0);

    const invalid = await harness.app.inject({
      url: "/api/v1/transactions?status=WRONG",
    });
    assert.equal(invalid.statusCode, 400);
  });

  it("registers a parceled purchase with 12 installments", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      payload: {
        accountId: account.id,
        type: "EXPENSE",
        grossAmount: 1200,
        date: "2024-01-15",
        installments: 12,
      },
    });

    assert.equal(response.statusCode, 201);
    const installments = response.json().installments as { amount: number }[];
    assert.equal(installments.length, 12);
    assert.ok(installments.every((item) => item.amount === 100));
  });

  it("stores and reads attachment metadata", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      payload: {
        accountId: account.id,
        type: "EXPENSE",
        grossAmount: 50,
        date: "2024-08-01",
      },
    });
    const id = created.json().id as string;

    const attached = await harness.app.inject({
      method: "POST",
      url: `/api/v1/transactions/${id}/attachments`,
      payload: {
        filename: "recibo.pdf",
        mimeType: "application/pdf",
        size: 1024,
        url: "s3://bucket/recibo.pdf",
      },
    });
    assert.equal(attached.statusCode, 201);

    const attachmentId = attached.json().id as string;

    const fetched = await harness.app.inject({
      url: `/api/v1/transactions/${id}/attachments/${attachmentId}`,
    });
    assert.equal(fetched.statusCode, 200);
    assert.equal(fetched.json().filename, "recibo.pdf");

    const missing = await harness.app.inject({
      url: `/api/v1/transactions/${id}/attachments/${randomUUID()}`,
    });
    assert.equal(missing.statusCode, 404);
  });
});

describe("Installments API", () => {
  let harness: Harness;
  let account: Account;
  let installmentIds: string[];

  beforeEach(async () => {
    harness = await buildHarness();
    account = await seedAccount(harness, "BRL", 5000);

    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      payload: {
        accountId: account.id,
        type: "EXPENSE",
        grossAmount: 300,
        date: "2024-01-15",
        installments: 3,
      },
    });

    installmentIds = (created.json().installments as { id: string }[]).map(
      (item) => item.id,
    );
  });

  it("lists installments and filters by status", async () => {
    const list = await harness.app.inject({ url: "/api/v1/installments" });
    assert.equal(list.json().total, 3);

    const paid = await harness.app.inject({
      url: "/api/v1/installments?status=PAID",
    });
    assert.equal(paid.json().total, 0);
  });

  it("changes the due date of a pending installment", async () => {
    const response = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/installments/${installmentIds[0]}/due-date`,
      payload: { dueDate: "2024-03-20" },
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.json().dueDate as string, /^2024-03-20/);
  });

  it("pays a single installment without touching the others", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: `/api/v1/installments/${installmentIds[1]}/pay`,
      payload: { paymentDate: "2024-03-10" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "PAID");
    assert.equal(
      harness.installments.items.get(installmentIds[0]!)?.status,
      "PENDING",
    );
    assert.equal(harness.accounts.items.get(account.id)?.balance.amount, 4900);
  });

  it("rejects paying a settled installment", async () => {
    await harness.app.inject({
      method: "POST",
      url: `/api/v1/installments/${installmentIds[0]}/pay`,
      payload: { paymentDate: "2024-02-10" },
    });

    const response = await harness.app.inject({
      method: "POST",
      url: `/api/v1/installments/${installmentIds[0]}/pay`,
      payload: { paymentDate: "2024-02-11" },
    });

    assert.equal(response.statusCode, 400);
  });

  it("pays a batch, reporting each installment individually", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/installments/pay",
      payload: {
        installmentIds: [...installmentIds, randomUUID()],
        paymentDate: "2024-04-10",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().paid, 3);
    assert.equal(response.json().failed, 1);
  });
});

describe("Transfers API", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await buildHarness();
  });

  it("transfers between two accounts of the same currency", async () => {
    const source = await seedAccount(harness, "BRL", 2000);
    const target = await seedAccount(harness, "BRL", 1000);

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/transfers",
      payload: {
        sourceAccountId: source.id,
        targetAccountId: target.id,
        amount: 500,
        date: "2024-08-01",
      },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(harness.accounts.items.get(source.id)?.balance.amount, 1500);
    assert.equal(harness.accounts.items.get(target.id)?.balance.amount, 1500);
  });

  it("rejects an insufficient balance", async () => {
    const source = await seedAccount(harness, "BRL", 100);
    const target = await seedAccount(harness, "BRL", 0);

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/transfers",
      payload: {
        sourceAccountId: source.id,
        targetAccountId: target.id,
        amount: 500,
        date: "2024-08-01",
      },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json().error as string, /Saldo insuficiente/);
  });

  it("requires an exchange rate across currencies", async () => {
    const source = await seedAccount(harness, "BRL", 2000);
    const target = await seedAccount(harness, "USD", 0);

    const without = await harness.app.inject({
      method: "POST",
      url: "/api/v1/transfers",
      payload: {
        sourceAccountId: source.id,
        targetAccountId: target.id,
        amount: 520,
        date: "2024-08-01",
      },
    });
    assert.equal(without.statusCode, 400);

    const withRate = await harness.app.inject({
      method: "POST",
      url: "/api/v1/transfers",
      payload: {
        sourceAccountId: source.id,
        targetAccountId: target.id,
        amount: 520,
        date: "2024-08-01",
        exchangeRate: {
          sourceCurrency: "USD",
          targetCurrency: "BRL",
          rate: 5.2,
          date: "2024-08-01",
        },
      },
    });

    assert.equal(withRate.statusCode, 201);
    assert.equal(withRate.json().creditedAmount, 100);
  });

  it("404s on an unknown target account", async () => {
    const source = await seedAccount(harness, "BRL", 2000);

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/transfers",
      payload: {
        sourceAccountId: source.id,
        targetAccountId: randomUUID(),
        amount: 10,
        date: "2024-08-01",
      },
    });

    assert.equal(response.statusCode, 404);
  });
});

describe("Recurrences API", () => {
  let harness: Harness;
  let account: Account;

  beforeEach(async () => {
    harness = await buildHarness();
    account = await seedAccount(harness);
  });

  async function createRecurrence(
    payload: Record<string, unknown> = {},
  ): Promise<string> {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/recurrences",
      payload: {
        accountId: account.id,
        description: "Netflix",
        amount: 39.9,
        currency: "BRL",
        periodicity: "MONTHLY",
        startDate: "2024-08-01",
        ...payload,
      },
    });

    assert.equal(response.statusCode, 201);
    return response.json().id as string;
  }

  it("creates and lists recurrences", async () => {
    await createRecurrence();

    const list = await harness.app.inject({ url: "/api/v1/recurrences" });
    assert.equal(list.json().total, 1);
    assert.equal(list.json().recurrences[0].status, "ACTIVE");
  });

  it("rejects an end date before the start date", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/recurrences",
      payload: {
        accountId: account.id,
        description: "Aluguel",
        amount: 500,
        currency: "BRL",
        periodicity: "MONTHLY",
        startDate: "2024-08-01",
        endDate: "2024-07-01",
      },
    });

    assert.equal(response.statusCode, 400);
  });

  it("rejects a maximum of zero occurrences", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/recurrences",
      payload: {
        accountId: account.id,
        description: "Aluguel",
        amount: 500,
        currency: "BRL",
        periodicity: "MONTHLY",
        startDate: "2024-08-01",
        maxOccurrences: 0,
      },
    });

    assert.equal(response.statusCode, 400);
  });

  it("pauses, resumes, edits and cancels a recurrence", async () => {
    const id = await createRecurrence();

    const paused = await harness.app.inject({
      method: "POST",
      url: `/api/v1/recurrences/${id}/pause`,
    });
    assert.equal(paused.json().status, "PAUSED");

    const doublePause = await harness.app.inject({
      method: "POST",
      url: `/api/v1/recurrences/${id}/pause`,
    });
    assert.equal(doublePause.statusCode, 400);

    const resumed = await harness.app.inject({
      method: "POST",
      url: `/api/v1/recurrences/${id}/resume`,
    });
    assert.equal(resumed.json().status, "ACTIVE");

    const edited = await harness.app.inject({
      method: "PUT",
      url: `/api/v1/recurrences/${id}`,
      payload: { amount: 49.9 },
    });
    assert.equal(edited.json().amount, 49.9);

    const cancelled = await harness.app.inject({
      method: "POST",
      url: `/api/v1/recurrences/${id}/cancel`,
    });
    assert.equal(cancelled.json().status, "CANCELLED");
  });

  it("404s on an unknown recurrence", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: `/api/v1/recurrences/${randomUUID()}/pause`,
    });

    assert.equal(response.statusCode, 404);
  });
});
