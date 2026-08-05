import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import knexLib, { type Knex } from "knex";
import { KnexBudgetRepository } from "./knex-budget-repository.js";
import { KnexCardRepository } from "./knex-card-repository.js";
import { KnexReportingRepository } from "./knex-reporting-repository.js";
import { Budget } from "../domain/budget.js";
import { Money } from "../domain/money.js";
import { Period } from "../domain/period.js";

/**
 * Integration tests for the aggregation queries: the rollup, zero filling and
 * "what counts as a confirmed expense" rules that live in SQL and therefore
 * cannot be covered by the unit tests.
 *
 * They need a migrated database. Without DATABASE_URL the whole suite is
 * skipped, so `npm test` keeps working on a machine with no Postgres.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const skip = DATABASE_URL ? false : "DATABASE_URL is not set";

const COMPANY = randomUUID();
const OTHER_COMPANY = randomUUID();

const WALLET = randomUUID();
const ACCOUNT_A = randomUUID();
const ACCOUNT_B = randomUUID();
const OTHER_ACCOUNT = randomUUID();

const CAT_FOOD = randomUUID();
const CAT_MARKET = randomUUID();
const CAT_TRANSPORT = randomUUID();
const CAT_SALARY = randomUUID();

const CARD = randomUUID();
const OPEN_INVOICE = randomUUID();
const CLOSED_INVOICE = randomUUID();

let knex: Knex;
let reporting: KnexReportingRepository;

/**
 * Period under test: August 2026.
 */
const SCOPE = {
  companyId: COMPANY,
  start: new Date("2026-08-01T00:00:00Z"),
  end: new Date("2026-08-31T00:00:00Z"),
};

interface TransactionSeed {
  id?: string;
  companyId?: string;
  accountId?: string;
  categoryId?: string | null;
  type: "INCOME" | "EXPENSE";
  status?: string;
  amount: number;
  date: string;
  cardId?: string | null;
  invoiceId?: string | null;
}

async function insertTransaction(seed: TransactionSeed): Promise<void> {
  await knex("transactions").insert({
    id: seed.id ?? randomUUID(),
    company_id: seed.companyId ?? COMPANY,
    account_id: seed.accountId ?? ACCOUNT_A,
    category_id: seed.categoryId ?? null,
    type: seed.type,
    status: seed.status ?? "CONFIRMED",
    gross_amount: seed.amount.toFixed(2),
    net_amount: seed.amount.toFixed(2),
    currency: "BRL",
    date: seed.date,
    competence: seed.date,
    card_id: seed.cardId ?? null,
    invoice_id: seed.invoiceId ?? null,
  });
}

async function seed(): Promise<void> {
  await knex("companies").insert([
    { id: COMPANY, name: "Empresa A", type: "CORPORATE" },
    { id: OTHER_COMPANY, name: "Empresa B", type: "CORPORATE" },
  ]);

  await knex("wallets").insert({ id: WALLET, company_id: COMPANY, name: "Principal" });

  await knex("accounts").insert([
    {
      id: ACCOUNT_A,
      company_id: COMPANY,
      wallet_id: WALLET,
      name: "Conta Corrente",
      number: "1",
      type: "CHECKING",
      currency: "BRL",
      balance: "3000.00",
    },
    {
      id: ACCOUNT_B,
      company_id: COMPANY,
      wallet_id: WALLET,
      name: "Poupança",
      number: "2",
      type: "SAVINGS",
      currency: "BRL",
      balance: "2000.00",
    },
    {
      id: OTHER_ACCOUNT,
      company_id: OTHER_COMPANY,
      wallet_id: null,
      name: "Outra",
      number: "9",
      type: "CHECKING",
      currency: "BRL",
      balance: "9999.00",
    },
  ]);

  await knex("categories").insert([
    { id: CAT_FOOD, company_id: COMPANY, name: "Alimentação", type: "EXPENSE" },
    {
      id: CAT_MARKET,
      company_id: COMPANY,
      name: "Mercado",
      type: "EXPENSE",
      parent_id: CAT_FOOD,
    },
    {
      id: CAT_TRANSPORT,
      company_id: COMPANY,
      name: "Transporte",
      type: "EXPENSE",
    },
    { id: CAT_SALARY, company_id: COMPANY, name: "Salário", type: "INCOME" },
  ]);

  await knex("cards").insert({
    id: CARD,
    company_id: COMPANY,
    account_id: ACCOUNT_A,
    name: "Nubank",
    type: "CREDIT",
    brand: "Visa",
    credit_limit: "5000.00",
    closing_day: 3,
    due_day: 10,
    is_active: true,
  });

  await knex("invoices").insert([
    {
      id: OPEN_INVOICE,
      company_id: COMPANY,
      card_id: CARD,
      cycle_start: "2026-08-04",
      closing_date: "2026-09-03",
      due_date: "2026-09-10",
      status: "OPEN",
      total_amount: "0.00",
      paid_amount: "0.00",
      currency: "BRL",
    },
    {
      id: CLOSED_INVOICE,
      company_id: COMPANY,
      card_id: CARD,
      cycle_start: "2026-07-04",
      closing_date: "2026-08-03",
      due_date: "2026-08-10",
      status: "PARTIALLY_PAID",
      total_amount: "1000.00",
      paid_amount: "400.00",
      currency: "BRL",
    },
  ]);

  await insertTransaction({
    type: "INCOME",
    categoryId: CAT_SALARY,
    amount: 8000,
    date: "2026-08-05",
  });

  // 600 in Alimentação directly + 150 in its subcategory: the breakdown must
  // roll both into Alimentação.
  await insertTransaction({
    type: "EXPENSE",
    categoryId: CAT_FOOD,
    amount: 600,
    date: "2026-08-06",
  });
  await insertTransaction({
    type: "EXPENSE",
    categoryId: CAT_MARKET,
    amount: 150,
    date: "2026-08-07",
  });
  await insertTransaction({
    type: "EXPENSE",
    categoryId: CAT_TRANSPORT,
    amount: 250,
    date: "2026-08-08",
    accountId: ACCOUNT_B,
  });

  // Excluded: cancelled, refunded, out of period, another company.
  await insertTransaction({
    type: "EXPENSE",
    categoryId: CAT_FOOD,
    amount: 300,
    date: "2026-08-09",
    status: "CANCELLED",
  });
  await insertTransaction({
    type: "EXPENSE",
    categoryId: CAT_FOOD,
    amount: 400,
    date: "2026-08-10",
    status: "REFUNDED",
  });
  await insertTransaction({
    type: "EXPENSE",
    categoryId: CAT_FOOD,
    amount: 900,
    date: "2026-09-02",
  });
  await insertTransaction({
    type: "EXPENSE",
    categoryId: null,
    amount: 777,
    date: "2026-08-11",
    companyId: OTHER_COMPANY,
    accountId: OTHER_ACCOUNT,
  });

  // Unbilled purchase sitting in the card's open cycle.
  await insertTransaction({
    type: "EXPENSE",
    categoryId: CAT_TRANSPORT,
    amount: 200,
    date: "2026-08-12",
    cardId: CARD,
    invoiceId: OPEN_INVOICE,
  });
}

async function cleanup(): Promise<void> {
  // Everything hangs off the companies rows by cascade, except the cards and
  // invoices, whose FKs are restrictive.
  await knex("transactions").whereIn("company_id", [COMPANY, OTHER_COMPANY]).del();
  await knex("budgets").where("company_id", COMPANY).del();
  await knex("goals").where("company_id", COMPANY).del();
  await knex("invoices").where("company_id", COMPANY).del();
  await knex("cards").where("company_id", COMPANY).del();
  await knex("accounts").whereIn("company_id", [COMPANY, OTHER_COMPANY]).del();
  await knex("wallets").where("company_id", COMPANY).del();
  await knex("categories").where("company_id", COMPANY).del();
  await knex("companies").whereIn("id", [COMPANY, OTHER_COMPANY]).del();
}

describe("Reporting queries", { skip }, () => {
  before(async () => {
    knex = knexLib({ client: "pg", connection: DATABASE_URL ?? "" });
    reporting = new KnexReportingRepository(knex);

    if (!(await knex.schema.hasTable("cards"))) {
      throw new Error(
        "The database is not migrated; run `npm run db:migrate` first",
      );
    }

    await cleanup();
    await seed();
  });

  after(async () => {
    await cleanup();
    await knex.destroy();
  });

  describe("Period indicators", () => {
    it("sums confirmed income and expense and the net worth", async () => {
      const indicators = await reporting.periodIndicators(SCOPE);

      assert.equal(indicators.income, 8000);
      // 600 + 150 + 250 + 200 (card purchase counts as competence expense).
      assert.equal(indicators.expense, 1200);
      assert.equal(indicators.result, 6800);
      assert.equal(indicators.netWorth, 5000);
    });

    it("excludes cancelled and refunded transactions", async () => {
      const indicators = await reporting.periodIndicators(SCOPE);

      // The cancelled 300 and the refunded 400 would show up here.
      assert.ok(indicators.expense < 1500);
    });

    it("excludes transactions outside the period", async () => {
      const september = await reporting.periodIndicators({
        ...SCOPE,
        start: new Date("2026-09-01T00:00:00Z"),
        end: new Date("2026-09-30T00:00:00Z"),
      });

      assert.equal(september.expense, 900);
      assert.equal(september.income, 0);
    });

    it("only sees the active company", async () => {
      const other = await reporting.periodIndicators({
        ...SCOPE,
        companyId: OTHER_COMPANY,
      });

      assert.equal(other.expense, 777);
      assert.equal(other.income, 0);
    });

    it("restricts indicators and net worth to the filtered accounts", async () => {
      const filtered = await reporting.periodIndicators({
        ...SCOPE,
        accountIds: [ACCOUNT_B],
      });

      assert.equal(filtered.expense, 250);
      assert.equal(filtered.income, 0);
      assert.equal(filtered.netWorth, 2000);
    });
  });

  describe("Spending by category", () => {
    it("rolls subcategory spending into the top-level category", async () => {
      const rows = await reporting.spendingByCategory(SCOPE);

      const food = rows.find((row) => row.categoryName === "Alimentação");
      assert.ok(food);
      // 600 directly plus 150 in Mercado.
      assert.equal(food.amount, 750);
      assert.ok(!rows.some((row) => row.categoryName === "Mercado"));
    });

    it("orders by amount descending and carries the percentage", async () => {
      const rows = await reporting.spendingByCategory(SCOPE);

      assert.deepEqual(
        rows.map((row) => row.categoryName),
        ["Alimentação", "Transporte"],
      );
      // 750 and 450 out of 1200.
      assert.equal(rows[0]?.percent, 62.5);
      assert.equal(rows[1]?.percent, 37.5);
    });

    it("returns an empty breakdown instead of failing", async () => {
      const rows = await reporting.spendingByCategory({
        ...SCOPE,
        start: new Date("2026-01-01T00:00:00Z"),
        end: new Date("2026-01-31T00:00:00Z"),
      });

      assert.deepEqual(rows, []);
    });
  });

  describe("Monthly evolution", () => {
    it("returns twelve months ending in the reference month", async () => {
      const series = await reporting.monthlySeries(SCOPE);

      assert.equal(series.length, 12);
      assert.equal(series[0]?.month, "2025-09");
      assert.equal(series.at(-1)?.month, "2026-08");
    });

    it("fills months with no movement with zeros", async () => {
      const series = await reporting.monthlySeries(SCOPE);

      const quiet = series.find((row) => row.month === "2026-01");
      assert.ok(quiet);
      assert.equal(quiet.income, 0);
      assert.equal(quiet.expense, 0);

      const august = series.find((row) => row.month === "2026-08");
      assert.equal(august?.income, 8000);
      assert.equal(august?.expense, 1200);
    });
  });

  describe("Cash flow", () => {
    it("accumulates the monthly result across the period", async () => {
      const rows = await reporting.cashFlow({
        ...SCOPE,
        start: new Date("2026-07-01T00:00:00Z"),
        end: new Date("2026-09-30T00:00:00Z"),
      });

      assert.deepEqual(
        rows.map((row) => row.month),
        ["2026-07", "2026-08", "2026-09"],
      );
      assert.equal(rows[0]?.result, 0);
      assert.equal(rows[1]?.result, 6800);
      assert.equal(rows[2]?.result, -900);
      assert.equal(rows.at(-1)?.accumulated, 5900);
    });
  });

  describe("Income statement", () => {
    it("groups revenue and expenses by category", async () => {
      const rows = await reporting.incomeStatement(SCOPE);

      const revenue = rows.filter((row) => row.group === "INCOME");
      assert.equal(revenue.length, 1);
      assert.equal(revenue[0]?.categoryName, "Salário");
      assert.equal(revenue[0]?.amount, 8000);

      const expenses = rows.filter((row) => row.group === "EXPENSE");
      assert.equal(
        expenses.reduce((sum, row) => sum + row.amount, 0),
        1200,
      );
    });
  });

  describe("Spending by dimension", () => {
    it("totals the amount charged to each card", async () => {
      const rows = await reporting.spendingByCard(SCOPE);

      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.dimensionName, "Nubank");
      assert.equal(rows[0]?.amount, 200);
      assert.equal(rows[0]?.percent, 100);
    });

    it("totals the amount spent from each account", async () => {
      const rows = await reporting.spendingByAccount(SCOPE);

      const byName = new Map(
        rows.map((row) => [row.dimensionName, row.amount]),
      );
      assert.equal(byName.get("Conta Corrente"), 950);
      assert.equal(byName.get("Poupança"), 250);
    });
  });

  describe("Phase 2 summaries", () => {
    it("reports the card limit, available limit and open invoice", async () => {
      const rows = await reporting.cardSummary(COMPANY);

      assert.equal(rows.length, 1);
      const card = rows[0];
      assert.ok(card);
      assert.equal(card.limit, 5000);
      assert.equal(card.openInvoiceAmount, 200);
      // 200 unbilled + 600 outstanding on the partially paid invoice.
      assert.equal(card.availableLimit, 4200);
      assert.equal(
        card.nextDueDate?.toISOString().slice(0, 10),
        "2026-08-10",
      );
    });

    it("matches the card repository's committed amount", async () => {
      const cards = new KnexCardRepository(knex);
      const committed = await cards.committedAmount(COMPANY, CARD);

      assert.equal(committed.amount, 800);
    });

    it("returns zeroed summaries when the company has no records", async () => {
      const [budgets, goals, cards] = await Promise.all([
        reporting.budgetSummary({ ...SCOPE, companyId: OTHER_COMPANY }),
        reporting.goalSummary(OTHER_COMPANY),
        reporting.cardSummary(OTHER_COMPANY),
      ]);

      assert.deepEqual(budgets, {
        count: 0,
        planned: 0,
        actual: 0,
        exceeded: 0,
      });
      assert.equal(goals.activeCount, 0);
      assert.deepEqual(cards, []);
    });
  });

  describe("Budget actual amount", () => {
    it("sums the category and its descendants inside the period", async () => {
      const budgets = new KnexBudgetRepository(knex);
      const budget = new Budget({
        id: randomUUID(),
        companyId: COMPANY,
        categoryId: CAT_FOOD,
        period: Period.create(SCOPE.start, SCOPE.end),
        plannedAmount: Money.create(800, "BRL"),
        currency: "BRL",
      });

      await budgets.create(budget);

      // 600 in Alimentação + 150 in Mercado; the cancelled, refunded and
      // September ones stay out.
      const actual = await budgets.actualAmount(budget);
      assert.equal(actual.amount, 750);

      const progress = budget.progress(actual);
      assert.equal(progress.value?.percentUsed, 93.75);
      assert.equal(progress.value?.exceeded, false);
    });

    it("counts an exceeded budget in the dashboard summary", async () => {
      const budgets = new KnexBudgetRepository(knex);
      const budget = new Budget({
        id: randomUUID(),
        companyId: COMPANY,
        categoryId: CAT_TRANSPORT,
        period: Period.create(SCOPE.start, SCOPE.end),
        plannedAmount: Money.create(100, "BRL"),
        currency: "BRL",
      });

      await budgets.create(budget);

      const summary = await reporting.budgetSummary(SCOPE);
      assert.ok(summary.count >= 1);
      assert.ok(summary.exceeded >= 1);
    });
  });
});
