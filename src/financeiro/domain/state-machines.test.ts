import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Installment } from "./installment.js";
import { Money } from "./money.js";
import { Transaction } from "./transaction.js";

function pendingTransaction(): Transaction {
  const result = Transaction.create({
    companyId: "company-1",
    accountId: "account-1",
    type: "EXPENSE",
    grossAmount: 150,
    currency: "BRL",
    date: new Date("2024-08-01"),
  });

  assert.ok(result.value);
  return result.value;
}

function pendingInstallment(): Installment {
  return new Installment({
    id: "installment-1",
    companyId: "company-1",
    parentTransactionId: "transaction-1",
    accountId: "account-1",
    number: 1,
    amount: Money.create(100, "BRL"),
    dueDate: new Date("2024-08-15"),
  });
}

describe("Transaction state machine", () => {
  it("starts pending and confirms, publishing TransactionPosted", () => {
    const transaction = pendingTransaction();
    assert.equal(transaction.status, "PENDING");

    assert.ok(transaction.confirm().isSuccess);
    assert.equal(transaction.status, "CONFIRMED");
    assert.ok(
      transaction.events.some(
        (event) => event.getEventType() === "TransactionPosted",
      ),
    );
  });

  it("cancels a pending transaction", () => {
    const transaction = pendingTransaction();

    assert.ok(transaction.cancel("engano").isSuccess);
    assert.equal(transaction.status, "CANCELLED");
    assert.ok(
      transaction.events.some(
        (event) => event.getEventType() === "TransactionCancelled",
      ),
    );
  });

  it("refunds a confirmed transaction", () => {
    const transaction = pendingTransaction();
    transaction.confirm();

    assert.ok(transaction.refund().isSuccess);
    assert.equal(transaction.status, "REFUNDED");
    assert.ok(
      transaction.events.some(
        (event) => event.getEventType() === "TransactionRefunded",
      ),
    );
  });

  it("rejects cancelling a confirmed transaction and suggests refunding", () => {
    const transaction = pendingTransaction();
    transaction.confirm();

    const result = transaction.cancel();
    assert.ok(result.isFailure);
    assert.match(result.error?.message ?? "", /refund/i);
    assert.equal(transaction.status, "CONFIRMED");
  });

  it("rejects any transition out of a cancelled transaction", () => {
    const transaction = pendingTransaction();
    transaction.cancel();

    assert.ok(transaction.confirm().isFailure);
    assert.ok(transaction.refund().isFailure);
    assert.ok(transaction.edit({ grossAmount: 10 }).isFailure);
    assert.equal(transaction.status, "CANCELLED");
  });

  it("refuses a second refund", () => {
    const transaction = pendingTransaction();
    transaction.confirm();
    transaction.refund();

    assert.ok(transaction.refund().isFailure);
  });
});

describe("Transaction editing", () => {
  it("records the field-level diff of an edit", () => {
    const transaction = pendingTransaction();

    const result = transaction.edit({ grossAmount: 120, description: "novo" });
    assert.ok(result.isSuccess);

    const changes = result.value ?? [];
    assert.deepEqual(
      changes.find((change) => change.field === "grossAmount"),
      { field: "grossAmount", oldValue: 150, newValue: 120 },
    );
    assert.equal(transaction.grossAmount.amount, 120);
  });

  it("leaves no partial state when an edit is rejected", () => {
    const transaction = pendingTransaction();

    const result = transaction.edit({ grossAmount: 100, discount: 200 });
    assert.ok(result.isFailure);
    assert.equal(transaction.grossAmount.amount, 150);
    assert.equal(transaction.discount.amount, 0);
  });

  it("rejects editing a confirmed transaction", () => {
    const transaction = pendingTransaction();
    transaction.confirm();

    assert.ok(transaction.edit({ grossAmount: 200 }).isFailure);
  });
});

describe("Installment state machine", () => {
  it("pays a pending installment", () => {
    const installment = pendingInstallment();

    assert.ok(
      installment.pay(new Date("2024-08-10"), "account-2", "payment-1")
        .isSuccess,
    );
    assert.equal(installment.status, "PAID");
    assert.equal(installment.paymentAccountId, "account-2");
    assert.ok(
      installment.events.some(
        (event) => event.getEventType() === "InstallmentPaid",
      ),
    );
  });

  it("marks an installment overdue only after the due date", () => {
    const installment = pendingInstallment();

    assert.ok(installment.markOverdue(new Date("2024-08-14")).isFailure);
    assert.ok(installment.markOverdue(new Date("2024-08-16")).isSuccess);
    assert.equal(installment.status, "OVERDUE");
  });

  it("pays an overdue installment", () => {
    const installment = pendingInstallment();
    installment.markOverdue(new Date("2024-08-16"));

    assert.ok(installment.pay(new Date("2024-08-20"), "account-1").isSuccess);
    assert.equal(installment.status, "PAID");
  });

  it("rejects any change to a paid installment", () => {
    const installment = pendingInstallment();
    installment.pay(new Date("2024-08-10"), "account-1");

    assert.ok(installment.pay(new Date("2024-08-11"), "account-1").isFailure);
    assert.ok(installment.markOverdue(new Date("2024-09-01")).isFailure);
    assert.ok(installment.changeDueDate(new Date("2024-08-20")).isFailure);
  });

  it("changes the due date of a pending installment", () => {
    const installment = pendingInstallment();

    assert.ok(installment.changeDueDate(new Date("2024-08-20")).isSuccess);
    assert.equal(installment.dueDate.toISOString().slice(0, 10), "2024-08-20");
    assert.ok(
      installment.events.some(
        (event) => event.getEventType() === "InstallmentDueDateChanged",
      ),
    );
  });
});
