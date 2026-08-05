import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import knexLib, { type Knex } from "knex";
import { KnexReportingRepository } from "./knex-reporting-repository.js";

/**
 * Volume checks for RNF-PERF-002 (dashboard under 3s with 10.000 transactions)
 * and RNF-PERF-003 (a twelve-month report under 10s).
 *
 * Seeding 10.000 rows takes a few seconds, so this suite is opt-in and stays out
 * of the normal `npm test` run:
 *
 *   RUN_PERF_TESTS=1 npm test
 */
const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL
  ? "DATABASE_URL is not set"
  : process.env.RUN_PERF_TESTS !== "1"
    ? "set RUN_PERF_TESTS=1 to run the volume checks"
    : false;

const TRANSACTION_COUNT = 10_000;
const DASHBOARD_BUDGET_MS = 3_000;
const REPORT_BUDGET_MS = 10_000;

const COMPANY = randomUUID();
const WALLET = randomUUID();
const ACCOUNT = randomUUID();
const ROOT_CATEGORIES = [randomUUID(), randomUUID(), randomUUID()];
const CHILD_CATEGORY = randomUUID();
const INCOME_CATEGORY = randomUUID();

let knex: Knex;
let reporting: KnexReportingRepository;

/**
 * Twelve months ending in August 2026 — the window both RNFs are stated for.
 */
const SCOPE = {
  companyId: COMPANY,
  start: new Date("2025-09-01T00:00:00Z"),
  end: new Date("2026-08-31T00:00:00Z"),
};

async function measure(label: string, work: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await work();
  const elapsed = performance.now() - started;
  console.log(`  ${label}: ${elapsed.toFixed(0)}ms`);
  return elapsed;
}

async function seed(): Promise<void> {
  await knex("companies").insert({
    id: COMPANY,
    name: "Volume",
    type: "CORPORATE",
  });
  await knex("wallets").insert({
    id: WALLET,
    company_id: COMPANY,
    name: "Principal",
  });
  await knex("accounts").insert({
    id: ACCOUNT,
    company_id: COMPANY,
    wallet_id: WALLET,
    name: "Conta",
    number: "1",
    type: "CHECKING",
    currency: "BRL",
    balance: "10000.00",
  });

  await knex("categories").insert([
    ...ROOT_CATEGORIES.map((id, index) => ({
      id,
      company_id: COMPANY,
      name: `Categoria ${index}`,
      type: "EXPENSE",
    })),
    {
      id: CHILD_CATEGORY,
      company_id: COMPANY,
      name: "Subcategoria",
      type: "EXPENSE",
      parent_id: ROOT_CATEGORIES[0],
    },
    {
      id: INCOME_CATEGORY,
      company_id: COMPANY,
      name: "Receita",
      type: "INCOME",
    },
  ]);

  const categories = [...ROOT_CATEGORIES, CHILD_CATEGORY];
  const rows = Array.from({ length: TRANSACTION_COUNT }, (_, index) => {
    const day = (index % 28) + 1;
    const monthOffset = index % 12;
    const date = new Date(Date.UTC(2025, 8 + monthOffset, day));
    const isIncome = index % 7 === 0;

    return {
      id: randomUUID(),
      company_id: COMPANY,
      account_id: ACCOUNT,
      category_id: isIncome
        ? INCOME_CATEGORY
        : categories[index % categories.length],
      type: isIncome ? "INCOME" : "EXPENSE",
      status: index % 11 === 0 ? "CANCELLED" : "CONFIRMED",
      gross_amount: "100.00",
      net_amount: "100.00",
      currency: "BRL",
      date,
      competence: date,
    };
  });

  for (let offset = 0; offset < rows.length; offset += 1000) {
    await knex("transactions").insert(rows.slice(offset, offset + 1000));
  }
}

async function cleanup(): Promise<void> {
  await knex("transactions").where("company_id", COMPANY).del();
  await knex("accounts").where("company_id", COMPANY).del();
  await knex("wallets").where("company_id", COMPANY).del();
  await knex("categories").where("company_id", COMPANY).del();
  await knex("companies").where("id", COMPANY).del();
}

describe("Reporting performance", { skip }, () => {
  before(async () => {
    knex = knexLib({ client: "pg", connection: DATABASE_URL ?? "" });
    reporting = new KnexReportingRepository(knex);
    await cleanup();
    await seed();
    await knex.raw("ANALYZE transactions");
  });

  after(async () => {
    await cleanup();
    await knex.destroy();
  });

  it(`answers the dashboard in under ${DASHBOARD_BUDGET_MS}ms`, async () => {
    const month = {
      companyId: COMPANY,
      start: new Date("2026-08-01T00:00:00Z"),
      end: new Date("2026-08-31T00:00:00Z"),
    };

    const elapsed = await measure("dashboard", () =>
      // The controller runs these in parallel; so does this measurement.
      Promise.all([
        reporting.periodIndicators(month),
        reporting.spendingByCategory(month),
        reporting.monthlySeries(month),
        reporting.budgetSummary(month),
        reporting.goalSummary(COMPANY),
        reporting.cardSummary(COMPANY),
      ]),
    );

    assert.ok(
      elapsed < DASHBOARD_BUDGET_MS,
      `dashboard took ${elapsed.toFixed(0)}ms, budget is ${DASHBOARD_BUDGET_MS}ms`,
    );
  });

  it(`produces a twelve-month report in under ${REPORT_BUDGET_MS}ms`, async () => {
    const elapsed = await measure("12-month reports", () =>
      Promise.all([
        reporting.cashFlow(SCOPE),
        reporting.incomeStatement(SCOPE),
        reporting.spendingByCategory(SCOPE),
        reporting.spendingByAccount(SCOPE),
        reporting.spendingByCard(SCOPE),
      ]),
    );

    assert.ok(
      elapsed < REPORT_BUDGET_MS,
      `reports took ${elapsed.toFixed(0)}ms, budget is ${REPORT_BUDGET_MS}ms`,
    );
  });

  it("has the aggregation indexes in place", async () => {
    const rows = (await knex.raw(
      `SELECT indexname FROM pg_indexes WHERE tablename IN ('transactions', 'invoices')`,
    )) as { rows: { indexname: string }[] };

    const names = new Set(rows.rows.map((row) => row.indexname));

    for (const index of [
      "transactions_company_status_date_idx",
      "transactions_company_category_status_date_idx",
      "transactions_card_invoice_idx",
      "invoices_company_status_due_idx",
    ]) {
      assert.ok(names.has(index), `missing index ${index}`);
    }

    // Whether the planner picks them is its call: at 10.000 rows a period scan
    // touches most of the table, so a sequential scan is the cheaper plan and
    // the budgets above are still met. The indexes are what keeps that true as
    // the table grows, and what makes the selective lookups cheap today.
    const plan = (await knex.raw(
      `EXPLAIN SELECT COALESCE(SUM(net_amount), 0)
         FROM transactions
        WHERE company_id = ? AND status = 'CONFIRMED'
          AND date >= ? AND date <= ?`,
      [COMPANY, SCOPE.start, SCOPE.end],
    )) as { rows: { "QUERY PLAN": string }[] };

    console.log(`  plan: ${plan.rows[1]?.["QUERY PLAN"]?.trim() ?? ""}`);
  });
});
