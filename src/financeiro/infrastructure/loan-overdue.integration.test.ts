import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import knexLib, { type Knex } from "knex";
import { KnexLoanInstallmentRepository } from "./knex-loan-installment-repository.js";
import { KnexLoanRepository } from "./knex-loan-repository.js";

/**
 * Integration tests for the scheduler's overdue loan pass.
 *
 * What is being pinned is the idempotency: the second run of the same day finds
 * the installment already Overdue, the aggregate refuses the transition, and
 * the status-guarded UPDATE refuses a row someone else already moved — so
 * nothing transitions twice and nothing is published twice. Settled loans never
 * appear among the candidates at all.
 *
 * They need a migrated database; without DATABASE_URL the suite is skipped.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const skip = DATABASE_URL ? false : "DATABASE_URL is not set";

const COMPANY = randomUUID();
const WALLET = randomUUID();
const ACCOUNT = randomUUID();
const OPEN_LOAN = randomUUID();
const SETTLED_LOAN = randomUUID();
const OVERDUE_INSTALLMENT = randomUUID();
const FUTURE_INSTALLMENT = randomUUID();
const SETTLED_LOAN_INSTALLMENT = randomUUID();

const REFERENCE = new Date("2026-10-01T00:00:00Z");

let knex: Knex;
let loans: KnexLoanRepository;
let installments: KnexLoanInstallmentRepository;

function loanRow(id: string, status: string): Record<string, unknown> {
  return {
    id,
    company_id: COMPANY,
    account_id: ACCOUNT,
    description: `Empréstimo ${status}`,
    principal_amount: "1000.00",
    monthly_interest_percent: "0.0000",
    installment_count: 2,
    installment_amount: "500.00",
    currency: "BRL",
    first_due_date: "2026-09-10",
    status,
  };
}

function installmentRow(
  id: string,
  loanId: string,
  number: number,
  dueDate: string,
  status = "PENDING",
): Record<string, unknown> {
  return {
    id,
    company_id: COMPANY,
    loan_id: loanId,
    number,
    due_date: dueDate,
    amount: "500.00",
    interest_amount: "0.00",
    principal_amount: "500.00",
    status,
  };
}

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
    balance: "0.00",
    is_active: true,
  });

  await knex("loans").insert([
    loanRow(OPEN_LOAN, "IN_PROGRESS"),
    loanRow(SETTLED_LOAN, "SETTLED"),
  ]);

  await knex("loan_installments").insert([
    // Due 10/09, still pending at the 01/10 reference date.
    installmentRow(OVERDUE_INSTALLMENT, OPEN_LOAN, 1, "2026-09-10"),
    // Not due yet.
    installmentRow(FUTURE_INSTALLMENT, OPEN_LOAN, 2, "2026-11-10"),
    // Belongs to a settled loan: never a candidate.
    installmentRow(SETTLED_LOAN_INSTALLMENT, SETTLED_LOAN, 1, "2026-09-10"),
  ]);
}

async function cleanup(): Promise<void> {
  await knex("loan_installments").where("company_id", COMPANY).del();
  await knex("loan_payments").where("company_id", COMPANY).del();
  await knex("loans").where("company_id", COMPANY).del();
  await knex("accounts").where("company_id", COMPANY).del();
  await knex("wallets").where("company_id", COMPANY).del();
  await knex("companies").where("id", COMPANY).del();
}

/**
 * The pass the scheduler runs, reduced to what the idempotency depends on.
 *
 * The real pass is company-wide on purpose — the scheduler sweeps every
 * company. Here it is narrowed to this suite's company so a sibling suite's
 * fixtures cannot be counted into the assertions.
 */
async function runOverduePass(referenceDate: Date): Promise<number> {
  let flagged = 0;

  const candidates = (
    await installments.findOverdueCandidates(referenceDate)
  ).filter((candidate) => candidate.companyId === COMPANY);

  for (const installment of candidates) {
    const result = installment.markOverdue(referenceDate);
    if (result.isFailure) {
      continue;
    }

    const loan = await loans.findById(installment.companyId, installment.loanId);
    if (!loan) {
      continue;
    }

    const delinquent = loan.markDelinquent();
    await installments.update(installment);
    if (delinquent.isSuccess) {
      await loans.update(loan);
    }

    flagged += 1;
  }

  return flagged;
}

describe("Overdue loan installments pass", { skip }, () => {
  before(async () => {
    knex = knexLib({ client: "pg", connection: DATABASE_URL ?? "" });
    loans = new KnexLoanRepository(knex);
    installments = new KnexLoanInstallmentRepository(knex);

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

  it("flags the overdue installment and makes the loan delinquent", async () => {
    const flagged = await runOverduePass(REFERENCE);

    assert.equal(flagged, 1);

    const installment = await installments.findById(
      COMPANY,
      OVERDUE_INSTALLMENT,
    );
    assert.equal(installment?.status, "OVERDUE");

    const loan = await loans.findById(COMPANY, OPEN_LOAN);
    assert.equal(loan?.status, "DELINQUENT");
  });

  it("transitions nothing on a second run of the same day", async () => {
    const flagged = await runOverduePass(REFERENCE);

    assert.equal(flagged, 0);

    const installment = await installments.findById(
      COMPANY,
      OVERDUE_INSTALLMENT,
    );
    assert.equal(installment?.status, "OVERDUE");
  });

  it("leaves an installment that is not due yet alone", async () => {
    const installment = await installments.findById(
      COMPANY,
      FUTURE_INSTALLMENT,
    );

    assert.equal(installment?.status, "PENDING");
  });

  it("ignores the installments of a settled loan", async () => {
    const candidates = await installments.findOverdueCandidates(REFERENCE);

    assert.ok(
      !candidates.some(
        (candidate) => candidate.id === SETTLED_LOAN_INSTALLMENT,
      ),
    );

    const installment = await installments.findById(
      COMPANY,
      SETTLED_LOAN_INSTALLMENT,
    );
    assert.equal(installment?.status, "PENDING");

    const loan = await loans.findById(COMPANY, SETTLED_LOAN);
    assert.equal(loan?.status, "SETTLED");
  });

  it("refuses to write an installment another process already moved", async () => {
    const installment = await installments.findById(
      COMPANY,
      FUTURE_INSTALLMENT,
    );
    assert.ok(installment);

    // Somebody else pays it while this in-memory copy is stale.
    await knex("loan_installments")
      .where("id", FUTURE_INSTALLMENT)
      .update({ status: "PAID" });

    assert.equal(
      installment.markOverdue(new Date("2026-12-01T00:00:00Z")).isSuccess,
      true,
    );

    await assert.rejects(
      () => installments.update(installment),
      /no longer in a state that accepts this operation/,
    );

    // Restored so the next run of the suite starts from the same state.
    await knex("loan_installments")
      .where("id", FUTURE_INSTALLMENT)
      .update({ status: "PENDING" });
  });
});
