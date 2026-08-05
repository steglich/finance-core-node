import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Account, type AccountEntry } from "./account.js";
import { Category, ensureOnlyClassificationChanged } from "./category.js";
import { ExchangeRate } from "./exchange-rate.js";
import { Installment } from "./installment.js";
import { Money } from "./money.js";
import { Transaction } from "./transaction.js";
import { TransferService } from "./transfer-service.js";

function account(initialBalance = 0, currency = "BRL"): Account {
  const result = Account.create({
    companyId: "company-1",
    walletId: "wallet-1",
    name: "Conta",
    number: "1",
    type: "CHECKING",
    currency,
    initialBalance,
  });

  assert.ok(result.value);
  result.value.clearEvents();
  return result.value;
}

describe("RN-01 — traceability, no physical deletion", () => {
  it("keeps a cancelled transaction as a record instead of removing it", () => {
    const result = Transaction.create({
      companyId: "company-1",
      accountId: "account-1",
      type: "EXPENSE",
      grossAmount: 100,
      currency: "BRL",
      date: new Date("2024-08-01"),
    });

    assert.ok(result.value);
    result.value.cancel();

    assert.equal(result.value.status, "CANCELLED");
    assert.equal(result.value.grossAmount.amount, 100);
  });

  it("soft-deletes a category, keeping it addressable", () => {
    const category = Category.create({
      companyId: "company-1",
      name: "Alimentação",
      type: "EXPENSE",
    });

    assert.ok(category.value);
    const deleted = category.value.delete({
      transactionCount: 0,
      subcategoryCount: 0,
    });

    assert.ok(deleted.isSuccess);
    assert.ok(deleted.value?.isDeleted);
    assert.equal(deleted.value?.id, category.value.id);
  });
});

describe("RN-02 — balance derived from confirmed transactions", () => {
  it("only changes the balance through credit/debit", () => {
    const target = account(100);

    target.credit({
      transactionId: "transaction-1",
      accountId: target.id,
      direction: "CREDIT",
      amount: Money.create(50, "BRL"),
    });

    assert.equal(target.balance.amount, 150);
  });

  it("corrects a diverging cache on reconciliation and reports it", () => {
    const target = account(100);

    const entries: AccountEntry[] = [
      {
        transactionId: "transaction-1",
        accountId: target.id,
        direction: "CREDIT",
        amount: Money.create(30, "BRL"),
      },
    ];

    const result = target.reconcile(entries);

    assert.ok(result.isSuccess);
    assert.equal(result.value?.matched, false);
    assert.equal(target.balance.amount, 30);
    assert.ok(
      target.events.some(
        (event) => event.getEventType() === "AccountBalanceMismatchDetected",
      ),
    );
  });
});

describe("RN-03 — every transaction is bound to an account", () => {
  it("rejects a transaction without an account", () => {
    const result = Transaction.create({
      companyId: "company-1",
      accountId: "   ",
      type: "EXPENSE",
      grossAmount: 100,
      currency: "BRL",
      date: new Date("2024-08-01"),
    });

    assert.ok(result.isFailure);
    assert.match(result.error?.message ?? "", /RN-03/);
  });

  it("rejects a balance movement without its originating transaction", () => {
    const target = account(100);

    const result = target.credit({
      transactionId: "",
      accountId: target.id,
      direction: "CREDIT",
      amount: Money.create(10, "BRL"),
    });

    assert.ok(result.isFailure);
    assert.match(result.error?.message ?? "", /RN-03/);
    assert.equal(target.balance.amount, 100);
  });

  it("rejects a movement belonging to another account", () => {
    const target = account(100);

    const result = target.debit({
      transactionId: "transaction-1",
      accountId: "another-account",
      direction: "DEBIT",
      amount: Money.create(10, "BRL"),
    });

    assert.ok(result.isFailure);
    assert.equal(target.balance.amount, 100);
  });
});

describe("RN-04 — transfer atomicity", () => {
  it("links both legs by the same transferId", () => {
    const result = new TransferService().transfer({
      source: account(1000),
      target: account(0),
      amount: 100,
      date: new Date("2024-08-01"),
    });

    assert.ok(result.value);
    assert.equal(result.value.debit.transferId, result.value.transferId);
    assert.equal(result.value.credit.transferId, result.value.transferId);
  });

  it("leaves both balances untouched when the transfer is rejected", () => {
    const source = account(100);
    const target = account(50);

    const result = new TransferService().transfer({
      source,
      target,
      amount: 500,
      date: new Date("2024-08-01"),
    });

    assert.ok(result.isFailure);
    assert.equal(source.balance.amount, 100);
    assert.equal(target.balance.amount, 50);
  });

  it("refuses to reverse legs that belong to another transfer", () => {
    const service = new TransferService();
    const source = account(1000);
    const target = account(0);

    const transfer = service.transfer({
      source,
      target,
      amount: 100,
      date: new Date("2024-08-01"),
    });
    assert.ok(transfer.value);

    const result = service.reverse({
      transferId: "another-transfer",
      source,
      target,
      debit: transfer.value.debit,
      credit: transfer.value.credit,
    });

    assert.ok(result.isFailure);
    assert.match(result.error?.message ?? "", /RN-04/);
  });
});

describe("RN-05 — installments have their own life and a common origin", () => {
  it("accepts a set that adds up to the parent amount", () => {
    const installments = Installment.generate({
      companyId: "company-1",
      parentTransactionId: "transaction-1",
      accountId: "account-1",
      total: Money.create(300, "BRL"),
      count: 3,
      purchaseDate: new Date("2024-01-15"),
    });

    assert.ok(installments.value);
    assert.ok(
      Installment.ensureSharedOrigin(
        installments.value,
        "transaction-1",
        Money.create(300, "BRL"),
      ).isSuccess,
    );
  });

  it("rejects a set whose amounts do not add up", () => {
    const installments = Installment.generate({
      companyId: "company-1",
      parentTransactionId: "transaction-1",
      accountId: "account-1",
      total: Money.create(300, "BRL"),
      count: 3,
      purchaseDate: new Date("2024-01-15"),
    });

    assert.ok(installments.value);
    const result = Installment.ensureSharedOrigin(
      installments.value,
      "transaction-1",
      Money.create(400, "BRL"),
    );

    assert.ok(result.isFailure);
    assert.match(result.error?.message ?? "", /RN-05/);
  });

  it("rejects an installment pointing at a different parent", () => {
    const installments = Installment.generate({
      companyId: "company-1",
      parentTransactionId: "transaction-1",
      accountId: "account-1",
      total: Money.create(200, "BRL"),
      count: 2,
      purchaseDate: new Date("2024-01-15"),
    });

    assert.ok(installments.value);
    const result = Installment.ensureSharedOrigin(
      installments.value,
      "other-transaction",
      Money.create(200, "BRL"),
    );

    assert.ok(result.isFailure);
  });

  it("keeps the other installments untouched when one is paid", () => {
    const installments = Installment.generate({
      companyId: "company-1",
      parentTransactionId: "transaction-1",
      accountId: "account-1",
      total: Money.create(1200, "BRL"),
      count: 12,
      purchaseDate: new Date("2024-01-15"),
    });

    assert.ok(installments.value);
    installments.value[2]!.pay(new Date("2024-04-10"), "account-1");

    assert.equal(installments.value[2]!.status, "PAID");
    assert.ok(
      installments.value
        .filter((_, index) => index !== 2)
        .every((item) => item.status === "PENDING"),
    );
  });
});

describe("RN-06 — categories do not change financial behaviour", () => {
  it("accepts a reclassification that only changes the category", () => {
    const before = { id: "transaction-1", categoryId: "category-1" };
    const after = { id: "transaction-1", categoryId: "category-2" };

    assert.ok(ensureOnlyClassificationChanged(before, after).isSuccess);
  });

  it("rejects a reclassification that touches anything else", () => {
    const before = { id: "transaction-1", categoryId: "category-1", amount: 100 };
    const after = { id: "transaction-1", categoryId: "category-2", amount: 120 };

    const result = ensureOnlyClassificationChanged(before, after);
    assert.ok(result.isFailure);
    assert.match(result.error?.message ?? "", /RN-06/);
  });
});

describe("RN-07 — multi-currency requires a registered rate", () => {
  it("rejects a transaction in a currency other than the account's without a rate", () => {
    const result = Transaction.create({
      companyId: "company-1",
      accountId: "account-1",
      type: "EXPENSE",
      grossAmount: 100,
      currency: "USD",
      accountCurrency: "BRL",
      date: new Date("2024-08-01"),
    });

    assert.ok(result.isFailure);
    assert.match(result.error?.message ?? "", /RN-07/);
  });

  it("accepts it when a rate covering both currencies is supplied", () => {
    const result = Transaction.create({
      companyId: "company-1",
      accountId: "account-1",
      type: "EXPENSE",
      grossAmount: 100,
      currency: "USD",
      accountCurrency: "BRL",
      exchangeRate: ExchangeRate.create(
        "USD",
        "BRL",
        5.2,
        new Date("2024-08-01"),
      ),
      date: new Date("2024-08-01"),
    });

    assert.ok(result.isSuccess, result.error?.message ?? "");
  });

  it("rejects a rate that does not cover the pair", () => {
    const result = Transaction.create({
      companyId: "company-1",
      accountId: "account-1",
      type: "EXPENSE",
      grossAmount: 100,
      currency: "USD",
      accountCurrency: "BRL",
      exchangeRate: ExchangeRate.create(
        "EUR",
        "GBP",
        0.85,
        new Date("2024-08-01"),
      ),
      date: new Date("2024-08-01"),
    });

    assert.ok(result.isFailure);
    assert.match(result.error?.message ?? "", /RN-07/);
  });
});

describe("RN-08 — new companies get the default categories", () => {
  it("creates a category flagged as default", () => {
    const category = Category.create({
      companyId: "company-1",
      name: "Alimentação",
      type: "EXPENSE",
      isDefault: true,
    });

    assert.ok(category.value?.isDefault);
  });
});

describe("RN-09 — changes are auditable", () => {
  it("raises an event carrying the field diff of an edit", () => {
    const transaction = Transaction.create({
      companyId: "company-1",
      accountId: "account-1",
      type: "EXPENSE",
      grossAmount: 100,
      currency: "BRL",
      date: new Date("2024-08-01"),
    });

    assert.ok(transaction.value);
    transaction.value.clearEvents();
    transaction.value.edit({ grossAmount: 120 });

    const edited = transaction.value.events.find(
      (event) => event.getEventType() === "TransactionEdited",
    ) as { changes?: { field: string; oldValue: unknown; newValue: unknown }[] };

    assert.deepEqual(edited?.changes, [
      { field: "grossAmount", oldValue: 100, newValue: 120 },
    ]);
  });

  it("raises an event when an installment due date changes", () => {
    const installment = new Installment({
      id: "installment-1",
      companyId: "company-1",
      parentTransactionId: "transaction-1",
      accountId: "account-1",
      number: 1,
      amount: Money.create(100, "BRL"),
      dueDate: new Date("2024-08-10"),
    });

    installment.changeDueDate(new Date("2024-08-15"));

    const event = installment.events.find(
      (item) => item.getEventType() === "InstallmentDueDateChanged",
    ) as { oldDueDate?: Date; newDueDate?: Date };

    assert.equal(event?.oldDueDate?.toISOString().slice(0, 10), "2024-08-10");
    assert.equal(event?.newDueDate?.toISOString().slice(0, 10), "2024-08-15");
  });
});

describe("Card purchase invariants (RN-08)", () => {
  function cardPurchase(invoiceId?: string) {
    const result = Transaction.create({
      companyId: "company-1",
      accountId: "account-1",
      type: "EXPENSE",
      grossAmount: 500,
      currency: "BRL",
      date: new Date("2026-07-20T00:00:00Z"),
      cardId: "card-1",
      invoiceId,
    });

    assert.ok(result.value);
    return result.value;
  }

  it("keeps a billed purchase out of the account balance", () => {
    const purchase = cardPurchase("invoice-1");

    assert.equal(purchase.cardId, "card-1");
    assert.equal(purchase.invoiceId, "invoice-1");
    // The debit happens once, when the invoice is paid.
    assert.equal(purchase.affectsAccountBalance, false);
  });

  it("treats a debit card charge like any other expense", () => {
    const purchase = cardPurchase();

    assert.equal(purchase.cardId, "card-1");
    assert.equal(purchase.invoiceId, undefined);
    assert.equal(purchase.affectsAccountBalance, true);
  });

  it("binds a purchase to exactly one invoice", () => {
    const purchase = cardPurchase();

    assert.ok(purchase.linkToInvoice("invoice-1").isSuccess);
    assert.ok(purchase.linkToInvoice("invoice-1").isSuccess);

    const rebind = purchase.linkToInvoice("invoice-2");
    assert.ok(rebind.isFailure);
    assert.equal(rebind.error?.code, "INVALID_OPERATION");
    assert.equal(purchase.invoiceId, "invoice-1");
  });

  it("freezes a purchase consolidated into a closed invoice", () => {
    const purchase = cardPurchase("invoice-1");

    const edit = purchase.edit({ grossAmount: 600 }, { invoiceClosed: true });
    assert.ok(edit.isFailure);
    assert.equal(edit.error?.code, "INVALID_OPERATION");
    assert.equal(purchase.grossAmount.amount, 500);

    const cancel = purchase.cancel("engano", { invoiceClosed: true });
    assert.ok(cancel.isFailure);
    assert.equal(purchase.status, "PENDING");
  });

  it("still allows editing a purchase whose invoice is open", () => {
    const purchase = cardPurchase("invoice-1");

    assert.ok(
      purchase.edit({ grossAmount: 600 }, { invoiceClosed: false }).isSuccess,
    );
    assert.equal(purchase.grossAmount.amount, 600);
  });
});
