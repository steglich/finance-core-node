import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Money } from "../../financeiro/domain/money.js";
import { Percent } from "../../financeiro/domain/percent.js";
import {
  amountsDueFor,
  daysLate,
  interestFor,
  penaltyFor,
} from "./charge-math.js";

const brl = (amount: number): Money => Money.create(amount, "BRL");
const pct = (value: number): Percent => Percent.create(value);

describe("daysLate", () => {
  it("counts whole days past the due date", () => {
    assert.equal(
      daysLate(new Date("2026-01-10T00:00:00Z"), new Date("2026-01-15T00:00:00Z")),
      5,
    );
  });

  it("ignores the time of day on both ends", () => {
    assert.equal(
      daysLate(new Date("2026-01-10T23:59:00Z"), new Date("2026-01-15T00:01:00Z")),
      5,
    );
  });

  it("returns zero on the due date and before it", () => {
    const due = new Date("2026-01-10T00:00:00Z");
    assert.equal(daysLate(due, due), 0);
    assert.equal(daysLate(due, new Date("2026-01-05T00:00:00Z")), 0);
  });
});

describe("penaltyFor", () => {
  it("applies the percentage to the original amount", () => {
    assert.equal(penaltyFor(brl(1500), pct(2)).amount, 30);
  });

  it("is zero when the percentage is zero", () => {
    assert.equal(penaltyFor(brl(1500), pct(0)).cents, 0);
  });
});

describe("interestFor", () => {
  it("prorates the monthly rate over a 30 day month", () => {
    // 1500 x 1% / 30 x 5 = 2.50
    assert.equal(interestFor(brl(1500), pct(1), 5).amount, 2.5);
  });

  it("charges a full month at 30 days", () => {
    assert.equal(interestFor(brl(1500), pct(1), 30).amount, 15);
  });

  it("is zero with no delay or a zero rate", () => {
    assert.equal(interestFor(brl(1500), pct(1), 0).cents, 0);
    assert.equal(interestFor(brl(1500), pct(1), -3).cents, 0);
    assert.equal(interestFor(brl(1500), pct(0), 5).cents, 0);
  });

  it("rounds only the final result, so a repeating fraction lands on a cent", () => {
    // 100 x 1% / 30 x 1 = 0.0333... -> 0.03
    assert.equal(interestFor(brl(100), pct(1), 1).amount, 0.03);
    // 10 x 1% / 30 x 7 = 0.02333... -> 0.02
    assert.equal(interestFor(brl(10), pct(1), 7).amount, 0.02);
  });

  it("does not accumulate the rounding error day by day", () => {
    // Rounding each day first would give 30 x 0.03 = 0.90, not 1.00.
    assert.equal(interestFor(brl(100), pct(1), 30).amount, 1);
  });
});

describe("amountsDueFor", () => {
  it("reproduces the documented example", () => {
    const due = amountsDueFor(brl(1500), pct(2), pct(1), 5);

    assert.equal(due.original.amount, 1500);
    assert.equal(due.penalty.amount, 30);
    assert.equal(due.interest.amount, 2.5);
    assert.equal(due.totalDue.amount, 1532.5);
  });

  it("charges nothing extra while the charge is not late", () => {
    const due = amountsDueFor(brl(1500), pct(2), pct(1), 0);

    assert.equal(due.penalty.cents, 0);
    assert.equal(due.interest.cents, 0);
    assert.equal(due.totalDue.amount, 1500);
  });

  it("charges only the penalty when the interest rate is zero", () => {
    const due = amountsDueFor(brl(1500), pct(2), pct(0), 5);

    assert.equal(due.penalty.amount, 30);
    assert.equal(due.interest.cents, 0);
    assert.equal(due.totalDue.amount, 1530);
  });

  it("charges nothing extra when both percentages are zero", () => {
    const due = amountsDueFor(brl(1500), pct(0), pct(0), 40);

    assert.equal(due.totalDue.amount, 1500);
  });
});
