import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { toHttpStatusCode } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import type { DomainEvent } from "../../shared/domain/domain-event.js";
import { createInvestmentRoutes } from "../../routes/investment-routes.js";
import { createLoanRoutes } from "../../routes/loan-routes.js";
import {
  createExchangeRateRoutes,
  createNetWorthRoutes,
} from "../../routes/net-worth-routes.js";
import { Account } from "../domain/account.js";
import type { AccountEntry } from "../domain/account.js";
import { ExchangeService } from "../domain/exchange-service.js";
import { Investment } from "../domain/investment.js";
import type { InvestmentOperation } from "../domain/investment-operation.js";
import { InvestmentOperationService } from "../domain/investment-operation-service.js";
import { LoanAmortizationService } from "../domain/loan-amortization-service.js";
import { LoanPaymentService } from "../domain/loan-payment-service.js";
import type { Loan } from "../domain/loan.js";
import type { LoanInstallment } from "../domain/loan-installment.js";
import { Money } from "../domain/money.js";
import { NetWorthService } from "../domain/net-worth-service.js";
import type { Transaction } from "../domain/transaction.js";
import type {
  AccountRepository,
  QueryExecutor,
} from "../infrastructure/account-repository.js";
import type { CategoryRepository } from "../infrastructure/category-repository.js";
import type {
  ExchangeRateFilter,
  ExchangeRateRecord,
  ExchangeRateRepository,
} from "../infrastructure/exchange-rate-repository.js";
import type {
  InvestmentFilter,
  InvestmentOperationFilter,
  InvestmentPositionSummary,
  InvestmentRepository,
  PortfolioEntry,
} from "../infrastructure/investment-repository.js";
import type {
  InvestmentQuoteFilter,
  InvestmentQuoteRecord,
  InvestmentQuoteRepository,
} from "../infrastructure/investment-quote-repository.js";
import type {
  CompanyNetWorth,
  CrossCompanyReader,
  NetWorthComponentRow,
  NetWorthRepository,
} from "../infrastructure/net-worth-repository.js";
import type {
  LoanFilter,
  LoanInstallmentRepository,
  LoanPaymentRecord,
  LoanRepository,
} from "../infrastructure/loan-repository.js";
import type {
  TransactionFilter,
  TransactionRepository,
} from "../infrastructure/transaction-repository.js";
import { derivePosition } from "../domain/investment-position.js";
import { ExchangeRateController } from "./exchange-rate-controller.js";
import { InvestmentController } from "./investment-controller.js";
import { LoanController } from "./loan-controller.js";
import { NetWorthController } from "./net-worth-controller.js";

const COMPANY_ID = "company-1";
const OTHER_COMPANY_ID = "company-2";
const USER_ID = "user-1";

const ACCOUNT_ID = "account-1";
const CAT_EXPENSE = "category-expense";
const CAT_INCOME = "category-income";

/* -------------------------------------------------------------------------- */
/* In-memory repositories                                                      */
/* -------------------------------------------------------------------------- */

class InMemoryAccountRepository implements AccountRepository {
  readonly items = new Map<string, Account>();

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

  async update(): Promise<void> {}

  async applyMovement(
    _companyId: string,
    entry: AccountEntry,
  ): Promise<Money> {
    const account = this.items.get(entry.accountId);
    if (!account) {
      throw DomainError.create("ENTITY_NOT_FOUND", "Account not found");
    }
    const result =
      entry.direction === "CREDIT"
        ? account.credit(entry)
        : account.debit(entry);
    account.clearEvents();
    return result.getValueOrThrow();
  }

  async listConfirmedEntries(): Promise<AccountEntry[]> {
    return [];
  }

  async countPendingTransactions(): Promise<number> {
    return 0;
  }

  async deactivate(): Promise<boolean> {
    return true;
  }
}

class InMemoryTransactionRepository implements TransactionRepository {
  readonly items = new Map<string, Transaction>();

  /**
   * There is no database here, so "atomic" is best-effort: the work runs and a
   * failure simply propagates. The real all-or-nothing behaviour is covered by
   * `concurrency.integration.test.ts` against Postgres.
   */
  async runAtomic<T>(work: (executor: QueryExecutor) => Promise<T>): Promise<T> {
    return work(undefined as unknown as QueryExecutor);
  }

  async create(transaction: Transaction): Promise<void> {
    this.items.set(transaction.id, transaction);
  }

  async recordTransfer(): Promise<void> {}

  async findById(companyId: string, id: string): Promise<Transaction | null> {
    const transaction = this.items.get(id);
    return transaction && transaction.companyId === companyId
      ? transaction
      : null;
  }

  async findMany(
    companyId: string,
    _filter?: TransactionFilter,
  ): Promise<{ items: Transaction[]; total: number }> {
    const items = [...this.items.values()].filter(
      (transaction) => transaction.companyId === companyId,
    );
    return { items, total: items.length };
  }

  async findByTransferId(): Promise<Transaction[]> {
    return [];
  }

  async update(): Promise<void> {}

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

/**
 * Only `findById` is exercised here; the rest of the interface is stubbed so
 * the controller can be wired without dragging in the category tree.
 */
class InMemoryCategoryRepository {
  readonly items = new Map<
    string,
    { id: string; companyId: string; type: "EXPENSE" | "INCOME" }
  >();

  async findById(companyId: string, id: string): Promise<never> {
    const category = this.items.get(id);
    return (
      category && category.companyId === companyId ? category : null
    ) as never;
  }

  async create(): Promise<void> {}
  async findByCompanyId(): Promise<never[]> {
    return [];
  }
  async findByName(): Promise<null> {
    return null;
  }
  async findChildren(): Promise<never[]> {
    return [];
  }
  async update(): Promise<void> {}
  async softDelete(): Promise<void> {}
  async createDefaults(): Promise<void> {}
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
}

class InMemoryInvestmentRepository implements InvestmentRepository {
  readonly items = new Map<string, Investment>();
  readonly operations: InvestmentOperation[] = [];

  async create(investment: Investment): Promise<void> {
    this.items.set(investment.id, investment);
  }

  async findById(companyId: string, id: string): Promise<Investment | null> {
    const investment = this.items.get(id);
    return investment && investment.companyId === companyId ? investment : null;
  }

  async findByIdForUpdate(
    companyId: string,
    id: string,
  ): Promise<Investment | null> {
    return this.findById(companyId, id);
  }

  async findByCompany(
    companyId: string,
    _filter?: InvestmentFilter,
  ): Promise<{ items: Investment[]; total: number }> {
    const items = [...this.items.values()].filter(
      (investment) => investment.companyId === companyId,
    );
    return { items, total: items.length };
  }

  async update(): Promise<void> {}

  async listOperations(
    companyId: string,
    investmentId: string,
    _filter?: InvestmentOperationFilter,
  ): Promise<InvestmentOperation[]> {
    return this.operations.filter(
      (operation) =>
        operation.companyId === companyId &&
        operation.investmentId === investmentId,
    );
  }

  async createOperation(operation: InvestmentOperation): Promise<void> {
    this.operations.push(operation);
  }

  async linkOperationTransaction(): Promise<void> {}

  async positionSummary(
    companyId: string,
    investmentId: string,
  ): Promise<InvestmentPositionSummary> {
    const investment = this.items.get(investmentId);
    const operations = await this.listOperations(companyId, investmentId);
    const position = derivePosition(operations, investment?.currency ?? "BRL");
    const value = position.getValueOrThrow();

    return {
      investmentId,
      quantity: value.quantity,
      investedAmount: value.investedAmount.amount,
      realizedResult: value.realizedResult.amount,
      incomeReceived: value.incomeReceived.amount,
    };
  }

  async portfolio(companyId: string): Promise<PortfolioEntry[]> {
    const entries: PortfolioEntry[] = [];

    for (const investment of this.items.values()) {
      if (investment.companyId !== companyId) continue;
      const summary = await this.positionSummary(companyId, investment.id);
      entries.push({
        ...summary,
        name: investment.name,
        investmentType: investment.investmentType,
        symbol: investment.symbol,
        currency: investment.currency,
        status: investment.status,
        unitPrice: undefined,
      });
    }

    return entries;
  }
}

class InMemoryQuoteRepository implements InvestmentQuoteRepository {
  readonly items: InvestmentQuoteRecord[] = [];

  async upsert(
    _companyId: string,
    record: InvestmentQuoteRecord,
  ): Promise<InvestmentQuoteRecord> {
    const index = this.items.findIndex(
      (item) =>
        item.investmentId === record.investmentId &&
        item.quoteDate.getTime() === record.quoteDate.getTime(),
    );
    if (index >= 0) {
      this.items[index] = record;
    } else {
      this.items.push(record);
    }
    return record;
  }

  async findForDate(
    _companyId: string,
    investmentId: string,
    referenceDate: Date,
  ): Promise<InvestmentQuoteRecord | null> {
    return (
      this.items
        .filter(
          (item) =>
            item.investmentId === investmentId &&
            item.quoteDate.getTime() <= referenceDate.getTime(),
        )
        .sort((a, b) => b.quoteDate.getTime() - a.quoteDate.getTime())[0] ?? null
    );
  }

  async findByInvestment(
    _companyId: string,
    investmentId: string,
    _filter?: InvestmentQuoteFilter,
  ): Promise<{ items: InvestmentQuoteRecord[]; total: number }> {
    const items = this.items.filter(
      (item) => item.investmentId === investmentId,
    );
    return { items, total: items.length };
  }
}

class InMemoryLoanRepository implements LoanRepository {
  readonly items = new Map<string, Loan>();
  readonly payments: LoanPaymentRecord[] = [];

  constructor(private readonly installments: InMemoryLoanInstallmentRepository) {}

  async create(
    loan: Loan,
    installments: readonly LoanInstallment[],
  ): Promise<void> {
    this.items.set(loan.id, loan);
    await this.installments.create(installments);
  }

  async findById(companyId: string, id: string): Promise<Loan | null> {
    const loan = this.items.get(id);
    return loan && loan.companyId === companyId ? loan : null;
  }

  async findByIdForUpdate(companyId: string, id: string): Promise<Loan | null> {
    return this.findById(companyId, id);
  }

  async findByCompany(
    companyId: string,
    filter: LoanFilter = {},
  ): Promise<{ items: Loan[]; total: number }> {
    const items = [...this.items.values()].filter(
      (loan) =>
        loan.companyId === companyId &&
        (!filter.status || loan.status === filter.status),
    );
    return { items, total: items.length };
  }

  async update(): Promise<void> {}

  async extraAmortizations(): Promise<string> {
    return "0";
  }

  async registerPayment(record: LoanPaymentRecord): Promise<void> {
    this.payments.push(record);
  }

  async listPayments(
    companyId: string,
    loanId: string,
  ): Promise<LoanPaymentRecord[]> {
    return this.payments.filter(
      (payment) =>
        payment.companyId === companyId && payment.loanId === loanId,
    );
  }

  async isPaymentTransaction(): Promise<boolean> {
    return false;
  }
}

class InMemoryLoanInstallmentRepository implements LoanInstallmentRepository {
  readonly items = new Map<string, LoanInstallment>();

  async create(installments: readonly LoanInstallment[]): Promise<void> {
    for (const installment of installments) {
      this.items.set(installment.id, installment);
    }
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<LoanInstallment | null> {
    const installment = this.items.get(id);
    return installment && installment.companyId === companyId
      ? installment
      : null;
  }

  async findByNumber(
    companyId: string,
    loanId: string,
    number: number,
  ): Promise<LoanInstallment | null> {
    return (
      [...this.items.values()].find(
        (installment) =>
          installment.companyId === companyId &&
          installment.loanId === loanId &&
          installment.number === number,
      ) ?? null
    );
  }

  async listByLoan(
    companyId: string,
    loanId: string,
  ): Promise<LoanInstallment[]> {
    return [...this.items.values()]
      .filter(
        (installment) =>
          installment.companyId === companyId && installment.loanId === loanId,
      )
      .sort((a, b) => a.number - b.number);
  }

  async update(): Promise<void> {}

  async findOverdueCandidates(): Promise<LoanInstallment[]> {
    return [];
  }
}

class InMemoryExchangeRateRepository implements ExchangeRateRepository {
  readonly items: ExchangeRateRecord[] = [];

  async upsert(record: ExchangeRateRecord): Promise<ExchangeRateRecord> {
    const index = this.items.findIndex(
      (item) =>
        item.companyId === record.companyId &&
        item.sourceCurrency === record.sourceCurrency &&
        item.targetCurrency === record.targetCurrency &&
        item.rateDate.getTime() === record.rateDate.getTime(),
    );
    if (index >= 0) {
      this.items[index] = record;
    } else {
      this.items.push(record);
    }
    return record;
  }

  async findForDate(
    companyId: string,
    sourceCurrency: string,
    targetCurrency: string,
    date: Date,
  ): Promise<ExchangeRateRecord | null> {
    return (
      this.items
        .filter(
          (item) =>
            item.companyId === companyId &&
            item.sourceCurrency === sourceCurrency &&
            item.targetCurrency === targetCurrency &&
            item.rateDate.getTime() <= date.getTime(),
        )
        .sort((a, b) => b.rateDate.getTime() - a.rateDate.getTime())[0] ?? null
    );
  }

  async findByCompany(
    companyId: string,
    _filter?: ExchangeRateFilter,
  ): Promise<{ items: ExchangeRateRecord[]; total: number }> {
    const items = this.items.filter((item) => item.companyId === companyId);
    return { items, total: items.length };
  }
}

/**
 * Net worth components keyed by company, so the consolidation can be exercised
 * without a database.
 */
class InMemoryNetWorthRepository implements NetWorthRepository {
  readonly components: Record<string, NetWorthComponentRow[]> = {};

  async netWorthAt(companyId: string): Promise<NetWorthComponentRow[]> {
    return this.components[companyId] ?? [];
  }

  async defaultCurrency(): Promise<string> {
    return "BRL";
  }
}

/**
 * The memberships of each user. A company the client names is never consulted.
 */
class InMemoryCrossCompanyReader implements CrossCompanyReader {
  constructor(
    private readonly memberships: Record<string, string[]>,
    private readonly netWorth: InMemoryNetWorthRepository,
  ) {}

  async netWorthByCompany(userId: string): Promise<CompanyNetWorth[]> {
    const companies = this.memberships[userId] ?? [];

    return Promise.all(
      companies.map(async (companyId) => ({
        companyId,
        companyName: `Empresa ${companyId}`,
        components: await this.netWorth.netWorthAt(companyId),
      })),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Application under test                                                      */
/* -------------------------------------------------------------------------- */

interface Harness {
  app: FastifyInstance;
  accounts: InMemoryAccountRepository;
  transactions: InMemoryTransactionRepository;
  investments: InMemoryInvestmentRepository;
  quotes: InMemoryQuoteRepository;
  loans: InMemoryLoanRepository;
  installments: InMemoryLoanInstallmentRepository;
  rates: InMemoryExchangeRateRepository;
  netWorth: InMemoryNetWorthRepository;
  events: DomainEvent<string>[];
}

/**
 * Wires the Phase 4 routes over in-memory repositories, with an auth hook that
 * injects a fixed context — the point being that the company and the user come
 * from the context and never from the request.
 */
async function buildApp(
  options: { companyId?: string; memberships?: Record<string, string[]> } = {},
): Promise<Harness> {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error: Error, _request, reply) => {
    if (error instanceof DomainError) {
      return reply
        .code(toHttpStatusCode(error.code))
        .send({ error: error.message });
    }
    return reply.code(500).send({ error: error.message });
  });

  const authenticate = async (request: {
    authContext?: { userId: string; companyId: string };
  }): Promise<void> => {
    request.authContext = {
      userId: USER_ID,
      companyId: options.companyId ?? COMPANY_ID,
    };
  };

  const accounts = new InMemoryAccountRepository();
  const transactions = new InMemoryTransactionRepository();
  const categories = new InMemoryCategoryRepository();
  const investments = new InMemoryInvestmentRepository();
  const quotes = new InMemoryQuoteRepository();
  const installments = new InMemoryLoanInstallmentRepository();
  const loans = new InMemoryLoanRepository(installments);
  const rates = new InMemoryExchangeRateRepository();
  const netWorth = new InMemoryNetWorthRepository();

  const account = Account.create({
    id: ACCOUNT_ID,
    companyId: COMPANY_ID,
    walletId: "wallet-1",
    name: "Corretora XP",
    number: "1",
    type: "INVESTMENT",
    currency: "BRL",
    initialBalance: 100000,
  }).getValueOrThrow();
  account.clearEvents();
  await accounts.create(account);

  categories.items.set(CAT_EXPENSE, {
    id: CAT_EXPENSE,
    companyId: COMPANY_ID,
    type: "EXPENSE",
  });
  categories.items.set(CAT_INCOME, {
    id: CAT_INCOME,
    companyId: COMPANY_ID,
    type: "INCOME",
  });

  const eventBus = new DomainEventBus();
  const events: DomainEvent<string>[] = [];
  const originalPublish = eventBus.publish.bind(eventBus);
  eventBus.publish = (event: DomainEvent<string>): void => {
    events.push(event);
    originalPublish(event);
  };

  const exchangeService = new ExchangeService(rates);
  const netWorthService = new NetWorthService(
    netWorth,
    exchangeService,
    new InMemoryCrossCompanyReader(
      options.memberships ?? { [USER_ID]: [COMPANY_ID] },
      netWorth,
    ),
  );

  const deps = {
    investmentController: new InvestmentController(
      investments,
      quotes,
      accounts,
      categories as unknown as CategoryRepository,
      transactions,
      new InvestmentOperationService(),
      eventBus,
    ),
    loanController: new LoanController(
      loans,
      installments,
      accounts,
      { findById: async () => null } as never,
      transactions,
      new LoanPaymentService(),
      new LoanAmortizationService(),
      eventBus,
    ),
    netWorthController: new NetWorthController(netWorthService),
    exchangeRateController: new ExchangeRateController(rates, eventBus),
    authenticate: authenticate as never,
  };

  await app.register(createInvestmentRoutes(deps), { prefix: "/investments" });
  await app.register(createLoanRoutes(deps), { prefix: "/loans" });
  await app.register(createNetWorthRoutes(deps), { prefix: "/net-worth" });
  await app.register(createExchangeRateRoutes(deps), {
    prefix: "/exchange-rates",
  });
  await app.ready();

  return {
    app,
    accounts,
    transactions,
    investments,
    quotes,
    loans,
    installments,
    rates,
    netWorth,
    events,
  };
}

function body(response: { body: string }): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

async function registerInvestment(
  harness: Harness,
): Promise<Record<string, unknown>> {
  const response = await harness.app.inject({
    method: "POST",
    url: "/investments",
    payload: {
      accountId: ACCOUNT_ID,
      name: "Petrobras PN",
      investmentType: "STOCK",
      symbol: "PETR4",
      expenseCategoryId: CAT_EXPENSE,
      incomeCategoryId: CAT_INCOME,
    },
  });

  assert.equal(response.statusCode, 201);
  return body(response);
}

async function contractLoan(
  harness: Harness,
): Promise<Record<string, unknown>> {
  const response = await harness.app.inject({
    method: "POST",
    url: "/loans",
    payload: {
      accountId: ACCOUNT_ID,
      description: "Empréstimo capital de giro",
      principalAmount: 1000,
      monthlyInterestPercent: 0,
      installmentCount: 2,
      installmentAmount: 500,
      firstDueDate: "2026-09-10",
    },
  });

  assert.equal(response.statusCode, 201);
  return body(response);
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe("Investment API", () => {
  it("registers an investment with an empty position", async () => {
    const harness = await buildApp();
    const investment = await registerInvestment(harness);

    assert.equal(investment.status, "ACTIVE");
    assert.equal(investment.investmentType, "STOCK");
    assert.ok(
      harness.events
        .map((event) => event.getEventType())
        .includes("InvestmentCreated"),
    );
  });

  it("registers a purchase, debits the account and links the transaction", async () => {
    const harness = await buildApp();
    const investment = await registerInvestment(harness);

    const response = await harness.app.inject({
      method: "POST",
      url: `/investments/${String(investment.id)}/operations`,
      payload: {
        operationType: "BUY",
        quantity: 100,
        unitPrice: 32.5,
        operatedAt: "2026-08-01",
      },
    });

    assert.equal(response.statusCode, 201);
    const payload = body(response);

    const transaction = payload.transaction as Record<string, unknown>;
    assert.equal(transaction.type, "EXPENSE");
    assert.equal(transaction.status, "CONFIRMED");
    assert.equal(transaction.grossAmount, 3250);
    assert.equal(transaction.categoryId, CAT_EXPENSE);

    const position = payload.position as Record<string, unknown>;
    assert.equal(position.quantity, 100);
    assert.equal(position.investedAmount, 3250);

    const account = await harness.accounts.findById(COMPANY_ID, ACCOUNT_ID);
    assert.equal(account?.balance.amount, 96750);
  });

  it("credits the account for dividends", async () => {
    const harness = await buildApp();
    const investment = await registerInvestment(harness);

    await harness.app.inject({
      method: "POST",
      url: `/investments/${String(investment.id)}/operations`,
      payload: {
        operationType: "BUY",
        quantity: 100,
        unitPrice: 32.5,
        operatedAt: "2026-08-01",
      },
    });

    const response = await harness.app.inject({
      method: "POST",
      url: `/investments/${String(investment.id)}/operations`,
      payload: {
        operationType: "DIVIDEND",
        amount: 50,
        operatedAt: "2026-08-05",
      },
    });

    assert.equal(response.statusCode, 201);
    const transaction = body(response).transaction as Record<string, unknown>;
    assert.equal(transaction.type, "INCOME");
    assert.equal(transaction.categoryId, CAT_INCOME);

    const account = await harness.accounts.findById(COMPANY_ID, ACCOUNT_ID);
    assert.equal(account?.balance.amount, 96800);
  });

  it("rejects a sale larger than the position and records nothing", async () => {
    const harness = await buildApp();
    const investment = await registerInvestment(harness);

    await harness.app.inject({
      method: "POST",
      url: `/investments/${String(investment.id)}/operations`,
      payload: {
        operationType: "BUY",
        quantity: 100,
        unitPrice: 32.5,
        operatedAt: "2026-08-01",
      },
    });

    const before = harness.transactions.items.size;

    const response = await harness.app.inject({
      method: "POST",
      url: `/investments/${String(investment.id)}/operations`,
      payload: {
        operationType: "SELL",
        quantity: 300,
        unitPrice: 38,
        operatedAt: "2026-08-10",
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(harness.transactions.items.size, before);
  });

  it("registers and replaces a quote for a date", async () => {
    const harness = await buildApp();
    const investment = await registerInvestment(harness);
    const url = `/investments/${String(investment.id)}/quotes`;

    assert.equal(
      (
        await harness.app.inject({
          method: "POST",
          url,
          payload: { unitPrice: 38, quoteDate: "2026-07-31" },
        })
      ).statusCode,
      201,
    );

    await harness.app.inject({
      method: "POST",
      url,
      payload: { unitPrice: 39.5, quoteDate: "2026-07-31" },
    });

    const list = body(await harness.app.inject({ method: "GET", url }));
    assert.equal(list.total, 1);
    assert.equal(
      (list.quotes as { unitPrice: number }[])[0]?.unitPrice,
      39.5,
    );
  });

  it("rejects a non-positive quote", async () => {
    const harness = await buildApp();
    const investment = await registerInvestment(harness);

    const response = await harness.app.inject({
      method: "POST",
      url: `/investments/${String(investment.id)}/quotes`,
      payload: { unitPrice: 0, quoteDate: "2026-07-31" },
    });

    assert.equal(response.statusCode, 400);
  });

  it("returns zeroed totals for an empty portfolio", async () => {
    const harness = await buildApp();

    const response = await harness.app.inject({
      method: "GET",
      url: "/investments/portfolio",
    });

    assert.equal(response.statusCode, 200);
    const totals = body(response).totals as Record<string, unknown>;
    assert.equal(totals.investedAmount, 0);
    assert.equal(totals.currentValue, 0);
  });

  it("refuses to close an investment with an open position", async () => {
    const harness = await buildApp();
    const investment = await registerInvestment(harness);

    await harness.app.inject({
      method: "POST",
      url: `/investments/${String(investment.id)}/operations`,
      payload: {
        operationType: "BUY",
        quantity: 100,
        unitPrice: 32.5,
        operatedAt: "2026-08-01",
      },
    });

    const response = await harness.app.inject({
      method: "POST",
      url: `/investments/${String(investment.id)}/close`,
    });

    assert.equal(response.statusCode, 400);
  });

  it("returns not found for an investment of another company", async () => {
    const harness = await buildApp();
    const investment = await registerInvestment(harness);

    // The same repositories, but the context now says another company.
    const other = await buildApp({ companyId: OTHER_COMPANY_ID });
    other.investments.items.set(
      String(investment.id),
      harness.investments.items.get(String(investment.id))!,
    );

    const response = await other.app.inject({
      method: "GET",
      url: `/investments/${String(investment.id)}`,
    });

    assert.equal(response.statusCode, 404);
  });
});

describe("Loan API", () => {
  it("contracts a loan with its full schedule", async () => {
    const harness = await buildApp();
    const loan = await contractLoan(harness);

    assert.equal(loan.status, "CONTRACTED");
    assert.equal(loan.outstandingBalance, 1000);
    assert.equal((loan.installments as unknown[]).length, 2);
    assert.ok(
      harness.events.map((event) => event.getEventType()).includes("LoanCreated"),
    );
  });

  it("rejects a schedule that does not repay the principal", async () => {
    const harness = await buildApp();

    const response = await harness.app.inject({
      method: "POST",
      url: "/loans",
      payload: {
        accountId: ACCOUNT_ID,
        description: "Empréstimo",
        principalAmount: 10000,
        monthlyInterestPercent: 1.5,
        installmentCount: 2,
        installmentAmount: 500,
        firstDueDate: "2026-09-10",
      },
    });

    assert.equal(response.statusCode, 400);
  });

  it("pays an installment, debits the account and starts the loan", async () => {
    const harness = await buildApp();
    const loan = await contractLoan(harness);

    const response = await harness.app.inject({
      method: "POST",
      url: `/loans/${String(loan.id)}/installments/1/payments`,
      payload: { accountId: ACCOUNT_ID, amount: 500, paidAt: "2026-09-10" },
    });

    assert.equal(response.statusCode, 200);
    const payload = body(response);
    assert.equal(payload.status, "IN_PROGRESS");
    assert.equal(payload.outstandingBalance, 500);
    assert.equal(payload.remainingInstallments, 1);

    const account = await harness.accounts.findById(COMPANY_ID, ACCOUNT_ID);
    assert.equal(account?.balance.amount, 99500);
  });

  it("settles the loan on the last payment", async () => {
    const harness = await buildApp();
    const loan = await contractLoan(harness);

    for (const number of [1, 2]) {
      await harness.app.inject({
        method: "POST",
        url: `/loans/${String(loan.id)}/installments/${number}/payments`,
        payload: { accountId: ACCOUNT_ID, amount: 500, paidAt: "2026-09-10" },
      });
    }

    const response = await harness.app.inject({
      method: "GET",
      url: `/loans/${String(loan.id)}`,
    });

    assert.equal(body(response).status, "SETTLED");
    assert.equal(body(response).outstandingBalance, 0);
    assert.ok(
      harness.events.map((event) => event.getEventType()).includes("LoanSettled"),
    );
  });

  it("rejects a second payment of the same installment", async () => {
    const harness = await buildApp();
    const loan = await contractLoan(harness);
    const url = `/loans/${String(loan.id)}/installments/1/payments`;
    const payload = {
      accountId: ACCOUNT_ID,
      amount: 500,
      paidAt: "2026-09-10",
    };

    await harness.app.inject({ method: "POST", url, payload });
    const before = harness.transactions.items.size;

    const response = await harness.app.inject({ method: "POST", url, payload });

    assert.equal(response.statusCode, 400);
    assert.equal(harness.transactions.items.size, before);
  });

  it("requires the payment date", async () => {
    const harness = await buildApp();
    const loan = await contractLoan(harness);

    const response = await harness.app.inject({
      method: "POST",
      url: `/loans/${String(loan.id)}/installments/1/payments`,
      payload: { accountId: ACCOUNT_ID, amount: 500 },
    });

    assert.equal(response.statusCode, 400);
    assert.match(String(body(response).error), /paidAt is required/);
  });

  it("registers an extra amortization that settles the loan", async () => {
    const harness = await buildApp();
    const loan = await contractLoan(harness);

    // The loan has to be in progress before it can be amortized.
    await harness.app.inject({
      method: "POST",
      url: `/loans/${String(loan.id)}/installments/1/payments`,
      payload: { accountId: ACCOUNT_ID, amount: 500, paidAt: "2026-09-10" },
    });

    const response = await harness.app.inject({
      method: "POST",
      url: `/loans/${String(loan.id)}/amortizations`,
      payload: { accountId: ACCOUNT_ID, amount: 500, paidAt: "2026-09-15" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(body(response).status, "SETTLED");
    assert.equal(body(response).outstandingBalance, 0);
  });

  it("rejects an amortization larger than the outstanding balance", async () => {
    const harness = await buildApp();
    const loan = await contractLoan(harness);

    await harness.app.inject({
      method: "POST",
      url: `/loans/${String(loan.id)}/installments/1/payments`,
      payload: { accountId: ACCOUNT_ID, amount: 500, paidAt: "2026-09-10" },
    });

    const response = await harness.app.inject({
      method: "POST",
      url: `/loans/${String(loan.id)}/amortizations`,
      payload: { accountId: ACCOUNT_ID, amount: 5000, paidAt: "2026-09-15" },
    });

    assert.equal(response.statusCode, 400);
  });

  it("returns not found for a loan of another company", async () => {
    const harness = await buildApp();
    const loan = await contractLoan(harness);

    const other = await buildApp({ companyId: OTHER_COMPANY_ID });
    other.loans.items.set(
      String(loan.id),
      harness.loans.items.get(String(loan.id))!,
    );

    const response = await other.app.inject({
      method: "GET",
      url: `/loans/${String(loan.id)}`,
    });

    assert.equal(response.statusCode, 404);
  });
});

describe("Exchange rate API", () => {
  it("registers a rate and publishes ExchangeRateRegistered", async () => {
    const harness = await buildApp();

    const response = await harness.app.inject({
      method: "POST",
      url: "/exchange-rates",
      payload: {
        sourceCurrency: "USD",
        targetCurrency: "BRL",
        rate: 5.2,
        rateDate: "2026-07-15",
      },
    });

    assert.equal(response.statusCode, 201);
    assert.ok(
      harness.events
        .map((event) => event.getEventType())
        .includes("ExchangeRateRegistered"),
    );
  });

  it("rejects identical currencies and a non-positive rate", async () => {
    const harness = await buildApp();

    const same = await harness.app.inject({
      method: "POST",
      url: "/exchange-rates",
      payload: {
        sourceCurrency: "BRL",
        targetCurrency: "BRL",
        rate: 1,
        rateDate: "2026-07-15",
      },
    });
    assert.equal(same.statusCode, 400);

    const zero = await harness.app.inject({
      method: "POST",
      url: "/exchange-rates",
      payload: {
        sourceCurrency: "USD",
        targetCurrency: "BRL",
        rate: 0,
        rateDate: "2026-07-15",
      },
    });
    assert.equal(zero.statusCode, 400);
  });

  it("lists only the rates of the current company", async () => {
    const harness = await buildApp();

    await harness.app.inject({
      method: "POST",
      url: "/exchange-rates",
      payload: {
        sourceCurrency: "USD",
        targetCurrency: "BRL",
        rate: 5.2,
        rateDate: "2026-07-15",
      },
    });

    // A rate belonging to another company, written straight into storage.
    harness.rates.items.push({
      id: randomUUID(),
      companyId: OTHER_COMPANY_ID,
      sourceCurrency: "EUR",
      targetCurrency: "BRL",
      rate: 6,
      rateDate: new Date("2026-07-15"),
      source: "MANUAL",
    });

    const response = await harness.app.inject({
      method: "GET",
      url: "/exchange-rates",
    });

    assert.equal(body(response).total, 1);
  });
});

describe("Net worth API", () => {
  it("returns assets, liabilities and net worth for the current company", async () => {
    const harness = await buildApp();
    harness.netWorth.components[COMPANY_ID] = [
      {
        component: "ACCOUNT_BALANCES",
        side: "ASSET",
        currency: "BRL",
        amount: 20000,
      },
      {
        component: "LOAN_BALANCES",
        side: "LIABILITY",
        currency: "BRL",
        amount: 8000,
      },
    ];

    const response = await harness.app.inject({
      method: "GET",
      url: "/net-worth",
    });

    assert.equal(response.statusCode, 200);
    const payload = body(response);
    assert.equal(payload.totalAssets, 20000);
    assert.equal(payload.totalLiabilities, 8000);
    assert.equal(payload.netWorth, 12000);
  });

  it("consolidates the three companies the user belongs to", async () => {
    const harness = await buildApp({
      memberships: { [USER_ID]: ["company-a", "company-b", "company-c"] },
    });

    for (const [companyId, amount] of [
      ["company-a", 50000],
      ["company-b", 30000],
      ["company-c", 20000],
    ] as const) {
      harness.netWorth.components[companyId] = [
        {
          component: "ACCOUNT_BALANCES",
          side: "ASSET",
          currency: "BRL",
          amount,
        },
      ];
    }

    const response = await harness.app.inject({
      method: "GET",
      url: "/net-worth/consolidated",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(body(response).total, 100000);
    assert.equal((body(response).companies as unknown[]).length, 3);
  });

  it("ignores a company the client names but the user does not belong to", async () => {
    const harness = await buildApp({
      memberships: { [USER_ID]: ["company-a"] },
    });

    harness.netWorth.components["company-a"] = [
      {
        component: "ACCOUNT_BALANCES",
        side: "ASSET",
        currency: "BRL",
        amount: 50000,
      },
    ];
    harness.netWorth.components["company-secret"] = [
      {
        component: "ACCOUNT_BALANCES",
        side: "ASSET",
        currency: "BRL",
        amount: 999999,
      },
    ];

    const response = await harness.app.inject({
      method: "GET",
      // Every shape a client might try to smuggle a company through.
      url: "/net-worth/consolidated?companyId=company-secret&companyIds=company-secret&companies=company-secret",
    });

    assert.equal(response.statusCode, 200);
    const payload = body(response);

    assert.equal(payload.total, 50000);
    assert.deepEqual(
      (payload.companies as { companyId: string }[]).map(
        (line) => line.companyId,
      ),
      ["company-a"],
    );
  });

  it("reports the missing pair instead of a partial consolidation", async () => {
    const harness = await buildApp({
      memberships: { [USER_ID]: ["company-a"] },
    });

    harness.netWorth.components["company-a"] = [
      {
        component: "ACCOUNT_BALANCES",
        side: "ASSET",
        currency: "USD",
        amount: 1000,
      },
    ];

    const response = await harness.app.inject({
      method: "GET",
      url: "/net-worth/consolidated",
    });

    assert.equal(response.statusCode, 404);
    assert.match(String(body(response).error), /USD\/BRL/);
  });
});
