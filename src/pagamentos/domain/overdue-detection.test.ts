import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DomainEvent } from "../../shared/domain/domain-event.js";
import { Charge } from "./charge.js";
import { Payable } from "./payable.js";

const COMPANY = "company-1";
const DUE_DATE = new Date("2026-08-15T00:00:00Z");
const LATER = new Date("2026-08-20T00:00:00Z");
const EVEN_LATER = new Date("2026-08-25T00:00:00Z");

function charge(): Charge {
  const result = Charge.issue({
    companyId: COMPANY,
    customer: {
      id: "person-1",
      companyId: COMPANY,
      isActive: true,
      hasRole: (role) => role === "CUSTOMER",
    },
    amount: 1500,
    currency: "BRL",
    issueDate: new Date("2026-08-01T00:00:00Z"),
    dueDate: DUE_DATE,
  });

  assert.ok(result.value);
  result.value.clearEvents();
  return result.value;
}

function payable(): Payable {
  const result = Payable.register({
    companyId: COMPANY,
    supplier: {
      id: "person-2",
      companyId: COMPANY,
      isActive: true,
      hasRole: (role) => role === "SUPPLIER",
    },
    category: { id: "category-1", companyId: COMPANY, type: "EXPENSE" },
    amount: 1000,
    currency: "BRL",
    dueDate: DUE_DATE,
  });

  assert.ok(result.value);
  result.value.clearEvents();
  return result.value;
}

/**
 * The shape of one scheduler pass over a set of records: transition, collect
 * the events the bus would receive, clear. Everything the real pass adds is
 * persistence, which the aggregates below do not need to prove idempotence.
 */
function runPass<T extends { markOverdue(date: Date): { isFailure: boolean }; events: DomainEvent<string>[]; clearEvents(): void }>(
  records: readonly T[],
  referenceDate: Date,
): { transitioned: number; published: string[] } {
  const published: string[] = [];
  let transitioned = 0;

  for (const record of records) {
    if (record.markOverdue(referenceDate).isFailure) {
      continue;
    }

    for (const event of record.events) {
      published.push(event.getEventType());
    }
    record.clearEvents();
    transitioned += 1;
  }

  return { transitioned, published };
}

describe("Overdue detection pass", () => {
  it("transitions every charge past its due date and publishes one event each", () => {
    const charges = [charge(), charge(), charge()];

    const pass = runPass(charges, LATER);

    assert.equal(pass.transitioned, 3);
    assert.deepEqual(pass.published, [
      "ChargeOverdue",
      "ChargeOverdue",
      "ChargeOverdue",
    ]);
    assert.deepEqual(
      charges.map((each) => each.status),
      ["OVERDUE", "OVERDUE", "OVERDUE"],
    );
  });

  it("is idempotent: a second run on the same day transitions and publishes nothing", () => {
    const charges = [charge(), charge()];
    runPass(charges, LATER);

    const second = runPass(charges, LATER);

    assert.equal(second.transitioned, 0);
    assert.deepEqual(second.published, []);
  });

  it("stays idempotent on a later day too", () => {
    const charges = [charge()];
    runPass(charges, LATER);

    const later = runPass(charges, EVEN_LATER);

    assert.equal(later.transitioned, 0);
    assert.deepEqual(later.published, []);
    // The interest keeps growing even though the state does not move again.
    assert.equal(
      charges[0]!.amountsDueAt(EVEN_LATER).totalDue.greaterThanOrEqual(
        charges[0]!.amountsDueAt(LATER).totalDue,
      ),
      true,
    );
  });

  it("leaves a charge that is not yet due alone", () => {
    const charges = [charge()];

    const pass = runPass(charges, DUE_DATE);

    assert.equal(pass.transitioned, 0);
    assert.equal(charges[0]!.status, "ISSUED");
  });

  it("never reopens a settled or cancelled charge", () => {
    const paid = charge();
    paid.registerReceipt(paid.amountsDueAt(DUE_DATE).totalDue, DUE_DATE);
    paid.clearEvents();

    const cancelled = charge();
    cancelled.cancel("acordo");
    cancelled.clearEvents();

    const pass = runPass([paid, cancelled], LATER);

    assert.equal(pass.transitioned, 0);
    assert.equal(paid.status, "PAID");
    assert.equal(cancelled.status, "CANCELLED");
  });

  it("keeps processing the remaining records when one of them fails", () => {
    const alreadyPaid = charge();
    alreadyPaid.registerReceipt(alreadyPaid.amount, DUE_DATE);
    alreadyPaid.clearEvents();
    const pending = charge();

    const pass = runPass([alreadyPaid, pending], LATER);

    assert.equal(pass.transitioned, 1);
    assert.equal(pending.status, "OVERDUE");
  });

  it("behaves the same way for payables", () => {
    const payables = [payable(), payable()];

    const first = runPass(payables, LATER);
    assert.equal(first.transitioned, 2);
    assert.deepEqual(first.published, ["PayableOverdue", "PayableOverdue"]);

    const second = runPass(payables, LATER);
    assert.equal(second.transitioned, 0);
    assert.deepEqual(second.published, []);
  });
});
