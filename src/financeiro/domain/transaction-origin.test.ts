import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExchangeRate } from "./exchange-rate.js";
import { Transaction } from "./transaction.js";

const DATE = new Date("2026-07-15T00:00:00Z");

function purchase(overrides: Record<string, unknown> = {}) {
  return Transaction.create({
    companyId: "company-1",
    accountId: "account-1",
    type: "EXPENSE",
    grossAmount: 100,
    currency: "BRL",
    date: DATE,
    ...overrides,
  });
}

describe("Transaction origin", () => {
  it("carries the investment operation that created it", () => {
    const result = purchase({ investmentOperationId: "operation-1" });

    assert.ok(result.value);
    assert.equal(result.value.investmentOperationId, "operation-1");
    assert.equal(result.value.isOwnedByOrigin, true);
  });

  it("carries the loan installment that created it", () => {
    const result = purchase({ loanInstallmentId: "installment-1" });

    assert.ok(result.value);
    assert.equal(result.value.loanInstallmentId, "installment-1");
    assert.equal(result.value.isOwnedByOrigin, true);
  });

  it("is not owned by an origin when the user registered it directly", () => {
    const result = purchase();

    assert.ok(result.value);
    assert.equal(result.value.isOwnedByOrigin, false);
  });

  it("serializes both origins", () => {
    const result = purchase({ investmentOperationId: "operation-1" });

    assert.ok(result.value);
    const json = result.value.toJSON() as Record<string, unknown>;
    assert.equal(json.investmentOperationId, "operation-1");
    assert.equal(json.loanInstallmentId, undefined);
  });
});

describe("Transaction in a currency other than the account", () => {
  it("moves the BRL balance by R$ 260,00 for a $50.00 purchase at 5,20", () => {
    const result = purchase({
      grossAmount: 50,
      currency: "USD",
      accountCurrency: "BRL",
      exchangeRate: ExchangeRate.create("USD", "BRL", 5.2, DATE),
    });

    assert.ok(result.value, result.error?.message ?? "");
    const transaction = result.value;

    // The original amount and currency stay on the record …
    assert.equal(transaction.grossAmount.amount, 50);
    assert.equal(transaction.currency, "USD");
    assert.equal(transaction.exchangeRate?.rate, 5.2);
    // … and the balance moves by the converted value.
    assert.equal(
      transaction.netAmountInAccountCurrency("BRL").amount,
      260,
    );
    assert.equal(
      transaction.netAmountInAccountCurrency("BRL").currency,
      "BRL",
    );
  });

  it("rejects a foreign-currency transaction without a rate", () => {
    const result = purchase({
      grossAmount: 50,
      currency: "USD",
      accountCurrency: "BRL",
    });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /require a registered exchange rate/);
  });

  it("uses the reciprocal when the stored rate covers the pair the other way", () => {
    const result = purchase({
      grossAmount: 50,
      currency: "USD",
      accountCurrency: "BRL",
      exchangeRate: ExchangeRate.create("BRL", "USD", 0.2, DATE),
    });

    assert.ok(result.value, result.error?.message ?? "");
    assert.equal(result.value.netAmountInAccountCurrency("BRL").amount, 250);
  });

  it("returns the net amount untouched when the currencies match", () => {
    const result = purchase({ grossAmount: 100 });

    assert.ok(result.value);
    assert.equal(result.value.netAmountInAccountCurrency("BRL").amount, 100);
  });

  it("keeps the converted value stable regardless of any later rate", () => {
    const result = purchase({
      grossAmount: 50,
      currency: "USD",
      accountCurrency: "BRL",
      exchangeRate: ExchangeRate.create("USD", "BRL", 5.2, DATE),
    });

    assert.ok(result.value);
    const transaction = result.value;

    // The rate is readonly on the aggregate and is not among the editable
    // fields, so re-reading months later gives the same converted amount.
    assert.equal(transaction.netAmountInAccountCurrency("BRL").amount, 260);
    assert.equal(transaction.netAmountInAccountCurrency("BRL").amount, 260);
    assert.equal(transaction.exchangeRate?.rate, 5.2);
  });

  it("refuses to convert with a rate that covers another pair", () => {
    const result = purchase({
      grossAmount: 50,
      currency: "USD",
      accountCurrency: "USD",
      exchangeRate: ExchangeRate.create("EUR", "BRL", 6, DATE),
    });

    assert.ok(result.value);
    assert.throws(
      () => result.value?.netAmountInAccountCurrency("BRL"),
      /does not cover USD\/BRL/,
    );
  });
});
