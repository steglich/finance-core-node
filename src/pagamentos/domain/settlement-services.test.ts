import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Account } from "../../financeiro/domain/account.js";
import { Money } from "../../financeiro/domain/money.js";
import { ChargeReceiptService } from "./charge-receipt-service.js";
import { Charge } from "./charge.js";
import { PayableSettlementService } from "./payable-settlement-service.js";
import { Payable } from "./payable.js";

const COMPANY = "company-1";
const OTHER_COMPANY = "company-2";

const ISSUE_DATE = new Date("2026-08-01T00:00:00Z");
const DUE_DATE = new Date("2026-08-15T00:00:00Z");
const FIVE_DAYS_LATE = new Date("2026-08-20T00:00:00Z");

/**
 * An active account of `COMPANY` with the given balance.
 */
function account(
  balance: number,
  overrides: { companyId?: string; currency?: string } = {},
): Account {
  const result = Account.create({
    companyId: overrides.companyId ?? COMPANY,
    walletId: "wallet-1",
    name: "Conta Corrente",
    number: "1234",
    type: "CHECKING",
    currency: overrides.currency ?? "BRL",
    initialBalance: balance,
  });

  assert.ok(result.value);
  result.value.clearEvents();
  return result.value;
}

function inactiveAccount(balance: number): Account {
  const target = account(balance);
  assert.equal(target.deactivate(0).isSuccess, true);
  target.clearEvents();
  return target;
}

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
    issueDate: ISSUE_DATE,
    dueDate: DUE_DATE,
    penaltyPercent: 2,
    monthlyInterestPercent: 1,
  });

  assert.ok(result.value);
  result.value.clearEvents();
  return result.value;
}

function payable(amount = 1000): Payable {
  const result = Payable.register({
    companyId: COMPANY,
    supplier: {
      id: "person-2",
      companyId: COMPANY,
      isActive: true,
      hasRole: (role) => role === "SUPPLIER",
    },
    category: { id: "category-1", companyId: COMPANY, type: "EXPENSE" },
    costCenterId: "cc-1",
    amount,
    currency: "BRL",
    dueDate: DUE_DATE,
  });

  assert.ok(result.value);
  result.value.clearEvents();
  return result.value;
}

describe("ChargeReceiptService", () => {
  const service = new ChargeReceiptService();

  it("settles a charge received on time", () => {
    const target = charge();
    const destination = account(0);

    const result = service.receive({
      charge: target,
      account: destination,
      amount: 1500,
      receivedAt: DUE_DATE,
    });

    assert.equal(result.isSuccess, true, result.error?.message ?? "");
    const outcome = result.value!;

    assert.equal(outcome.payment.type, "INCOME");
    assert.equal(outcome.payment.status, "CONFIRMED");
    assert.equal(outcome.payment.personId, "person-1");
    assert.equal(outcome.amount.amount, 1500);
    assert.equal(outcome.penalty.cents, 0);
    assert.equal(outcome.interest.cents, 0);
    assert.equal(target.status, "PAID");
  });

  it("settles an overdue charge for the total due, keeping the breakdown", () => {
    const target = charge();
    assert.equal(target.markOverdue(FIVE_DAYS_LATE).isSuccess, true);
    target.clearEvents();

    const result = service.receive({
      charge: target,
      account: account(0),
      amount: 1532.5,
      receivedAt: FIVE_DAYS_LATE,
    });

    assert.equal(result.isSuccess, true);
    assert.equal(result.value?.penalty.amount, 30);
    assert.equal(result.value?.interest.amount, 2.5);
    assert.equal(result.value?.payment.netAmount.amount, 1532.5);
  });

  it("carries the transaction and charge events for the caller to publish", () => {
    const result = service.receive({
      charge: charge(),
      account: account(0),
      amount: 1500,
      receivedAt: DUE_DATE,
    });

    const types = result.value!.events.map((event) => event.getEventType());
    assert.equal(types.includes("ChargePaid"), true);
  });

  it("rejects an amount different from the total due, leaving the charge open", () => {
    const target = charge();

    const below = service.receive({
      charge: target,
      account: account(0),
      amount: 1000,
      receivedAt: DUE_DATE,
    });
    assert.equal(below.error?.code, "BUSINESS_RULE_VIOLATION");

    const above = service.receive({
      charge: target,
      account: account(0),
      amount: 2000,
      receivedAt: DUE_DATE,
    });
    assert.equal(above.error?.code, "BUSINESS_RULE_VIOLATION");

    assert.equal(target.status, "ISSUED");
  });

  it("rejects the original amount once the charge accrued penalty and interest", () => {
    const target = charge();
    target.markOverdue(FIVE_DAYS_LATE);
    target.clearEvents();

    const result = service.receive({
      charge: target,
      account: account(0),
      amount: 1500,
      receivedAt: FIVE_DAYS_LATE,
    });

    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
    assert.equal(target.status, "OVERDUE");
  });

  it("rejects an inactive destination account", () => {
    const target = charge();

    const result = service.receive({
      charge: target,
      account: inactiveAccount(0),
      amount: 1500,
      receivedAt: DUE_DATE,
    });

    assert.equal(result.error?.code, "INVALID_OPERATION");
    assert.equal(target.status, "ISSUED");
  });

  it("rejects an account of another company", () => {
    const result = service.receive({
      charge: charge(),
      account: account(0, { companyId: OTHER_COMPANY }),
      amount: 1500,
      receivedAt: DUE_DATE,
    });

    assert.equal(result.error?.code, "UNAUTHORIZED_ACCESS");
  });

  it("rejects an account in a different currency", () => {
    const result = service.receive({
      charge: charge(),
      account: account(0, { currency: "USD" }),
      amount: 1500,
      receivedAt: DUE_DATE,
    });

    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
  });

  it("rejects a receipt for a charge that is no longer open", () => {
    const target = charge();
    assert.equal(target.cancel("acordo").isSuccess, true);

    const result = service.receive({
      charge: target,
      account: account(0),
      amount: 1500,
      receivedAt: DUE_DATE,
    });

    assert.equal(result.error?.code, "INVALID_OPERATION");
  });

  it("does not need a balance in the destination account", () => {
    // Money is coming in, not going out.
    const result = service.receive({
      charge: charge(),
      account: account(0),
      amount: 1500,
      receivedAt: DUE_DATE,
    });

    assert.equal(result.isSuccess, true);
  });
});

describe("PayableSettlementService", () => {
  const service = new PayableSettlementService();

  it("settles a payable and inherits its classification", () => {
    const target = payable();
    const source = account(5000);

    const result = service.settle({
      payable: target,
      account: source,
      amount: 1000,
      paidAt: DUE_DATE,
    });

    assert.equal(result.isSuccess, true, result.error?.message ?? "");
    const outcome = result.value!;

    assert.equal(outcome.payment.type, "EXPENSE");
    assert.equal(outcome.payment.status, "CONFIRMED");
    assert.equal(outcome.payment.categoryId, "category-1");
    assert.equal(outcome.payment.costCenterId, "cc-1");
    assert.equal(outcome.payment.personId, "person-2");
    assert.equal(target.status, "PAID");
  });

  it("carries the transaction and payable events for the caller to publish", () => {
    const result = service.settle({
      payable: payable(),
      account: account(5000),
      amount: 1000,
      paidAt: DUE_DATE,
    });

    const types = result.value!.events.map((event) => event.getEventType());
    assert.equal(types.includes("PayablePaid"), true);
  });

  it("rejects an amount different from the amount owed", () => {
    const target = payable();

    assert.equal(
      service.settle({
        payable: target,
        account: account(5000),
        amount: 400,
        paidAt: DUE_DATE,
      }).error?.code,
      "BUSINESS_RULE_VIOLATION",
    );
    assert.equal(target.status, "PENDING");
  });

  it("rejects a settlement with insufficient balance, leaving the payable open", () => {
    const target = payable();

    const result = service.settle({
      payable: target,
      account: account(100),
      amount: 1000,
      paidAt: DUE_DATE,
    });

    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
    assert.equal(target.status, "PENDING");
  });

  it("rejects an inactive source account", () => {
    const target = payable();

    const result = service.settle({
      payable: target,
      account: inactiveAccount(5000),
      amount: 1000,
      paidAt: DUE_DATE,
    });

    assert.equal(result.error?.code, "INVALID_OPERATION");
    assert.equal(target.status, "PENDING");
  });

  it("rejects an account of another company", () => {
    const result = service.settle({
      payable: payable(),
      account: account(5000, { companyId: OTHER_COMPANY }),
      amount: 1000,
      paidAt: DUE_DATE,
    });

    assert.equal(result.error?.code, "UNAUTHORIZED_ACCESS");
  });

  it("rejects an account in a different currency", () => {
    const result = service.settle({
      payable: payable(),
      account: account(5000, { currency: "USD" }),
      amount: 1000,
      paidAt: DUE_DATE,
    });

    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
  });

  it("rejects a settlement for a payable that is no longer open", () => {
    const target = payable();
    assert.equal(target.cancel("nota cancelada").isSuccess, true);

    const result = service.settle({
      payable: target,
      account: account(5000),
      amount: 1000,
      paidAt: DUE_DATE,
    });

    assert.equal(result.error?.code, "INVALID_OPERATION");
  });
});
