import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Account } from "./account.js";
import { ExchangeRate } from "./exchange-rate.js";
import { Installment } from "./installment.js";
import { Money } from "./money.js";
import { Recurrence, type Periodicity } from "./recurrence.js";
import { RecurrenceService } from "./recurrence-service.js";
import { TransferService } from "./transfer-service.js";

function account(currency: string, initialBalance = 0): Account {
  const result = Account.create({
    companyId: "company-1",
    walletId: "wallet-1",
    name: `Conta ${currency}`,
    number: "1",
    type: "CHECKING",
    currency,
    initialBalance,
  });

  assert.ok(result.value);
  result.value.clearEvents();
  return result.value;
}

function recurrence(
  periodicity: Periodicity,
  startDate: string,
  extra: { maxOccurrences?: number; endDate?: Date } = {},
): Recurrence {
  const result = Recurrence.create({
    companyId: "company-1",
    accountId: "account-1",
    description: "Assinatura",
    amount: 39.9,
    currency: "BRL",
    periodicity,
    startDate: new Date(startDate),
    ...extra,
  });

  assert.ok(result.value);
  return result.value;
}

const iso = (date: Date): string => date.toISOString().slice(0, 10);

describe("TransferService", () => {
  it("moves money between accounts of the same currency", () => {
    const source = account("BRL", 2000);
    const target = account("BRL", 1000);

    const result = new TransferService().transfer({
      source,
      target,
      amount: 500,
      date: new Date("2024-08-01"),
    });

    assert.ok(result.isSuccess, result.error?.message ?? "");
    // The service posts both legs; applying them to the balances is the
    // caller's job, inside a single database transaction (RN-04).
    assert.equal(source.balance.amount, 2000);
    assert.equal(target.balance.amount, 1000);

    const transfer = result.value;
    assert.ok(transfer);
    assert.equal(transfer.debit.transferId, transfer.transferId);
    assert.equal(transfer.credit.transferId, transfer.transferId);
    assert.equal(transfer.debit.status, "CONFIRMED");
    assert.equal(transfer.credit.status, "CONFIRMED");
  });

  it("rejects a transfer larger than the available balance", () => {
    const source = account("BRL", 2000);
    const target = account("BRL");

    const result = new TransferService().transfer({
      source,
      target,
      amount: 3000,
      date: new Date("2024-08-01"),
    });

    assert.ok(result.isFailure);
    assert.match(result.error?.message ?? "", /Saldo insuficiente/);
    assert.equal(source.balance.amount, 2000);
    assert.equal(target.balance.amount, 0);
  });

  it("converts across currencies using the supplied rate", () => {
    const source = account("BRL", 1000);
    const target = account("USD");

    const result = new TransferService().transfer({
      source,
      target,
      amount: 520,
      date: new Date("2024-08-01"),
      exchangeRate: ExchangeRate.create(
        "USD",
        "BRL",
        5.2,
        new Date("2024-08-01"),
      ),
    });

    assert.ok(result.isSuccess, result.error?.message ?? "");
    assert.equal(result.value?.creditedAmount.amount, 100);
    assert.equal(result.value?.credit.currency, "USD");
  });

  it("rejects a cross-currency transfer without a rate", () => {
    const result = new TransferService().transfer({
      source: account("BRL", 1000),
      target: account("USD"),
      amount: 100,
      date: new Date("2024-08-01"),
    });

    assert.ok(result.isFailure);
    assert.match(result.error?.message ?? "", /RN-07/);
  });

  it("refuses inactive accounts and self-transfers", () => {
    const service = new TransferService();
    const source = account("BRL", 1000);
    const target = account("BRL");

    assert.ok(
      service.transfer({
        source,
        target: source,
        amount: 10,
        date: new Date(),
      }).isFailure,
    );

    target.deactivate(0);
    assert.ok(
      service.transfer({ source, target, amount: 10, date: new Date() })
        .isFailure,
    );
  });

  it("reverses a completed transfer, refunding both legs", () => {
    const service = new TransferService();
    const source = account("BRL", 2000);
    const target = account("BRL", 1000);

    const transfer = service.transfer({
      source,
      target,
      amount: 500,
      date: new Date("2024-08-01"),
    });
    assert.ok(transfer.value);

    const reversal = service.reverse({
      transferId: transfer.value.transferId,
      source,
      target,
      debit: transfer.value.debit,
      credit: transfer.value.credit,
      reason: "erro operacional",
    });

    assert.ok(reversal.isSuccess, reversal.error?.message ?? "");
    assert.equal(transfer.value.debit.status, "REFUNDED");
    assert.equal(transfer.value.credit.status, "REFUNDED");
  });
});

describe("Installment generation", () => {
  it("splits a purchase into consecutive monthly due dates", () => {
    const result = Installment.generate({
      companyId: "company-1",
      parentTransactionId: "transaction-1",
      accountId: "account-1",
      total: Money.create(1200, "BRL"),
      count: 12,
      purchaseDate: new Date("2024-01-15"),
    });

    assert.ok(result.value);
    assert.equal(result.value.length, 12);
    assert.ok(result.value.every((item) => item.amount.amount === 100));
    assert.equal(iso(result.value[0]!.dueDate), "2024-02-15");
    assert.equal(iso(result.value[11]!.dueDate), "2025-01-15");
  });

  it("puts the rounding leftover on the first installment", () => {
    const result = Installment.generate({
      companyId: "company-1",
      parentTransactionId: "transaction-1",
      accountId: "account-1",
      total: Money.create(100, "BRL"),
      count: 3,
      purchaseDate: new Date("2024-01-15"),
    });

    assert.ok(result.value);
    assert.deepEqual(
      result.value.map((item) => item.amount.amount),
      [33.34, 33.33, 33.33],
    );
  });

  it("inherits the category from the parent purchase", () => {
    const result = Installment.generate({
      companyId: "company-1",
      parentTransactionId: "transaction-1",
      accountId: "account-1",
      categoryId: "category-eletronicos",
      total: Money.create(300, "BRL"),
      count: 3,
      purchaseDate: new Date("2024-01-15"),
    });

    assert.ok(result.value);
    assert.ok(
      result.value.every(
        (item) => item.categoryId === "category-eletronicos",
      ),
    );
  });

  it("rejects an amount too small for the requested count", () => {
    const result = Installment.generate({
      companyId: "company-1",
      parentTransactionId: "transaction-1",
      accountId: "account-1",
      total: Money.create(0.02, "BRL"),
      count: 3,
      purchaseDate: new Date("2024-01-15"),
    });

    assert.ok(result.isFailure);
  });
});

describe("RecurrenceService", () => {
  const service = new RecurrenceService();

  it("computes the next occurrence for each periodicity", () => {
    const cases: [Periodicity, string][] = [
      ["DAILY", "2024-08-02"],
      ["WEEKLY", "2024-08-08"],
      ["BIWEEKLY", "2024-08-15"],
      ["MONTHLY", "2024-09-01"],
      ["QUARTERLY", "2024-11-01"],
      ["SEMIANNUAL", "2025-02-01"],
      ["ANNUAL", "2025-08-01"],
    ];

    for (const [periodicity, expected] of cases) {
      const item = recurrence(periodicity, "2024-08-01");
      item.registerOccurrence(new Date("2024-08-01"), "transaction-1");
      assert.equal(iso(service.nextOccurrence(item)!), expected, periodicity);
    }
  });

  it("clamps month-end anchors without drifting", () => {
    const monthly = recurrence("MONTHLY", "2024-01-31");

    assert.equal(iso(service.occurrenceDate(monthly.startDate, "MONTHLY", 1)), "2024-02-29");
    assert.equal(iso(service.occurrenceDate(monthly.startDate, "MONTHLY", 2)), "2024-03-31");
    assert.equal(iso(service.occurrenceDate(monthly.startDate, "MONTHLY", 13)), "2025-02-28");
  });

  it("stops at the end date", () => {
    const item = recurrence("MONTHLY", "2024-01-01", {
      endDate: new Date("2024-03-01"),
    });

    assert.equal(
      service.dueOccurrences(item, new Date("2024-12-31")).length,
      3,
    );
  });

  it("stops at the maximum number of occurrences", () => {
    const item = recurrence("WEEKLY", "2024-01-01", { maxOccurrences: 10 });

    assert.equal(
      service.dueOccurrences(item, new Date("2025-01-01")).length,
      10,
    );
  });

  it("generates nothing while paused and resumes from the next date", () => {
    const item = recurrence("MONTHLY", "2024-08-01");
    item.registerOccurrence(new Date("2024-08-01"), "transaction-1");

    item.pause();
    assert.equal(service.dueOccurrences(item, new Date("2024-11-01")).length, 0);

    item.resume();
    assert.equal(iso(service.nextOccurrence(item)!), "2024-09-01");
  });
});
