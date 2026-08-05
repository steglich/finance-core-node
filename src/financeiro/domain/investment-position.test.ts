import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvestmentOperation } from "./investment-operation.js";
import type { OperationType } from "./investment-operation.js";
import { derivePosition, valuePosition } from "./investment-position.js";

const TODAY = new Date("2026-07-31T00:00:00Z");

function operation(
  operationType: OperationType,
  values: {
    quantity?: number;
    unitPrice?: number;
    amount?: number;
    fees?: number;
    operatedAt?: string;
  },
): InvestmentOperation {
  const result = InvestmentOperation.create({
    companyId: "company-1",
    investmentId: "investment-1",
    operationType,
    quantity: values.quantity,
    unitPrice: values.unitPrice,
    amount: values.amount,
    fees: values.fees,
    currency: "BRL",
    operatedAt: new Date(values.operatedAt ?? "2026-07-01T00:00:00Z"),
    today: TODAY,
  });

  assert.ok(result.value, result.error?.message ?? "");
  return result.value;
}

describe("derivePosition", () => {
  it("derives 100 PETR4 at R$ 32,50 as R$ 3.250,00 invested", () => {
    const result = derivePosition(
      [operation("BUY", { quantity: 100, unitPrice: 32.5 })],
      "BRL",
    );

    assert.ok(result.value);
    assert.equal(result.value.quantity, 100);
    assert.equal(result.value.investedAmount.amount, 3250);
    assert.equal(result.value.averageCost, 32.5);
  });

  it("averages the cost of two purchases", () => {
    const result = derivePosition(
      [
        operation("BUY", { quantity: 100, unitPrice: 30 }),
        operation("BUY", {
          quantity: 100,
          unitPrice: 40,
          operatedAt: "2026-07-10T00:00:00Z",
        }),
      ],
      "BRL",
    );

    assert.ok(result.value);
    assert.equal(result.value.quantity, 200);
    assert.equal(result.value.investedAmount.amount, 7000);
    assert.equal(result.value.averageCost, 35);
  });

  it("records a realized profit on a partial sale and keeps the average cost", () => {
    const result = derivePosition(
      [
        operation("BUY", { quantity: 100, unitPrice: 30 }),
        operation("BUY", {
          quantity: 100,
          unitPrice: 40,
          operatedAt: "2026-07-10T00:00:00Z",
        }),
        operation("SELL", {
          quantity: 50,
          unitPrice: 40,
          operatedAt: "2026-07-20T00:00:00Z",
        }),
      ],
      "BRL",
    );

    assert.ok(result.value);
    assert.equal(result.value.quantity, 150);
    assert.equal(result.value.averageCost, 35);
    assert.equal(result.value.investedAmount.amount, 5250);
    assert.equal(result.value.realizedResult.amount, 250);
  });

  it("rejects a sale larger than the position", () => {
    const result = derivePosition(
      [
        operation("BUY", { quantity: 200, unitPrice: 35 }),
        operation("SELL", {
          quantity: 300,
          unitPrice: 40,
          operatedAt: "2026-07-20T00:00:00Z",
        }),
      ],
      "BRL",
    );

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /Insufficient quantity/);
  });

  it("leaves no residual cost after selling the whole position", () => {
    const result = derivePosition(
      [
        operation("BUY", { quantity: 3, unitPrice: 33.33 }),
        operation("SELL", {
          quantity: 3,
          unitPrice: 40,
          operatedAt: "2026-07-20T00:00:00Z",
        }),
      ],
      "BRL",
    );

    assert.ok(result.value);
    assert.equal(result.value.quantity, 0);
    assert.equal(result.value.investedAmount.amount, 0);
    assert.equal(result.value.averageCost, 0);
  });

  it("accumulates income without touching the position", () => {
    const result = derivePosition(
      [
        operation("BUY", { quantity: 100, unitPrice: 10 }),
        operation("DIVIDEND", {
          amount: 50,
          operatedAt: "2026-07-20T00:00:00Z",
        }),
        operation("INTEREST", {
          amount: 25,
          operatedAt: "2026-07-21T00:00:00Z",
        }),
      ],
      "BRL",
    );

    assert.ok(result.value);
    assert.equal(result.value.quantity, 100);
    assert.equal(result.value.investedAmount.amount, 1000);
    assert.equal(result.value.incomeReceived.amount, 75);
  });

  it("includes the fees in the invested cost of a purchase", () => {
    const result = derivePosition(
      [operation("BUY", { quantity: 100, unitPrice: 10, fees: 4.9 })],
      "BRL",
    );

    assert.ok(result.value);
    assert.equal(result.value.investedAmount.amount, 1004.9);
  });
});

describe("valuePosition", () => {
  it("reports +15% when R$ 10.000,00 invested is worth R$ 11.500,00", () => {
    const position = derivePosition(
      [operation("BUY", { quantity: 1000, unitPrice: 10 })],
      "BRL",
    );
    assert.ok(position.value);

    const valuation = valuePosition(position.value, 11.5);

    assert.equal(valuation.currentValue.amount, 11500);
    assert.equal(valuation.unrealizedResult.amount, 1500);
    assert.equal(valuation.profitabilityPercent, 15);
    assert.equal(valuation.quoted, true);
  });

  it("reports +10% for a flat position that paid R$ 100,00 of dividends", () => {
    const position = derivePosition(
      [
        operation("BUY", { quantity: 100, unitPrice: 10 }),
        operation("DIVIDEND", {
          amount: 100,
          operatedAt: "2026-07-20T00:00:00Z",
        }),
      ],
      "BRL",
    );
    assert.ok(position.value);

    const valuation = valuePosition(position.value, 10);

    assert.equal(valuation.currentValue.amount, 1000);
    assert.equal(valuation.profitabilityPercent, 10);
  });

  it("falls back to the invested amount and flags the missing quote", () => {
    const position = derivePosition(
      [operation("BUY", { quantity: 100, unitPrice: 32.5 })],
      "BRL",
    );
    assert.ok(position.value);

    const valuation = valuePosition(position.value, undefined);

    assert.equal(valuation.currentValue.amount, 3250);
    assert.equal(valuation.unrealizedResult.amount, 0);
    assert.equal(valuation.quoted, false);
  });

  it("reports zero profitability for a zero invested amount instead of failing", () => {
    const position = derivePosition([], "BRL");
    assert.ok(position.value);

    const valuation = valuePosition(position.value, 38);

    assert.equal(valuation.profitabilityPercent, 0);
    assert.equal(valuation.currentValue.amount, 0);
  });
});
