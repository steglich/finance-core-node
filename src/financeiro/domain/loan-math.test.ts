import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSchedule, totalPrincipal } from "./loan-math.js";
import { Money } from "./money.js";

const brl = (value: number): Money => Money.create(value, "BRL");

describe("buildSchedule", () => {
  it("builds the 24 installments of the R$ 10.000,00 loan at 1,5% a.m.", () => {
    const lines = buildSchedule({
      principal: brl(10000),
      monthlyRatePercent: 1.5,
      installmentCount: 24,
      installmentAmount: brl(520),
      firstDueDate: new Date("2026-09-10T00:00:00Z"),
    });

    assert.equal(lines.length, 24);

    const first = lines[0];
    assert.ok(first);
    assert.equal(first.number, 1);
    assert.equal(first.dueDate.toISOString().slice(0, 10), "2026-09-10");
    // 10.000 × 1,5% = 150,00 of interest; 520 − 150 = 370,00 of principal.
    assert.equal(first.interestAmount.amount, 150);
    assert.equal(first.principalAmount.amount, 370);

    const second = lines[1];
    assert.ok(second);
    // (10.000 − 370) × 1,5% = 144,45
    assert.equal(second.interestAmount.amount, 144.45);
    assert.equal(second.principalAmount.amount, 375.55);

    const last = lines[23];
    assert.ok(last);
    assert.equal(last.dueDate.toISOString().slice(0, 10), "2028-08-10");
  });

  it("makes the principal portions add up to the principal to the cent", () => {
    const lines = buildSchedule({
      principal: brl(10000),
      monthlyRatePercent: 1.5,
      installmentCount: 24,
      installmentAmount: brl(520),
      firstDueDate: new Date("2026-09-10T00:00:00Z"),
    });

    assert.equal(totalPrincipal(lines, "BRL").amount, 10000);
  });

  it("keeps the sum exact for an awkward rate too", () => {
    const lines = buildSchedule({
      principal: brl(7333.33),
      monthlyRatePercent: 2.37,
      installmentCount: 18,
      installmentAmount: brl(520.17),
      firstDueDate: new Date("2026-01-31T00:00:00Z"),
    });

    assert.equal(totalPrincipal(lines, "BRL").amount, 7333.33);
  });

  it("splits an interest-free loan into pure principal", () => {
    const lines = buildSchedule({
      principal: brl(1200),
      monthlyRatePercent: 0,
      installmentCount: 12,
      installmentAmount: brl(100),
      firstDueDate: new Date("2026-03-05T00:00:00Z"),
    });

    assert.equal(lines.length, 12);
    for (const line of lines) {
      assert.equal(line.interestAmount.amount, 0);
      assert.equal(line.principalAmount.amount, 100);
    }
    assert.equal(totalPrincipal(lines, "BRL").amount, 1200);
  });

  it("clamps a due date of the 31st to the last day of a shorter month", () => {
    const lines = buildSchedule({
      principal: brl(1000),
      monthlyRatePercent: 0,
      installmentCount: 4,
      installmentAmount: brl(250),
      firstDueDate: new Date("2026-01-31T00:00:00Z"),
    });

    const dueDates = lines.map((line) =>
      line.dueDate.toISOString().slice(0, 10),
    );

    // 2026 is not a leap year, so February clamps to the 28th.
    assert.deepEqual(dueDates, [
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("produces a single installment carrying the whole principal", () => {
    const lines = buildSchedule({
      principal: brl(500),
      monthlyRatePercent: 3,
      installmentCount: 1,
      installmentAmount: brl(515),
      firstDueDate: new Date("2026-05-10T00:00:00Z"),
    });

    const only = lines[0];
    assert.ok(only);
    assert.equal(only.principalAmount.amount, 500);
    assert.equal(only.interestAmount.amount, 15);
  });
});
