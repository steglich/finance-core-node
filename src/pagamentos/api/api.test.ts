import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { PersonBankAccount } from "../../cadastros/domain/person-bank-account.js";
import { Person } from "../../cadastros/domain/person.js";
import type { PersonRole } from "../../cadastros/domain/person.js";
import type {
  PersonFilter,
  PersonRepository,
} from "../../cadastros/infrastructure/person-repository.js";
import { Account } from "../../financeiro/domain/account.js";
import type { AccountEntry } from "../../financeiro/domain/account.js";
import { Money } from "../../financeiro/domain/money.js";
import type { Transaction } from "../../financeiro/domain/transaction.js";
import type {
  AccountRepository,
  QueryExecutor,
} from "../../financeiro/infrastructure/account-repository.js";
import type { CategoryRepository } from "../../financeiro/infrastructure/category-repository.js";
import type {
  TransactionFilter,
  TransactionRepository,
} from "../../financeiro/infrastructure/transaction-repository.js";
import { toHttpStatusCode } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import {
  createChargeRoutes,
  createPayableRoutes,
} from "../../routes/payment-routes.js";
import { ChargeReceiptService } from "../domain/charge-receipt-service.js";
import type { Charge } from "../domain/charge.js";
import { PayableSettlementService } from "../domain/payable-settlement-service.js";
import type { Payable } from "../domain/payable.js";
import type {
  ChargeFilter,
  ChargeReceiptRecord,
  ChargeRepository,
} from "../infrastructure/charge-repository.js";
import type {
  PayableFilter,
  PayablePaymentRecord,
  PayableRepository,
} from "../infrastructure/payable-repository.js";
import { ChargeController } from "./charge-controller.js";
import { PayableController } from "./payable-controller.js";

const COMPANY_ID = "company-1";
const OTHER_COMPANY_ID = "company-2";

const CPF_A = "52998224725";
const CNPJ_A = "11222333000181";

/* -------------------------------------------------------------------------- */
/* In-memory repositories                                                      */
/* -------------------------------------------------------------------------- */

class InMemoryPersonRepository implements PersonRepository {
  readonly items = new Map<string, Person>();
  readonly bankAccounts = new Map<string, PersonBankAccount>();

  async create(person: Person): Promise<void> {
    this.items.set(person.id, person);
  }

  async findById(companyId: string, id: string): Promise<Person | null> {
    const person = this.items.get(id);
    return person && person.companyId === companyId ? person : null;
  }

  async findByDocument(
    companyId: string,
    document: string,
  ): Promise<Person | null> {
    return (
      [...this.items.values()].find(
        (person) =>
          person.companyId === companyId && person.document === document,
      ) ?? null
    );
  }

  async findByCompany(
    companyId: string,
    filter: PersonFilter = {},
  ): Promise<Person[]> {
    return [...this.items.values()].filter((person) => {
      if (person.companyId !== companyId) return false;
      if (filter.isActive !== undefined && person.isActive !== filter.isActive) {
        return false;
      }
      if (filter.role && !person.hasRole(filter.role)) return false;
      if (filter.personType && person.personType !== filter.personType) {
        return false;
      }
      return true;
    });
  }

  async findByRole(companyId: string, role: PersonRole): Promise<Person[]> {
    return this.findByCompany(companyId, { role, isActive: true });
  }

  async update(person: Person): Promise<void> {
    this.items.set(person.id, person);
  }

  async createBankAccount(account: PersonBankAccount): Promise<void> {
    this.bankAccounts.set(account.id, account);
  }

  async findBankAccounts(
    companyId: string,
    personId: string,
  ): Promise<PersonBankAccount[]> {
    return [...this.bankAccounts.values()].filter(
      (account) =>
        account.companyId === companyId && account.personId === personId,
    );
  }

  async findBankAccountById(
    companyId: string,
    id: string,
  ): Promise<PersonBankAccount | null> {
    const account = this.bankAccounts.get(id);
    return account && account.companyId === companyId ? account : null;
  }

  async updateBankAccounts(
    accounts: readonly PersonBankAccount[],
  ): Promise<void> {
    for (const account of accounts) {
      this.bankAccounts.set(account.id, account);
    }
  }

  async deleteBankAccount(_companyId: string, id: string): Promise<boolean> {
    return this.bankAccounts.delete(id);
  }
}

class InMemoryCategoryRepository implements CategoryRepository {
  readonly items = new Map<
    string,
    { id: string; companyId: string; type: "EXPENSE" | "INCOME" }
  >();

  async create(): Promise<void> {}

  async findById(companyId: string, id: string): Promise<never | null> {
    const category = this.items.get(id);
    return category && category.companyId === companyId
      ? (category as never)
      : null;
  }

  async findByCompanyId(): Promise<never[]> {
    return [];
  }

  async findByParentId(): Promise<never[]> {
    return [];
  }

  async findAncestorIds(): Promise<string[]> {
    return [];
  }

  async findDescendantIds(): Promise<string[]> {
    return [];
  }

  async countSubcategories(): Promise<number> {
    return 0;
  }

  async update(): Promise<void> {}

  async delete(): Promise<boolean> {
    return true;
  }

  async createDefaultCategories(): Promise<void> {}
}

/**
 * Emulates the one guarantee the real transaction repository gives and these
 * tests depend on: whatever `runAtomic` wrote is undone when the work throws.
 */
class InMemoryTransactionRepository implements TransactionRepository {
  readonly items = new Map<string, Transaction>();

  async runAtomic<T>(work: (executor: QueryExecutor) => Promise<T>): Promise<T> {
    const snapshot = new Map(this.items);
    try {
      return await work(undefined as unknown as QueryExecutor);
    } catch (error) {
      this.items.clear();
      for (const [id, transaction] of snapshot) {
        this.items.set(id, transaction);
      }
      throw error;
    }
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
      if (filter.accountId && transaction.accountId !== filter.accountId) {
        return false;
      }
      if (filter.type && transaction.type !== filter.type) return false;
      if (filter.status && transaction.status !== filter.status) return false;
      if (filter.personId && transaction.personId !== filter.personId) {
        return false;
      }
      return true;
    });

    return { items, total: items.length };
  }

  async findByTransferId(): Promise<Transaction[]> {
    return [];
  }

  async update(transaction: Transaction): Promise<void> {
    this.items.set(transaction.id, transaction);
  }

  async recordTransfer(): Promise<void> {}

  async replaceTags(): Promise<void> {}

  async countByCategoryId(): Promise<number> {
    return 0;
  }

  async addAttachment(): Promise<never> {
    throw new Error("not used");
  }

  async listAttachments(): Promise<never[]> {
    return [];
  }

  async findAttachment(): Promise<null> {
    return null;
  }
}

class InMemoryAccountRepository implements AccountRepository {
  readonly items = new Map<string, Account>();

  constructor(private readonly transactions: InMemoryTransactionRepository) {}

  async create(account: Account): Promise<void> {
    this.items.set(account.id, account);
  }

  async findById(companyId: string, id: string): Promise<Account | null> {
    const account = this.items.get(id);
    return account && account.companyId === companyId ? account : null;
  }

  async findByCompanyId(companyId: string): Promise<Account[]> {
    return [...this.items.values()].filter(
      (account) => account.companyId === companyId,
    );
  }

  async findByWalletId(): Promise<Account[]> {
    return [];
  }

  async update(account: Account): Promise<void> {
    this.items.set(account.id, account);
  }

  async applyMovement(companyId: string, entry: AccountEntry): Promise<Money> {
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

  async countPendingTransactions(): Promise<number> {
    return 0;
  }

  async deactivate(): Promise<boolean> {
    return true;
  }
}

/**
 * Stores charges by id together with the status they had when last written, so
 * `update()` can reproduce the production guard: the write only lands when the
 * stored row is still in a status the operation is allowed to move from.
 */
class InMemoryChargeRepository implements ChargeRepository {
  readonly items = new Map<string, Charge>();
  readonly storedStatus = new Map<string, string>();
  readonly receipts: ChargeReceiptRecord[] = [];

  async create(charge: Charge): Promise<void> {
    this.items.set(charge.id, charge);
    this.storedStatus.set(charge.id, charge.status);
  }

  async findById(companyId: string, id: string): Promise<Charge | null> {
    const charge = this.items.get(id);
    return charge && charge.companyId === companyId ? charge : null;
  }

  async findByCompany(
    companyId: string,
    filter: ChargeFilter = {},
  ): Promise<{ items: Charge[]; total: number }> {
    const items = [...this.items.values()].filter((charge) => {
      if (charge.companyId !== companyId) return false;
      if (filter.personId && charge.personId !== filter.personId) return false;
      if (filter.status && charge.status !== filter.status) return false;
      return true;
    });

    return { items, total: items.length };
  }

  async update(charge: Charge): Promise<void> {
    const stored = this.storedStatus.get(charge.id);

    if (stored !== "ISSUED" && stored !== "OVERDUE") {
      throw DomainError.create(
        "INVALID_OPERATION",
        `Charge ${charge.id} is no longer in a state that accepts this operation`,
      );
    }

    this.items.set(charge.id, charge);
    this.storedStatus.set(charge.id, charge.status);
  }

  async findOverdueCandidates(): Promise<Charge[]> {
    return [];
  }

  async hasOpenCharges(companyId: string, personId: string): Promise<number> {
    return [...this.items.values()].filter(
      (charge) =>
        charge.companyId === companyId &&
        charge.personId === personId &&
        charge.isOpen,
    ).length;
  }

  async registerReceipt(receipt: ChargeReceiptRecord): Promise<void> {
    this.receipts.push(receipt);
  }

  async isReceiptTransaction(
    _companyId: string,
    transactionId: string,
  ): Promise<boolean> {
    return this.receipts.some(
      (receipt) => receipt.transactionId === transactionId,
    );
  }

  async listReceipts(
    _companyId: string,
    chargeId: string,
  ): Promise<ChargeReceiptRecord[]> {
    return this.receipts.filter((receipt) => receipt.chargeId === chargeId);
  }
}

class InMemoryPayableRepository implements PayableRepository {
  readonly items = new Map<string, Payable>();
  readonly storedStatus = new Map<string, string>();
  readonly payments: PayablePaymentRecord[] = [];

  async create(payable: Payable): Promise<void> {
    this.items.set(payable.id, payable);
    this.storedStatus.set(payable.id, payable.status);
  }

  async findById(companyId: string, id: string): Promise<Payable | null> {
    const payable = this.items.get(id);
    return payable && payable.companyId === companyId ? payable : null;
  }

  async findByCompany(
    companyId: string,
    filter: PayableFilter = {},
  ): Promise<{ items: Payable[]; total: number }> {
    const items = [...this.items.values()].filter((payable) => {
      if (payable.companyId !== companyId) return false;
      if (filter.status && payable.status !== filter.status) return false;
      return true;
    });

    return { items, total: items.length };
  }

  async update(payable: Payable): Promise<void> {
    const stored = this.storedStatus.get(payable.id);

    if (stored !== "PENDING" && stored !== "OVERDUE") {
      throw DomainError.create(
        "INVALID_OPERATION",
        `Payable ${payable.id} is no longer in a state that accepts this operation`,
      );
    }

    this.items.set(payable.id, payable);
    this.storedStatus.set(payable.id, payable.status);
  }

  async findOverdueCandidates(): Promise<Payable[]> {
    return [];
  }

  async hasOpenPayables(companyId: string, personId: string): Promise<number> {
    return [...this.items.values()].filter(
      (payable) =>
        payable.companyId === companyId &&
        payable.personId === personId &&
        payable.isOpen,
    ).length;
  }

  async registerPayment(payment: PayablePaymentRecord): Promise<void> {
    this.payments.push(payment);
  }

  async isPaymentTransaction(
    _companyId: string,
    transactionId: string,
  ): Promise<boolean> {
    return this.payments.some(
      (payment) => payment.transactionId === transactionId,
    );
  }

  async listPayments(
    _companyId: string,
    payableId: string,
  ): Promise<PayablePaymentRecord[]> {
    return this.payments.filter((payment) => payment.payableId === payableId);
  }
}

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

interface Harness {
  app: FastifyInstance;
  charges: InMemoryChargeRepository;
  payables: InMemoryPayableRepository;
  transactions: InMemoryTransactionRepository;
  accounts: InMemoryAccountRepository;
  people: InMemoryPersonRepository;
  customerId: string;
  supplierId: string;
  accountId: string;
  categoryId: string;
}

/**
 * Mounts the charge and payable routes over in-memory repositories, with the
 * company taken from a stub auth hook rather than from a token.
 */
async function harness(companyId = COMPANY_ID): Promise<Harness> {
  const app = Fastify();

  app.setErrorHandler((error: Error, _request, reply) => {
    if (error instanceof DomainError) {
      return reply
        .code(toHttpStatusCode(error.code))
        .send({ error: error.message });
    }
    return reply.code(500).send({ error: error.message });
  });

  const transactions = new InMemoryTransactionRepository();
  const accounts = new InMemoryAccountRepository(transactions);
  const people = new InMemoryPersonRepository();
  const categories = new InMemoryCategoryRepository();
  const charges = new InMemoryChargeRepository();
  const payables = new InMemoryPayableRepository();
  const eventBus = new DomainEventBus();

  const account = Account.create({
    companyId,
    walletId: "wallet-1",
    name: "Conta Corrente",
    number: "1234",
    type: "CHECKING",
    currency: "BRL",
    initialBalance: 10000,
  }).value!;
  account.clearEvents();
  await accounts.create(account);

  const customer = Person.create({
    companyId,
    name: "João Silva",
    personType: "INDIVIDUAL",
    document: CPF_A,
    roles: ["CUSTOMER"],
  }).value!;
  customer.clearEvents();
  await people.create(customer);

  const supplier = Person.create({
    companyId,
    name: "Fornecedor XYZ",
    personType: "LEGAL_ENTITY",
    document: CNPJ_A,
    roles: ["SUPPLIER"],
  }).value!;
  supplier.clearEvents();
  await people.create(supplier);

  categories.items.set("category-1", {
    id: "category-1",
    companyId,
    type: "EXPENSE",
  });

  // Stands in for `createAuthenticate`, writing the same request context the
  // real hook does — the company scope never comes from the client.
  const authenticate = (async (request: {
    authContext?: { userId: string; companyId: string };
  }) => {
    request.authContext = { userId: "user-1", companyId };
    return undefined;
  }) as never;

  const deps = {
    chargeController: new ChargeController(
      charges,
      people,
      accounts,
      transactions,
      new ChargeReceiptService(),
      eventBus,
    ),
    payableController: new PayableController(
      payables,
      people,
      categories,
      accounts,
      transactions,
      new PayableSettlementService(),
      eventBus,
    ),
    pixController: undefined as never,
    authenticate,
  };

  await app.register(createChargeRoutes(deps), { prefix: "/charges" });
  await app.register(createPayableRoutes(deps), { prefix: "/payables" });
  await app.ready();

  return {
    app,
    charges,
    payables,
    transactions,
    accounts,
    people,
    customerId: customer.id,
    supplierId: supplier.id,
    accountId: account.id,
    categoryId: "category-1",
  };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

const ISSUE_DATE = "2026-08-01";
const DUE_DATE = "2026-08-15";
const FIVE_DAYS_LATE = "2026-08-20";

describe("Charges API", () => {
  async function issueCharge(
    context: Harness,
    body: Record<string, unknown> = {},
  ) {
    return context.app.inject({
      method: "POST",
      url: "/charges",
      payload: {
        personId: context.customerId,
        amount: 1500,
        issueDate: ISSUE_DATE,
        dueDate: DUE_DATE,
        penaltyPercent: 2,
        monthlyInterestPercent: 1,
        ...body,
      },
    });
  }

  it("issues a charge and returns it as ISSUED", async () => {
    const context = await harness();

    const response = await issueCharge(context);

    assert.equal(response.statusCode, 201);
    const body = response.json() as Record<string, unknown>;
    assert.equal(body.status, "ISSUED");
    assert.equal(body.personId, context.customerId);
    assert.equal(body.companyId, COMPANY_ID);
  });

  it("rejects a charge for a person who is not a customer", async () => {
    const context = await harness();

    const response = await issueCharge(context, {
      personId: context.supplierId,
    });

    assert.equal(response.statusCode, 400);
  });

  it("rejects a charge for a person of another company", async () => {
    const context = await harness();
    const stranger = Person.create({
      companyId: OTHER_COMPANY_ID,
      name: "De outra empresa",
      personType: "INDIVIDUAL",
      document: "11144477735",
      roles: ["CUSTOMER"],
    }).value!;
    await context.people.create(stranger);

    const response = await issueCharge(context, { personId: stranger.id });

    assert.equal(response.statusCode, 404);
  });

  it("derives penalty, interest and total due for the current date", async () => {
    const context = await harness();
    const issued = (await issueCharge(context)).json() as { id: string };

    const response = await context.app.inject({
      method: "GET",
      url: `/charges/${issued.id}`,
    });

    const body = response.json() as Record<string, number>;
    assert.equal(response.statusCode, 200);
    // The due date is in the past relative to nothing here — what matters is
    // that the three derived fields are present and consistent.
    assert.equal(
      body.totalDue,
      Number((body.amount! + body.penalty! + body.interest!).toFixed(2)),
    );
  });

  it("settles a charge, credits the account and records the receipt", async () => {
    const context = await harness();
    const issued = (await issueCharge(context)).json() as { id: string };

    const response = await context.app.inject({
      method: "POST",
      url: `/charges/${issued.id}/receipts`,
      payload: {
        accountId: context.accountId,
        amount: 1500,
        receivedAt: DUE_DATE,
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as Record<string, unknown>;
    assert.equal(body.status, "PAID");

    const account = await context.accounts.findById(
      COMPANY_ID,
      context.accountId,
    );
    assert.equal(account?.balance.amount, 11500);

    assert.equal(context.charges.receipts.length, 1);
    assert.equal(context.transactions.items.size, 1);
    const [transaction] = [...context.transactions.items.values()];
    assert.equal(transaction?.type, "INCOME");
    assert.equal(transaction?.personId, context.customerId);
  });

  it("settles an overdue charge for the total due of the receipt date", async () => {
    const context = await harness();
    const issued = (await issueCharge(context)).json() as { id: string };

    const response = await context.app.inject({
      method: "POST",
      url: `/charges/${issued.id}/receipts`,
      payload: {
        accountId: context.accountId,
        amount: 1532.5,
        receivedAt: FIVE_DAYS_LATE,
      },
    });

    assert.equal(response.statusCode, 200);
    const receipt = context.charges.receipts[0]!;
    assert.equal(receipt.penaltyAmount, "30.00");
    assert.equal(receipt.interestAmount, "2.50");
  });

  it("rejects a partial receipt and leaves the charge open", async () => {
    const context = await harness();
    const issued = (await issueCharge(context)).json() as { id: string };

    const response = await context.app.inject({
      method: "POST",
      url: `/charges/${issued.id}/receipts`,
      payload: {
        accountId: context.accountId,
        amount: 1000,
        receivedAt: DUE_DATE,
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(context.charges.items.get(issued.id)?.status, "ISSUED");
    assert.equal(context.transactions.items.size, 0);
  });

  it("requires receivedAt, since the total due depends on it", async () => {
    const context = await harness();
    const issued = (await issueCharge(context)).json() as { id: string };

    const response = await context.app.inject({
      method: "POST",
      url: `/charges/${issued.id}/receipts`,
      payload: { accountId: context.accountId, amount: 1500 },
    });

    assert.equal(response.statusCode, 400);
  });

  /**
   * The guard from design decision 9, end to end.
   */
  it("refuses a double settlement and leaves no second income transaction", async () => {
    const context = await harness();
    const issued = (await issueCharge(context)).json() as { id: string };

    const payload = {
      accountId: context.accountId,
      amount: 1500,
      receivedAt: DUE_DATE,
    };

    const first = await context.app.inject({
      method: "POST",
      url: `/charges/${issued.id}/receipts`,
      payload,
    });
    assert.equal(first.statusCode, 200);

    const second = await context.app.inject({
      method: "POST",
      url: `/charges/${issued.id}/receipts`,
      payload,
    });

    assert.equal(second.statusCode, 400);
    // Exactly one income transaction, one receipt and one credit survived.
    assert.equal(context.transactions.items.size, 1);
    assert.equal(context.charges.receipts.length, 1);
    const account = await context.accounts.findById(
      COMPANY_ID,
      context.accountId,
    );
    assert.equal(account?.balance.amount, 11500);
  });

  it("cancels an issued charge with a reason and refuses one without", async () => {
    const context = await harness();
    const issued = (await issueCharge(context)).json() as { id: string };

    const withoutReason = await context.app.inject({
      method: "POST",
      url: `/charges/${issued.id}/cancel`,
      payload: {},
    });
    assert.equal(withoutReason.statusCode, 400);

    const cancelled = await context.app.inject({
      method: "POST",
      url: `/charges/${issued.id}/cancel`,
      payload: { reason: "serviço não executado" },
    });
    assert.equal(cancelled.statusCode, 200);
    assert.equal(
      (cancelled.json() as Record<string, unknown>).status,
      "CANCELLED",
    );
  });

  it("refuses to edit a charge that is no longer ISSUED", async () => {
    const context = await harness();
    const issued = (await issueCharge(context)).json() as { id: string };

    await context.app.inject({
      method: "POST",
      url: `/charges/${issued.id}/receipts`,
      payload: {
        accountId: context.accountId,
        amount: 1500,
        receivedAt: DUE_DATE,
      },
    });

    const response = await context.app.inject({
      method: "PUT",
      url: `/charges/${issued.id}`,
      payload: { amount: 2000 },
    });

    assert.equal(response.statusCode, 400);
  });

  it("isolates charges by company", async () => {
    const mine = await harness();
    const theirs = await harness(OTHER_COMPANY_ID);

    const issued = (await issueCharge(mine)).json() as { id: string };

    const response = await theirs.app.inject({
      method: "GET",
      url: `/charges/${issued.id}`,
    });

    assert.equal(response.statusCode, 404);
  });

  it("lists only the charges of the current company", async () => {
    const context = await harness();
    await issueCharge(context);
    await issueCharge(context, { amount: 800 });

    const response = await context.app.inject({
      method: "GET",
      url: "/charges",
    });

    const body = response.json() as { charges: unknown[]; total: number };
    assert.equal(body.total, 2);
    assert.equal(body.charges.length, 2);
  });
});

describe("Payables API", () => {
  async function registerPayable(
    context: Harness,
    body: Record<string, unknown> = {},
  ) {
    return context.app.inject({
      method: "POST",
      url: "/payables",
      payload: {
        personId: context.supplierId,
        categoryId: context.categoryId,
        amount: 1000,
        dueDate: DUE_DATE,
        ...body,
      },
    });
  }

  it("registers a payable as PENDING", async () => {
    const context = await harness();

    const response = await registerPayable(context);

    assert.equal(response.statusCode, 201);
    assert.equal(
      (response.json() as Record<string, unknown>).status,
      "PENDING",
    );
  });

  it("rejects a payable for a person who is not a supplier", async () => {
    const context = await harness();

    const response = await registerPayable(context, {
      personId: context.customerId,
    });

    assert.equal(response.statusCode, 400);
  });

  it("settles a payable, debits the account and records the payment", async () => {
    const context = await harness();
    const payable = (await registerPayable(context)).json() as { id: string };

    const response = await context.app.inject({
      method: "POST",
      url: `/payables/${payable.id}/payments`,
      payload: {
        accountId: context.accountId,
        amount: 1000,
        paidAt: DUE_DATE,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal((response.json() as Record<string, unknown>).status, "PAID");

    const account = await context.accounts.findById(
      COMPANY_ID,
      context.accountId,
    );
    assert.equal(account?.balance.amount, 9000);

    assert.equal(context.payables.payments.length, 1);
    const [transaction] = [...context.transactions.items.values()];
    assert.equal(transaction?.type, "EXPENSE");
    assert.equal(transaction?.categoryId, context.categoryId);
    assert.equal(transaction?.personId, context.supplierId);
  });

  it("rejects a partial settlement and leaves the payable open", async () => {
    const context = await harness();
    const payable = (await registerPayable(context)).json() as { id: string };

    const response = await context.app.inject({
      method: "POST",
      url: `/payables/${payable.id}/payments`,
      payload: {
        accountId: context.accountId,
        amount: 400,
        paidAt: DUE_DATE,
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(context.payables.items.get(payable.id)?.status, "PENDING");
    assert.equal(context.transactions.items.size, 0);
  });

  it("refuses a double settlement and leaves no second expense transaction", async () => {
    const context = await harness();
    const payable = (await registerPayable(context)).json() as { id: string };

    const payload = {
      accountId: context.accountId,
      amount: 1000,
      paidAt: DUE_DATE,
    };

    const first = await context.app.inject({
      method: "POST",
      url: `/payables/${payable.id}/payments`,
      payload,
    });
    assert.equal(first.statusCode, 200);

    const second = await context.app.inject({
      method: "POST",
      url: `/payables/${payable.id}/payments`,
      payload,
    });

    assert.equal(second.statusCode, 400);
    assert.equal(context.transactions.items.size, 1);
    assert.equal(context.payables.payments.length, 1);
    const account = await context.accounts.findById(
      COMPANY_ID,
      context.accountId,
    );
    assert.equal(account?.balance.amount, 9000);
  });

  it("isolates payables by company", async () => {
    const mine = await harness();
    const theirs = await harness(OTHER_COMPANY_ID);

    const payable = (await registerPayable(mine)).json() as { id: string };

    const response = await theirs.app.inject({
      method: "GET",
      url: `/payables/${payable.id}`,
    });

    assert.equal(response.statusCode, 404);
  });

  it("cancels a pending payable and refuses to edit it afterwards", async () => {
    const context = await harness();
    const payable = (await registerPayable(context)).json() as { id: string };

    const cancelled = await context.app.inject({
      method: "POST",
      url: `/payables/${payable.id}/cancel`,
      payload: { reason: "nota cancelada" },
    });
    assert.equal(cancelled.statusCode, 200);

    const edit = await context.app.inject({
      method: "PUT",
      url: `/payables/${payable.id}`,
      payload: { amount: 1200 },
    });
    assert.equal(edit.statusCode, 400);
  });
});
