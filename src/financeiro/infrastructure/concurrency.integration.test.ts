import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import knexLib, { type Knex } from "knex";
import { InvestmentOperationService } from "../domain/investment-operation-service.js";
import { LoanPaymentService } from "../domain/loan-payment-service.js";
import { KnexAccountRepository } from "./knex-account-repository.js";
import { KnexInvestmentRepository } from "./knex-investment-repository.js";
import { KnexLoanInstallmentRepository } from "./knex-loan-installment-repository.js";
import { KnexLoanRepository } from "./knex-loan-repository.js";
import { KnexTransactionRepository } from "./knex-transaction-repository.js";

/**
 * The two concurrency invariants of Phase 4, exercised against a real database
 * because both of them live in the database:
 *
 * - **Double payment of the same installment** — barred by the status-guarded
 *   UPDATE (design, decision 7). The loser matches zero rows, throws, and the
 *   surrounding `runAtomic` takes its own expense transaction down with it, so
 *   no second transaction is ever left behind.
 * - **Concurrent sale larger than the position** — barred by `SELECT … FOR
 *   UPDATE` on the investment row (design, decision 4). The invariant is a sum
 *   over another table, so it does not fit in a WHERE clause; the lock is what
 *   makes the loser re-read a position it can no longer consume.
 *
 * Needs a migrated database; without DATABASE_URL the suite is skipped.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const skip = DATABASE_URL ? false : "DATABASE_URL is not set";

const COMPANY = randomUUID();
const WALLET = randomUUID();
const ACCOUNT = randomUUID();
const CAT_EXPENSE = randomUUID();
const CAT_INCOME = randomUUID();
const LOAN = randomUUID();
const INSTALLMENT = randomUUID();
const INVESTMENT = randomUUID();

const PAID_AT = new Date("2026-09-10T00:00:00Z");

let knex: Knex;
let transactions: KnexTransactionRepository;
let accounts: KnexAccountRepository;
let loans: KnexLoanRepository;
let installments: KnexLoanInstallmentRepository;
let investments: KnexInvestmentRepository;

const paymentService = new LoanPaymentService();
const operationService = new InvestmentOperationService();

async function seed(): Promise<void> {
  await knex("companies").insert({
    id: COMPANY,
    name: "Empresa",
    type: "CORPORATE",
    default_currency: "BRL",
  });
  await knex("wallets").insert({
    id: WALLET,
    company_id: COMPANY,
    name: "Carteira",
  });
  await knex("accounts").insert({
    id: ACCOUNT,
    company_id: COMPANY,
    wallet_id: WALLET,
    name: "Conta",
    number: "1",
    type: "CHECKING",
    currency: "BRL",
    balance: "100000.00",
    blocked_amount: "0.00",
    is_active: true,
  });
  await knex("categories").insert([
    {
      id: CAT_EXPENSE,
      company_id: COMPANY,
      name: "Investimentos",
      type: "EXPENSE",
    },
    {
      id: CAT_INCOME,
      company_id: COMPANY,
      name: "Rendimentos",
      type: "INCOME",
    },
  ]);

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
  });
  await knex("loan_installments").insert([
    {
      id: INSTALLMENT,
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

  // A position of 100 shares: two concurrent sales of 100 cannot both succeed.
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
}

async function cleanup(): Promise<void> {
  await knex("transactions").where("company_id", COMPANY).del();
  await knex("loan_payments").where("company_id", COMPANY).del();
  await knex("loan_installments").where("company_id", COMPANY).del();
  await knex("loans").where("company_id", COMPANY).del();
  await knex("investment_quotes").where("investment_id", INVESTMENT).del();
  await knex("investment_operations").where("company_id", COMPANY).del();
  await knex("investments").where("company_id", COMPANY).del();
  await knex("accounts").where("company_id", COMPANY).del();
  await knex("wallets").where("company_id", COMPANY).del();
  await knex("categories").where("company_id", COMPANY).del();
  await knex("companies").where("id", COMPANY).del();
}

/**
 * One attempt at paying the installment, exactly as the controller does it.
 */
async function payInstallment(): Promise<void> {
  const loan = await loans.findById(COMPANY, LOAN);
  const installment = await installments.findById(COMPANY, INSTALLMENT);
  const account = await accounts.findById(COMPANY, ACCOUNT);
  assert.ok(loan && installment && account);

  const schedule = await installments.listByLoan(COMPANY, LOAN);

  const result = paymentService.pay({
    loan,
    installment,
    installments: schedule,
    account,
    amount: 500,
    paidAt: PAID_AT,
  });

  if (result.isFailure || !result.value) {
    throw result.error ?? new Error("payment refused");
  }

  const { payment, paymentId, amount } = result.value;

  await transactions.runAtomic(async (executor) => {
    await transactions.create(payment, executor);
    await accounts.applyMovement(
      COMPANY,
      {
        transactionId: payment.id,
        accountId: ACCOUNT,
        direction: "DEBIT",
        amount,
      },
      executor,
    );
    await installments.update(installment, executor);
    await loans.update(loan, executor);
    await loans.registerPayment(
      {
        id: paymentId,
        companyId: COMPANY,
        loanId: LOAN,
        loanInstallmentId: INSTALLMENT,
        transactionId: payment.id,
        accountId: ACCOUNT,
        paymentType: "INSTALLMENT",
        amount: amount.toDecimalString(),
        principalAmount: installment.principalAmount.toDecimalString(),
        paidAt: PAID_AT,
      },
      executor,
    );
  });
}

/**
 * One attempt at selling the whole position, exactly as the controller does it —
 * including the lock that makes the loser re-read.
 */
async function sellEverything(): Promise<void> {
  const account = await accounts.findById(COMPANY, ACCOUNT);
  assert.ok(account);

  await transactions.runAtomic(async (executor) => {
    const investment = await investments.findByIdForUpdate(
      COMPANY,
      INVESTMENT,
      executor,
    );
    assert.ok(investment);

    const operations = await investments.listOperations(
      COMPANY,
      INVESTMENT,
      {},
      executor,
    );

    const result = operationService.register({
      investment,
      operations,
      account,
      input: {
        operationType: "SELL",
        quantity: 100,
        unitPrice: 38,
        operatedAt: new Date("2026-09-01T00:00:00Z"),
        today: new Date("2026-09-10T00:00:00Z"),
      },
    });

    if (result.isFailure || !result.value) {
      throw result.error ?? new Error("sale refused");
    }

    const { operation, payment } = result.value;

    // Same three steps as the controller: the operation without its link, the
    // transaction, then the link back.
    await investments.createOperation(operation, executor);
    await transactions.create(payment, executor);
    await investments.linkOperationTransaction(
      COMPANY,
      operation.id,
      payment.id,
      executor,
    );
    await accounts.applyMovement(
      COMPANY,
      {
        transactionId: payment.id,
        accountId: ACCOUNT,
        direction: "CREDIT",
        amount: operation.amount,
      },
      executor,
    );
  });
}

async function settle<T>(
  attempts: readonly Promise<T>[],
): Promise<{ fulfilled: number; rejected: number }> {
  const results = await Promise.allSettled(attempts);
  return {
    fulfilled: results.filter((result) => result.status === "fulfilled").length,
    rejected: results.filter((result) => result.status === "rejected").length,
  };
}

describe("Phase 4 concurrency invariants", { skip }, () => {
  before(async () => {
    knex = knexLib({ client: "pg", connection: DATABASE_URL ?? "" });
    transactions = new KnexTransactionRepository(knex);
    accounts = new KnexAccountRepository(knex);
    loans = new KnexLoanRepository(knex);
    installments = new KnexLoanInstallmentRepository(knex);
    investments = new KnexInvestmentRepository(knex);

    if (!(await knex.schema.hasTable("loan_installments"))) {
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

  it("lets exactly one of two simultaneous payments of the same installment through", async () => {
    const outcome = await settle([payInstallment(), payInstallment()]);

    assert.equal(outcome.fulfilled, 1);
    assert.equal(outcome.rejected, 1);
  });

  it("leaves no second expense transaction behind", async () => {
    const rows = (await knex("transactions")
      .where({ company_id: COMPANY, loan_installment_id: INSTALLMENT })
      .count<{ count: string }[]>("id as count")) as { count: string }[];

    assert.equal(Number(rows[0]?.count ?? 0), 1);

    const payments = (await knex("loan_payments")
      .where({ company_id: COMPANY, loan_installment_id: INSTALLMENT })
      .count<{ count: string }[]>("id as count")) as { count: string }[];

    assert.equal(Number(payments[0]?.count ?? 0), 1);
  });

  it("debits the account exactly once", async () => {
    const account = await accounts.findById(COMPANY, ACCOUNT);

    // 100.000,00 − 500,00, and not − 1.000,00.
    assert.equal(account?.balance.amount, 99500);
  });

  it("marks the installment paid once and only once", async () => {
    const installment = await installments.findById(COMPANY, INSTALLMENT);

    assert.equal(installment?.status, "PAID");
  });

  it("lets exactly one of two simultaneous sales of the whole position through", async () => {
    const outcome = await settle([sellEverything(), sellEverything()]);

    assert.equal(outcome.fulfilled, 1);
    assert.equal(outcome.rejected, 1);
  });

  it("never lets the position go negative", async () => {
    const summary = await investments.positionSummary(
      COMPANY,
      INVESTMENT,
      new Date("2026-09-30T00:00:00Z"),
    );

    assert.equal(summary.quantity, 0);
  });

  it("records only one sale operation and one income transaction", async () => {
    const sales = (await knex("investment_operations")
      .where({ investment_id: INVESTMENT, operation_type: "SELL" })
      .count<{ count: string }[]>("id as count")) as { count: string }[];

    assert.equal(Number(sales[0]?.count ?? 0), 1);

    const rows = (await knex("transactions")
      .where("company_id", COMPANY)
      .whereNotNull("investment_operation_id")
      .count<{ count: string }[]>("id as count")) as { count: string }[];

    assert.equal(Number(rows[0]?.count ?? 0), 1);
  });
});
