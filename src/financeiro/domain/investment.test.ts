import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Investment } from "./investment.js";
import type { InvestmentAccount, InvestmentCategory } from "./investment.js";
import { InvestmentOperation } from "./investment-operation.js";

const TODAY = new Date("2026-07-31T00:00:00Z");

function account(
  overrides: Partial<InvestmentAccount> = {},
): InvestmentAccount {
  return {
    id: "account-1",
    companyId: "company-1",
    currency: "BRL",
    isActive: true,
    ...overrides,
  };
}

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

function create(
  overrides: {
    account?: InvestmentAccount;
    investmentType?: string;
    currency?: string;
    expenseCategory?: InvestmentCategory;
    incomeCategory?: InvestmentCategory;
  } = {},
) {
  return Investment.create({
    companyId: "company-1",
    account: overrides.account ?? account(),
    name: "Petrobras PN",
    investmentType: overrides.investmentType ?? "STOCK",
    symbol: "PETR4",
    currency: overrides.currency ?? "BRL",
    expenseCategory: overrides.expenseCategory ?? expenseCategory,
    incomeCategory: overrides.incomeCategory ?? incomeCategory,
  });
}

describe("Investment.create", () => {
  it("registers an active investment with an empty position", () => {
    const result = create();

    assert.ok(result.value);
    assert.equal(result.value.status, "ACTIVE");
    assert.equal(result.value.investmentType, "STOCK");
    assert.equal(result.value.symbol, "PETR4");
    assert.equal(result.value.currency, "BRL");
    assert.deepEqual(
      result.value.events.map((event) => event.getEventType()),
      ["InvestmentCreated"],
    );
  });

  it("rejects an unsupported type", () => {
    const result = create({ investmentType: "IMOVEL" });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /Invalid investment type/);
  });

  it("rejects an account of another company", () => {
    const result = create({ account: account({ companyId: "company-2" }) });

    assert.equal(result.isFailure, true);
    assert.equal(result.error?.code, "UNAUTHORIZED_ACCESS");
  });

  it("rejects an inactive account", () => {
    const result = create({ account: account({ isActive: false }) });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /inactive account/);
  });

  it("rejects a currency that differs from the account's", () => {
    const result = create({ currency: "USD" });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /does not match account currency/);
  });

  it("rejects an income category where an expense category is required", () => {
    const result = create({ expenseCategory: incomeCategory });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /EXPENSE category is required/);
  });

  it("rejects a category of another company", () => {
    const result = create({
      incomeCategory: { ...incomeCategory, companyId: "company-2" },
    });

    assert.equal(result.isFailure, true);
    assert.equal(result.error?.code, "UNAUTHORIZED_ACCESS");
  });
});

describe("Investment.edit", () => {
  it("changes the name, the symbol and the categories", () => {
    const investment = create().value;
    assert.ok(investment);

    const result = investment.edit({
      name: "Petrobras PN (novo)",
      symbol: "PETR4F",
      expenseCategory: { ...expenseCategory, id: "category-expense-2" },
    });

    assert.equal(result.isSuccess, true);
    assert.equal(investment.name, "Petrobras PN (novo)");
    assert.equal(investment.symbol, "PETR4F");
    assert.equal(investment.expenseCategoryId, "category-expense-2");
  });

  it("rejects an editing of a closed investment", () => {
    const investment = create().value;
    assert.ok(investment);
    investment.close(0);

    const result = investment.edit({ name: "Outro nome" });

    assert.equal(result.isFailure, true);
  });
});

describe("Investment.close", () => {
  it("closes a zeroed position and publishes InvestmentClosed", () => {
    const investment = create().value;
    assert.ok(investment);
    investment.clearEvents();

    const result = investment.close(0);

    assert.equal(result.isSuccess, true);
    assert.equal(investment.status, "CLOSED");
    assert.deepEqual(
      investment.events.map((event) => event.getEventType()),
      ["InvestmentClosed"],
    );
  });

  it("rejects closing while a position is open", () => {
    const investment = create().value;
    assert.ok(investment);

    const result = investment.close(50);

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /still holds a position of 50/);
    assert.equal(investment.status, "ACTIVE");
  });

  it("refuses operations once closed", () => {
    const investment = create().value;
    assert.ok(investment);
    investment.close(0);

    const error = investment.ensureAcceptsOperations();

    assert.ok(error);
    assert.match(error.message, /closed/);
  });
});

describe("InvestmentOperation.create", () => {
  const base = {
    companyId: "company-1",
    investmentId: "investment-1",
    currency: "BRL",
    operatedAt: new Date("2026-07-15T00:00:00Z"),
    today: TODAY,
  };

  it("derives the amount of a purchase from quantity and unit price", () => {
    const result = InvestmentOperation.create({
      ...base,
      operationType: "BUY",
      quantity: 100,
      unitPrice: 32.5,
    });

    assert.ok(result.value);
    assert.equal(result.value.amount.amount, 3250);
    assert.equal(result.value.direction, "DEBIT");
  });

  it("rejects a future-dated operation", () => {
    const result = InvestmentOperation.create({
      ...base,
      operationType: "BUY",
      quantity: 100,
      unitPrice: 32.5,
      operatedAt: new Date("2026-08-05T00:00:00Z"),
    });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /future/);
  });

  it("rejects a purchase without a quantity", () => {
    const result = InvestmentOperation.create({
      ...base,
      operationType: "BUY",
      unitPrice: 32.5,
    });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /quantity greater than zero/);
  });

  it("rejects a sale without a unit price", () => {
    const result = InvestmentOperation.create({
      ...base,
      operationType: "SELL",
      quantity: 10,
    });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /unit price greater than zero/);
  });

  it("rejects a non-positive amount on an income operation", () => {
    const result = InvestmentOperation.create({
      ...base,
      operationType: "DIVIDEND",
      amount: 0,
    });

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /greater than zero/);
  });

  it("credits the account for dividends", () => {
    const result = InvestmentOperation.create({
      ...base,
      operationType: "DIVIDEND",
      amount: 50,
    });

    assert.ok(result.value);
    assert.equal(result.value.direction, "CREDIT");
    assert.equal(result.value.amount.amount, 50);
  });
});
