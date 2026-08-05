import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import knexLib, { type Knex } from "knex";
import { KnexCrossCompanyRepository } from "./knex-cross-company-repository.js";
import { KnexNetWorthRepository } from "./knex-net-worth-repository.js";

/**
 * Integration tests for the net worth queries: the balance rebuilt at a past
 * date, the exclusion of inactive accounts, the portfolio priced by the quote
 * in force and the loan outstanding balance — all of which live in SQL and are
 * therefore invisible to the unit tests.
 *
 * They need a migrated database. Without DATABASE_URL the whole suite is
 * skipped, so `npm test` keeps working on a machine with no Postgres.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const skip = DATABASE_URL ? false : "DATABASE_URL is not set";

const COMPANY = randomUUID();
const OTHER_COMPANY = randomUUID();
const USER = randomUUID();
const OTHER_USER = randomUUID();

const WALLET = randomUUID();
const ACCOUNT = randomUUID();
const USD_ACCOUNT = randomUUID();
const INACTIVE_ACCOUNT = randomUUID();
const OTHER_ACCOUNT = randomUUID();

const CAT_EXPENSE = randomUUID();
const CAT_INCOME = randomUUID();

const INVESTMENT = randomUUID();
const LOAN = randomUUID();

const REFERENCE = new Date("2026-08-31T00:00:00Z");

let knex: Knex;
let netWorth: KnexNetWorthRepository;
let crossCompany: KnexCrossCompanyRepository;

async function insertTransaction(seed: {
  companyId?: string;
  accountId?: string;
  type: "INCOME" | "EXPENSE";
  amount: number;
  date: string;
  status?: string;
  currency?: string;
}): Promise<void> {
  await knex("transactions").insert({
    id: randomUUID(),
    company_id: seed.companyId ?? COMPANY,
    account_id: seed.accountId ?? ACCOUNT,
    type: seed.type,
    status: seed.status ?? "CONFIRMED",
    gross_amount: seed.amount.toFixed(2),
    net_amount: seed.amount.toFixed(2),
    currency: seed.currency ?? "BRL",
    date: seed.date,
    competence: seed.date,
  });
}

async function seed(): Promise<void> {
  await knex("companies").insert([
    { id: COMPANY, name: "Empresa A", type: "CORPORATE", default_currency: "BRL" },
    {
      id: OTHER_COMPANY,
      name: "Empresa B",
      type: "CORPORATE",
      default_currency: "BRL",
    },
  ]);

  await knex("users").insert([
    {
      id: USER,
      name: "Usuário",
      email: `${USER}@example.com`,
      password_hash: "x",
    },
    {
      id: OTHER_USER,
      name: "Outro",
      email: `${OTHER_USER}@example.com`,
      password_hash: "x",
    },
  ]);

  // The user belongs to both companies; the other user only to the second.
  await knex("company_users").insert([
    { id: randomUUID(), user_id: USER, company_id: COMPANY },
    { id: randomUUID(), user_id: USER, company_id: OTHER_COMPANY },
    { id: randomUUID(), user_id: OTHER_USER, company_id: OTHER_COMPANY },
  ]);

  await knex("wallets").insert({
    id: WALLET,
    company_id: COMPANY,
    name: "Carteira",
  });

  await knex("accounts").insert([
    {
      id: ACCOUNT,
      company_id: COMPANY,
      wallet_id: WALLET,
      name: "Conta Corrente",
      number: "1",
      type: "CHECKING",
      currency: "BRL",
      balance: "0.00",
      is_active: true,
    },
    {
      id: USD_ACCOUNT,
      company_id: COMPANY,
      wallet_id: WALLET,
      name: "Conta USD",
      number: "2",
      type: "CHECKING",
      currency: "USD",
      balance: "0.00",
      is_active: true,
    },
    {
      id: INACTIVE_ACCOUNT,
      company_id: COMPANY,
      wallet_id: WALLET,
      name: "Conta encerrada",
      number: "3",
      type: "CHECKING",
      currency: "BRL",
      balance: "0.00",
      is_active: false,
    },
    {
      id: OTHER_ACCOUNT,
      company_id: OTHER_COMPANY,
      wallet_id: WALLET,
      name: "Conta B",
      number: "4",
      type: "CHECKING",
      currency: "BRL",
      balance: "0.00",
      is_active: true,
    },
  ]);

  await knex("categories").insert([
    { id: CAT_EXPENSE, company_id: COMPANY, name: "Investimentos", type: "EXPENSE" },
    { id: CAT_INCOME, company_id: COMPANY, name: "Rendimentos", type: "INCOME" },
  ]);

  // R$ 10.000,00 in July, R$ 2.000,00 more in August: a reference date in July
  // must see only the first.
  await insertTransaction({ type: "INCOME", amount: 10000, date: "2026-07-10" });
  await insertTransaction({ type: "INCOME", amount: 2000, date: "2026-08-10" });
  // Excluded: pending, and a residual balance on an inactive account.
  await insertTransaction({
    type: "INCOME",
    amount: 500,
    date: "2026-08-11",
    status: "PENDING",
  });
  await insertTransaction({
    type: "INCOME",
    amount: 777,
    date: "2026-08-12",
    accountId: INACTIVE_ACCOUNT,
  });
  await insertTransaction({
    type: "INCOME",
    amount: 1000,
    date: "2026-08-13",
    accountId: USD_ACCOUNT,
    currency: "USD",
  });
  await insertTransaction({
    type: "INCOME",
    amount: 4000,
    date: "2026-08-14",
    companyId: OTHER_COMPANY,
    accountId: OTHER_ACCOUNT,
  });

  await knex("investments").insert({
    id: INVESTMENT,
    company_id: COMPANY,
    account_id: ACCOUNT,
    name: "Petrobras PN",
    investment_type: "STOCK",
    symbol: "PETR4",
    currency: "BRL",
    expense_category_id: CAT_EXPENSE,
    income_category_id: CAT_INCOME,
    status: "ACTIVE",
  });

  await knex("investment_operations").insert({
    id: randomUUID(),
    company_id: COMPANY,
    investment_id: INVESTMENT,
    operation_type: "BUY",
    quantity: "100.00000000",
    unit_price: "32.50000000",
    fees: "0.00",
    amount: "3250.00",
    currency: "BRL",
    operated_at: "2026-08-01",
  });

  await knex("investment_quotes").insert({
    id: randomUUID(),
    investment_id: INVESTMENT,
    quote_date: "2026-08-20",
    unit_price: "38.00000000",
    source: "MANUAL",
  });

  await knex("loans").insert({
    id: LOAN,
    company_id: COMPANY,
    account_id: ACCOUNT,
    description: "Empréstimo",
    principal_amount: "1000.00",
    monthly_interest_percent: "0.0000",
    installment_count: 2,
    installment_amount: "500.00",
    currency: "BRL",
    first_due_date: "2026-09-10",
    status: "IN_PROGRESS",
    created_at: "2026-07-01",
  });

  await knex("loan_installments").insert([
    {
      id: randomUUID(),
      company_id: COMPANY,
      loan_id: LOAN,
      number: 1,
      due_date: "2026-09-10",
      amount: "500.00",
      interest_amount: "0.00",
      principal_amount: "500.00",
      status: "PENDING",
    },
    {
      id: randomUUID(),
      company_id: COMPANY,
      loan_id: LOAN,
      number: 2,
      due_date: "2026-10-10",
      amount: "500.00",
      interest_amount: "0.00",
      principal_amount: "500.00",
      status: "PENDING",
    },
  ]);
}

async function cleanup(): Promise<void> {
  const companies = [COMPANY, OTHER_COMPANY];
  await knex("loan_installments").whereIn("company_id", companies).del();
  await knex("loan_payments").whereIn("company_id", companies).del();
  await knex("loans").whereIn("company_id", companies).del();
  await knex("investment_quotes").where("investment_id", INVESTMENT).del();
  await knex("investment_operations").whereIn("company_id", companies).del();
  await knex("investments").whereIn("company_id", companies).del();
  await knex("transactions").whereIn("company_id", companies).del();
  await knex("accounts").whereIn("company_id", companies).del();
  await knex("wallets").whereIn("company_id", companies).del();
  await knex("categories").whereIn("company_id", companies).del();
  await knex("company_users").whereIn("company_id", companies).del();
  await knex("users").whereIn("id", [USER, OTHER_USER]).del();
  await knex("companies").whereIn("id", companies).del();
}

function amountOf(
  rows: readonly { component: string; currency: string; amount: number }[],
  component: string,
  currency = "BRL",
): number {
  return (
    rows.find(
      (row) => row.component === component && row.currency === currency,
    )?.amount ?? 0
  );
}

describe("Net worth queries", { skip }, () => {
  before(async () => {
    knex = knexLib({ client: "pg", connection: DATABASE_URL ?? "" });
    netWorth = new KnexNetWorthRepository(knex);
    crossCompany = new KnexCrossCompanyRepository(knex, netWorth);

    if (!(await knex.schema.hasTable("investments"))) {
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

  it("rebuilds the account balance from the confirmed entries", async () => {
    const rows = await netWorth.netWorthAt(COMPANY, REFERENCE);

    // 10.000 in July + 2.000 in August; the pending 500 does not count.
    assert.equal(amountOf(rows, "ACCOUNT_BALANCES"), 12000);
  });

  it("answers about a past date, not about today", async () => {
    const rows = await netWorth.netWorthAt(
      COMPANY,
      new Date("2026-07-31T00:00:00Z"),
    );

    assert.equal(amountOf(rows, "ACCOUNT_BALANCES"), 10000);
  });

  it("excludes the residual balance of an inactive account", async () => {
    const rows = await netWorth.netWorthAt(COMPANY, REFERENCE);

    // The 777 sits on the inactive account and must not appear anywhere.
    assert.equal(amountOf(rows, "ACCOUNT_BALANCES"), 12000);
  });

  it("keeps each currency in its own component row", async () => {
    const rows = await netWorth.netWorthAt(COMPANY, REFERENCE);

    assert.equal(amountOf(rows, "ACCOUNT_BALANCES", "USD"), 1000);
  });

  it("prices the portfolio with the quote in force at the reference date", async () => {
    const rows = await netWorth.netWorthAt(COMPANY, REFERENCE);

    // 100 × R$ 38,00
    assert.equal(amountOf(rows, "INVESTMENT_PORTFOLIO"), 3800);
  });

  it("falls back to the invested cost before any quote exists", async () => {
    const rows = await netWorth.netWorthAt(
      COMPANY,
      new Date("2026-08-10T00:00:00Z"),
    );

    assert.equal(amountOf(rows, "INVESTMENT_PORTFOLIO"), 3250);
  });

  it("counts the open principal of a loan as a liability", async () => {
    const rows = await netWorth.netWorthAt(COMPANY, REFERENCE);

    const loans = rows.find((row) => row.component === "LOAN_BALANCES");
    assert.ok(loans);
    assert.equal(loans.side, "LIABILITY");
    assert.equal(loans.amount, 1000);
  });

  it("sees only the active company", async () => {
    const rows = await netWorth.netWorthAt(OTHER_COMPANY, REFERENCE);

    assert.equal(amountOf(rows, "ACCOUNT_BALANCES"), 4000);
    assert.equal(amountOf(rows, "INVESTMENT_PORTFOLIO"), 0);
  });

  it("restricts the reading to the filtered accounts", async () => {
    const rows = await netWorth.netWorthAt(COMPANY, REFERENCE, [ACCOUNT]);

    assert.equal(amountOf(rows, "ACCOUNT_BALANCES"), 12000);
    assert.equal(amountOf(rows, "ACCOUNT_BALANCES", "USD"), 0);
  });

  it("returns the company's default currency", async () => {
    assert.equal(await netWorth.defaultCurrency(COMPANY), "BRL");
  });

  describe("Cross-company reading", () => {
    it("resolves the companies from the user's memberships", async () => {
      const rows = await crossCompany.netWorthByCompany(USER, REFERENCE);

      assert.deepEqual(
        rows.map((row) => row.companyId).sort(),
        [COMPANY, OTHER_COMPANY].sort(),
      );
    });

    it("does not include a company the user does not belong to", async () => {
      const rows = await crossCompany.netWorthByCompany(OTHER_USER, REFERENCE);

      assert.deepEqual(
        rows.map((row) => row.companyId),
        [OTHER_COMPANY],
      );
    });
  });
});
