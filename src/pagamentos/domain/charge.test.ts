import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Money } from "../../financeiro/domain/money.js";
import { Charge } from "./charge.js";
import type { ChargeCustomer, IssueChargeInput } from "./charge.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const OTHER_COMPANY = "22222222-2222-2222-2222-222222222222";

const ISSUE_DATE = new Date("2026-08-01T00:00:00Z");
const DUE_DATE = new Date("2026-08-15T00:00:00Z");
const FIVE_DAYS_LATE = new Date("2026-08-20T00:00:00Z");

const brl = (amount: number): Money => Money.create(amount, "BRL");

function customer(
  overrides: Partial<ChargeCustomer> = {},
): ChargeCustomer {
  return {
    id: "person-1",
    companyId: COMPANY,
    isActive: true,
    hasRole: (role) => role === "CUSTOMER",
    ...overrides,
  };
}

function issue(overrides: Partial<IssueChargeInput> = {}): Charge {
  const result = Charge.issue({
    companyId: COMPANY,
    customer: customer(),
    amount: 1500,
    currency: "BRL",
    issueDate: ISSUE_DATE,
    dueDate: DUE_DATE,
    penaltyPercent: 2,
    monthlyInterestPercent: 1,
    ...overrides,
  });

  assert.equal(result.isSuccess, true, result.error?.message ?? "");
  return result.value!;
}

/**
 * Drives a charge into OVERDUE, which several transition tests start from.
 */
function overdue(): Charge {
  const charge = issue();
  assert.equal(charge.markOverdue(FIVE_DAYS_LATE).isSuccess, true);
  charge.clearEvents();
  return charge;
}

describe("Issue charge", () => {
  it("starts ISSUED and publishes ChargeIssued", () => {
    const charge = issue();

    assert.equal(charge.status, "ISSUED");
    assert.equal(charge.isOpen, true);
    assert.equal(charge.paidAt, undefined);
    assert.deepEqual(
      charge.events.map((event) => event.getEventType()),
      ["ChargeIssued"],
    );
  });

  it("rejects a non-positive amount", () => {
    assert.equal(
      Charge.issue({
        companyId: COMPANY,
        customer: customer(),
        amount: 0,
        currency: "BRL",
        issueDate: ISSUE_DATE,
        dueDate: DUE_DATE,
      }).error?.code,
      "VALIDATION_ERROR",
    );
  });

  it("rejects a due date earlier than the issue date", () => {
    const result = Charge.issue({
      companyId: COMPANY,
      customer: customer(),
      amount: 1500,
      currency: "BRL",
      issueDate: DUE_DATE,
      dueDate: ISSUE_DATE,
    });

    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });

  it("accepts a due date equal to the issue date", () => {
    const result = Charge.issue({
      companyId: COMPANY,
      customer: customer(),
      amount: 1500,
      currency: "BRL",
      issueDate: ISSUE_DATE,
      dueDate: ISSUE_DATE,
    });

    assert.equal(result.isSuccess, true);
  });

  it("rejects a person who is not a customer", () => {
    const result = Charge.issue({
      companyId: COMPANY,
      customer: customer({ hasRole: () => false }),
      amount: 1500,
      currency: "BRL",
      dueDate: DUE_DATE,
    });

    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
  });

  it("rejects an inactive customer", () => {
    const result = Charge.issue({
      companyId: COMPANY,
      customer: customer({ isActive: false }),
      amount: 1500,
      currency: "BRL",
      dueDate: DUE_DATE,
    });

    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
  });

  it("rejects a customer of another company", () => {
    const result = Charge.issue({
      companyId: COMPANY,
      customer: customer({ companyId: OTHER_COMPANY }),
      amount: 1500,
      currency: "BRL",
      dueDate: DUE_DATE,
    });

    assert.equal(result.error?.code, "UNAUTHORIZED_ACCESS");
  });

  it("rejects a percentage outside the 0-100 range", () => {
    assert.equal(
      Charge.issue({
        companyId: COMPANY,
        customer: customer(),
        amount: 1500,
        currency: "BRL",
        dueDate: DUE_DATE,
        penaltyPercent: 120,
      }).error?.code,
      "VALIDATION_ERROR",
    );
  });
});

describe("Charge amounts due", () => {
  it("charges nothing extra before the due date", () => {
    const due = issue().amountsDueAt(new Date("2026-08-10T00:00:00Z"));

    assert.equal(due.penalty.cents, 0);
    assert.equal(due.interest.cents, 0);
    assert.equal(due.totalDue.amount, 1500);
  });

  it("adds penalty and prorated interest once late", () => {
    const due = issue().amountsDueAt(FIVE_DAYS_LATE);

    assert.equal(due.penalty.amount, 30);
    assert.equal(due.interest.amount, 2.5);
    assert.equal(due.totalDue.amount, 1532.5);
  });

  it("grows the interest with the delay", () => {
    const charge = issue();

    const fiveDays = charge.amountsDueAt(FIVE_DAYS_LATE).totalDue;
    const tenDays = charge.amountsDueAt(
      new Date("2026-08-25T00:00:00Z"),
    ).totalDue;

    assert.equal(tenDays.greaterThan(fiveDays), true);
  });

  it("charges nothing extra when no percentage is configured", () => {
    const charge = issue({
      penaltyPercent: undefined,
      monthlyInterestPercent: undefined,
    });

    assert.equal(charge.amountsDueAt(FIVE_DAYS_LATE).totalDue.amount, 1500);
  });

  it("stops accruing once the charge is settled", () => {
    const charge = issue();
    charge.registerReceipt(brl(1500), DUE_DATE);

    assert.equal(charge.amountsDueAt(FIVE_DAYS_LATE).totalDue.amount, 1500);
  });
});

describe("Charge state machine", () => {
  it("moves ISSUED to OVERDUE and publishes ChargeOverdue with the delay", () => {
    const charge = issue();

    const result = charge.markOverdue(FIVE_DAYS_LATE);

    assert.equal(result.isSuccess, true);
    assert.equal(charge.status, "OVERDUE");
    const event = charge.events.at(-1) as unknown as { daysLate: number };
    assert.equal(event.daysLate, 5);
  });

  it("refuses to mark overdue before the due date", () => {
    const charge = issue();

    assert.equal(
      charge.markOverdue(new Date("2026-08-10T00:00:00Z")).error?.code,
      "INVALID_OPERATION",
    );
    assert.equal(charge.status, "ISSUED");
  });

  it("is idempotent: a second overdue pass changes nothing and emits nothing", () => {
    const charge = overdue();

    const second = charge.markOverdue(FIVE_DAYS_LATE);

    assert.equal(second.isFailure, true);
    assert.equal(charge.status, "OVERDUE");
    assert.deepEqual(charge.events, []);
  });

  it("moves ISSUED to PAID", () => {
    const charge = issue();

    assert.equal(charge.registerReceipt(brl(1500), DUE_DATE).isSuccess, true);
    assert.equal(charge.status, "PAID");
    assert.equal(charge.paidAt?.getTime(), DUE_DATE.getTime());
  });

  it("moves OVERDUE to PAID for the total due of the receipt date", () => {
    const charge = overdue();

    const result = charge.registerReceipt(brl(1532.5), FIVE_DAYS_LATE);

    assert.equal(result.isSuccess, true);
    assert.equal(result.value?.penalty.amount, 30);
    assert.equal(result.value?.interest.amount, 2.5);
    assert.equal(charge.status, "PAID");
  });

  it("moves ISSUED and OVERDUE to CANCELLED", () => {
    const fromIssued = issue();
    assert.equal(fromIssued.cancel("serviço não executado").isSuccess, true);
    assert.equal(fromIssued.status, "CANCELLED");

    const fromOverdue = overdue();
    assert.equal(fromOverdue.cancel("acordo").isSuccess, true);
    assert.equal(fromOverdue.status, "CANCELLED");
  });

  it("refuses every transition out of PAID", () => {
    const charge = issue();
    charge.registerReceipt(brl(1500), DUE_DATE);
    charge.clearEvents();

    assert.equal(charge.cancel("erro").error?.code, "INVALID_OPERATION");
    assert.equal(charge.markOverdue(FIVE_DAYS_LATE).error?.code, "INVALID_OPERATION");
    assert.equal(
      charge.registerReceipt(brl(1500), DUE_DATE).error?.code,
      "INVALID_OPERATION",
    );
    assert.equal(charge.edit({ amount: 10 }).error?.code, "INVALID_OPERATION");
    assert.equal(charge.status, "PAID");
    assert.deepEqual(charge.events, []);
  });

  it("refuses every transition out of CANCELLED", () => {
    const charge = issue();
    charge.cancel("serviço não executado");
    charge.clearEvents();

    assert.equal(
      charge.registerReceipt(brl(1500), DUE_DATE).error?.code,
      "INVALID_OPERATION",
    );
    assert.equal(charge.markOverdue(FIVE_DAYS_LATE).error?.code, "INVALID_OPERATION");
    assert.equal(charge.cancel("de novo").error?.code, "INVALID_OPERATION");
    assert.equal(charge.status, "CANCELLED");
    assert.deepEqual(charge.events, []);
  });
});

describe("Charge receipt", () => {
  it("rejects a partial receipt", () => {
    const charge = issue();

    const result = charge.registerReceipt(brl(1000), DUE_DATE);

    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
    assert.equal(charge.status, "ISSUED");
  });

  it("rejects an amount above the total due", () => {
    assert.equal(
      issue().registerReceipt(brl(2000), DUE_DATE).error?.code,
      "BUSINESS_RULE_VIOLATION",
    );
  });

  it("rejects the original amount once the charge is late", () => {
    // The total due moved to 1532,50 on that date, so 1500 no longer settles it.
    const result = overdue().registerReceipt(brl(1500), FIVE_DAYS_LATE);

    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
  });

  it("rejects a currency that is not the charge's", () => {
    const result = issue().registerReceipt(
      Money.create(1500, "USD"),
      DUE_DATE,
    );

    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
  });

  it("publishes ChargePaid with the frozen breakdown", () => {
    const charge = overdue();
    charge.registerReceipt(brl(1532.5), FIVE_DAYS_LATE);

    const event = charge.events.at(-1) as unknown as {
      penalty: Money;
      interest: Money;
    };
    assert.equal(event.penalty.amount, 30);
    assert.equal(event.interest.amount, 2.5);
  });
});

describe("Charge cancellation", () => {
  it("requires a reason", () => {
    const charge = issue();

    assert.equal(charge.cancel("   ").error?.code, "VALIDATION_ERROR");
    assert.equal(charge.status, "ISSUED");
  });

  it("keeps the reason and publishes ChargeCancelled", () => {
    const charge = issue();
    charge.clearEvents();

    charge.cancel("serviço não executado");

    assert.equal(charge.cancelReason, "serviço não executado");
    assert.notEqual(charge.cancelledAt, undefined);
    assert.deepEqual(
      charge.events.map((event) => event.getEventType()),
      ["ChargeCancelled"],
    );
  });
});

describe("Charge editing", () => {
  it("edits amount, due date, description and percentages while ISSUED", () => {
    const charge = issue();

    const result = charge.edit({
      amount: 2000,
      dueDate: new Date("2026-08-20T00:00:00Z"),
      description: "Serviço de agosto",
      penaltyPercent: 5,
      monthlyInterestPercent: 3,
    });

    assert.equal(result.isSuccess, true);
    assert.equal(charge.amount.amount, 2000);
    assert.equal(charge.dueDate.getTime(), FIVE_DAYS_LATE.getTime());
    assert.equal(charge.description, "Serviço de agosto");
    assert.equal(charge.penaltyPercent.value, 5);
    assert.equal(charge.monthlyInterestPercent.value, 3);
  });

  it("rejects an edit of an overdue charge", () => {
    assert.equal(overdue().edit({ amount: 2000 }).error?.code, "INVALID_OPERATION");
  });

  it("rejects an invalid value and leaves the charge untouched", () => {
    const charge = issue();

    assert.equal(charge.edit({ amount: 0 }).error?.code, "VALIDATION_ERROR");
    assert.equal(
      charge.edit({ dueDate: new Date("2026-07-01T00:00:00Z") }).error?.code,
      "VALIDATION_ERROR",
    );
    assert.equal(
      charge.edit({ penaltyPercent: 150 }).error?.code,
      "VALIDATION_ERROR",
    );

    assert.equal(charge.amount.amount, 1500);
    assert.equal(charge.dueDate.getTime(), DUE_DATE.getTime());
    assert.equal(charge.penaltyPercent.value, 2);
  });
});
