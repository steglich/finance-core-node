import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Account } from "./account.js";
import { Investment } from "./investment.js";
import type { InvestmentAccount, InvestmentCategory } from "./investment.js";
import { InvestmentOperation } from "./investment-operation.js";
import type { OperationType } from "./investment-operation.js";
import { InvestmentOperationService } from "./investment-operation-service.js";

const TODAY = new Date("2026-07-31T00:00:00Z");
const OPERATED_AT = new Date("2026-07-15T00:00:00Z");

const expenseCategory: InvestmentCategory = {
  id: "category-expense",
  companyId: "company-1",
  type: "EXPENSE",
};

const incomeCategory: InvestmentCategory = {
  id: "category-income",
  companyId: "company-1",
  type: "INCOME",
};

function account(
  balance: number,
  overrides: { currency?: string; isActive?: boolean } = {},
): Account {
  const result = Account.create({
    id: "account-1",
    companyId: "company-1",
    walletId: "wallet-1",
    name: "Corretora XP",
    number: "1234",
    type: "INVESTMENT",
    currency: overrides.currency ?? "BRL",
    initialBalance: balance,
  });

  assert.ok(result.value);
  result.value.clearEvents();

  if (overrides.isActive === false) {
    result.value.deactivate(0);
    result.value.clearEvents();
  }

  return result.value;
}

function investment(currency = "BRL"): Investment {
  const linkedAccount: InvestmentAccount = {
    id: "account-1",
    companyId: "company-1",
    currency,
    isActive: true,
  };

  const result = Investment.create({
    companyId: "company-1",
    account: linkedAccount,
    name: "Petrobras PN",
    investmentType: "STOCK",
    symbol: "PETR4",
    currency,
    expenseCategory,
    incomeCategory,
  });

  assert.ok(result.value);
  result.value.clearEvents();
  return result.value;
}

function existingOperation(
  operationType: OperationType,
  values: { quantity?: number; unitPrice?: number; amount?: number },
): InvestmentOperation {
  const result = InvestmentOperation.create({
    companyId: "company-1",
    investmentId: "investment-1",
    operationType,
    quantity: values.quantity,
    unitPrice: values.unitPrice,
    amount: values.amount,
    currency: "BRL",
    operatedAt: new Date("2026-07-01T00:00:00Z"),
    today: TODAY,
  });

  assert.ok(result.value);
  return result.value;
}

const service = new InvestmentOperationService();

describe("InvestmentOperationService.register", () => {
  it("builds a confirmed expense transaction for a purchase", () => {
    const result = service.register({
      investment: investment(),
      operations: [],
      account: account(10000),
      input: {
        operationType: "BUY",
        quantity: 100,
        unitPrice: 32.5,
        operatedAt: OPERATED_AT,
        today: TODAY,
      },
    });

    assert.ok(result.value, result.error?.message ?? "");
    const { operation, payment, position } = result.value;

    assert.equal(operation.amount.amount, 3250);
    assert.equal(payment.type, "EXPENSE");
    assert.equal(payment.status, "CONFIRMED");
    assert.equal(payment.grossAmount.amount, 3250);
    assert.equal(payment.categoryId, "category-expense");
    assert.equal(payment.investmentOperationId, operation.id);
    assert.equal(operation.transactionId, payment.id);
    assert.equal(position.quantity, 100);
    assert.equal(position.investedAmount.amount, 3250);
  });

  it("builds a confirmed income transaction for a sale", () => {
    const result = service.register({
      investment: investment(),
      operations: [existingOperation("BUY", { quantity: 200, unitPrice: 35 })],
      account: account(1000),
      input: {
        operationType: "SELL",
        quantity: 50,
        unitPrice: 40,
        operatedAt: OPERATED_AT,
        today: TODAY,
      },
    });

    assert.ok(result.value, result.error?.message ?? "");
    const { payment, position } = result.value;

    assert.equal(payment.type, "INCOME");
    assert.equal(payment.grossAmount.amount, 2000);
    assert.equal(payment.categoryId, "category-income");
    assert.equal(position.quantity, 150);
    assert.equal(position.realizedResult.amount, 250);
  });

  it("credits the account for dividends", () => {
    const result = service.register({
      investment: investment(),
      operations: [existingOperation("BUY", { quantity: 100, unitPrice: 32.5 })],
      account: account(0),
      input: {
        operationType: "DIVIDEND",
        amount: 50,
        operatedAt: OPERATED_AT,
        today: TODAY,
      },
    });

    assert.ok(result.value, result.error?.message ?? "");
    assert.equal(result.value.payment.type, "INCOME");
    assert.equal(result.value.payment.grossAmount.amount, 50);
    assert.equal(result.value.position.incomeReceived.amount, 50);
    // Income does not move the position.
    assert.equal(result.value.position.quantity, 100);
  });

  it("rejects a sale larger than the position and builds nothing", () => {
    const result = service.register({
      investment: investment(),
      operations: [existingOperation("BUY", { quantity: 200, unitPrice: 35 })],
      account: account(1000),
      input: {
        operationType: "SELL",
        quantity: 300,
        unitPrice: 40,
        operatedAt: OPERATED_AT,
        today: TODAY,
      },
    });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /Insufficient quantity/);
  });

  it("rejects a purchase larger than the available balance", () => {
    const result = service.register({
      investment: investment(),
      operations: [],
      account: account(1000),
      input: {
        operationType: "BUY",
        quantity: 100,
        unitPrice: 32.5,
        operatedAt: OPERATED_AT,
        today: TODAY,
      },
    });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /Saldo insuficiente/);
  });

  it("rejects an inactive account", () => {
    const result = service.register({
      investment: investment(),
      operations: [],
      account: account(10000, { isActive: false }),
      input: {
        operationType: "BUY",
        quantity: 10,
        unitPrice: 10,
        operatedAt: OPERATED_AT,
        today: TODAY,
      },
    });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /Inactive accounts/);
  });

  it("rejects an account whose currency differs from the investment's", () => {
    const result = service.register({
      investment: investment("USD"),
      operations: [],
      account: account(10000),
      input: {
        operationType: "BUY",
        quantity: 10,
        unitPrice: 10,
        operatedAt: OPERATED_AT,
        today: TODAY,
      },
    });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /does not match investment currency/);
  });

  it("rejects an operation on a closed investment", () => {
    const closed = investment();
    closed.close(0);
    closed.clearEvents();

    const result = service.register({
      investment: closed,
      operations: [],
      account: account(10000),
      input: {
        operationType: "BUY",
        quantity: 10,
        unitPrice: 10,
        operatedAt: OPERATED_AT,
        today: TODAY,
      },
    });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /closed/);
  });

  it("publishes InvestmentOperationRegistered alongside the transaction events", () => {
    const result = service.register({
      investment: investment(),
      operations: [],
      account: account(10000),
      input: {
        operationType: "BUY",
        quantity: 100,
        unitPrice: 32.5,
        operatedAt: OPERATED_AT,
        today: TODAY,
      },
    });

    assert.ok(result.value);
    const types = result.value.events.map((event) => event.getEventType());
    assert.ok(types.includes("InvestmentOperationRegistered"));
    assert.ok(types.includes("TransactionRegistered"));
  });

  it("honours a per-operation category override", () => {
    const result = service.register({
      investment: investment(),
      operations: [],
      account: account(10000),
      input: {
        operationType: "BUY",
        quantity: 10,
        unitPrice: 10,
        operatedAt: OPERATED_AT,
        categoryId: "category-other",
        today: TODAY,
      },
    });

    assert.ok(result.value);
    assert.equal(result.value.payment.categoryId, "category-other");
  });
});
