import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Account } from "./account.js";
import { Card } from "./card.js";
import { Invoice, type InvoiceProps } from "./invoice.js";
import { InvoiceAssignmentService } from "./invoice-assignment-service.js";
import { InvoiceClosingService } from "./invoice-closing-service.js";
import { InvoicePaymentService } from "./invoice-payment-service.js";
import { Money } from "./money.js";

const brl = (value: number): Money => Money.create(value, "BRL");

function account(balance: number): Account {
  const result = Account.create({
    companyId: "company-1",
    walletId: "wallet-1",
    name: "Conta Corrente",
    number: "1234",
    type: "CHECKING",
    currency: "BRL",
    initialBalance: balance,
  });

  assert.ok(result.value);
  result.value.clearEvents();
  return result.value;
}

function creditCard(): Card {
  const result = Card.create({
    companyId: "company-1",
    account: {
      id: "account-1",
      companyId: "company-1",
      currency: "BRL",
      isActive: true,
    },
    name: "Nubank",
    type: "CREDIT",
    brand: "Visa",
    limit: 5000,
    closingDay: 3,
    dueDay: 10,
  });

  assert.ok(result.value);
  return result.value;
}

function invoiceWith(props: Partial<InvoiceProps>): Invoice {
  return new Invoice({
    id: "invoice-1",
    companyId: "company-1",
    cardId: "card-1",
    accountId: "account-1",
    cycleStart: new Date("2026-07-04T00:00:00Z"),
    closingDate: new Date("2026-08-03T00:00:00Z"),
    dueDate: new Date("2026-08-10T00:00:00Z"),
    currency: "BRL",
    ...props,
  });
}

describe("InvoiceClosingService", () => {
  const service = new InvoiceClosingService();

  it("consolidates the cycle purchases into the invoice total", () => {
    const invoice = invoiceWith({});

    const result = service.close({
      invoice,
      purchases: [
        { transactionId: "t1", netAmount: brl(1000) },
        { transactionId: "t2", netAmount: brl(800) },
      ],
    });

    assert.ok(result.isSuccess);
    assert.equal(result.value?.total.amount, 1800);
    assert.deepEqual(result.value?.transactionIds, ["t1", "t2"]);
    assert.equal(invoice.status, "CLOSED");
    assert.ok(
      result.value?.events.some(
        (event) => event.getEventType() === "InvoiceClosed",
      ),
    );
  });

  it("closes an empty cycle as paid, with nothing to settle", () => {
    const invoice = invoiceWith({});

    const result = service.close({ invoice, purchases: [] });

    assert.ok(result.isSuccess);
    assert.equal(invoice.status, "PAID");
    assert.equal(invoice.total.amount, 0);
  });

  it("is idempotent — a second pass publishes nothing", () => {
    const invoice = invoiceWith({});
    assert.ok(
      service.close({
        invoice,
        purchases: [{ transactionId: "t1", netAmount: brl(1800) }],
      }).isSuccess,
    );
    invoice.clearEvents();

    const again = service.close({
      invoice,
      purchases: [{ transactionId: "t1", netAmount: brl(1800) }],
    });

    assert.ok(again.isFailure);
    assert.equal(again.error?.code, "INVALID_OPERATION");
    assert.equal(invoice.events.length, 0);
  });
});

describe("InvoicePaymentService", () => {
  const service = new InvoicePaymentService();

  it("pays a closed invoice in full and builds the confirmed expense", () => {
    const invoice = invoiceWith({ status: "CLOSED", totalAmount: brl(1800) });
    const payer = account(5000);

    const result = service.pay({ invoice, account: payer, amount: 1800 });

    assert.ok(result.isSuccess);
    assert.equal(invoice.status, "PAID");
    assert.equal(invoice.outstanding.amount, 0);

    const payment = result.value?.payment;
    assert.ok(payment);
    assert.equal(payment.type, "EXPENSE");
    assert.equal(payment.status, "CONFIRMED");
    assert.equal(payment.netAmount.amount, 1800);
    assert.ok(
      result.value?.events.some(
        (event) => event.getEventType() === "InvoicePaid",
      ),
    );
  });

  it("registers a partial payment without settling the invoice", () => {
    const invoice = invoiceWith({ status: "CLOSED", totalAmount: brl(1800) });

    const result = service.pay({
      invoice,
      account: account(5000),
      amount: 900,
    });

    assert.ok(result.isSuccess);
    assert.equal(invoice.status, "PARTIALLY_PAID");
    assert.equal(invoice.outstanding.amount, 900);
    assert.ok(
      !result.value?.events.some(
        (event) => event.getEventType() === "InvoicePaid",
      ),
    );
  });

  it("rejects a payment when the account has insufficient balance", () => {
    const invoice = invoiceWith({ status: "CLOSED", totalAmount: brl(1800) });

    const result = service.pay({
      invoice,
      account: account(500),
      amount: 1800,
    });

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
    // The invoice must be untouched when the payment is refused.
    assert.equal(invoice.status, "CLOSED");
    assert.equal(invoice.paidAmount.amount, 0);
  });

  it("rejects a payment above the outstanding balance", () => {
    const invoice = invoiceWith({
      status: "PARTIALLY_PAID",
      totalAmount: brl(1800),
      paidAmount: brl(900),
    });

    const result = service.pay({
      invoice,
      account: account(5000),
      amount: 2000,
    });

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
    assert.equal(invoice.paidAmount.amount, 900);
  });

  it("rejects paying an already paid invoice", () => {
    const invoice = invoiceWith({
      status: "PAID",
      totalAmount: brl(1800),
      paidAmount: brl(1800),
    });

    const result = service.pay({
      invoice,
      account: account(5000),
      amount: 100,
    });

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "INVALID_OPERATION");
  });

  it("rejects paying from an account of another company", () => {
    const invoice = invoiceWith({ status: "CLOSED", totalAmount: brl(1800) });
    const foreign = Account.create({
      companyId: "company-2",
      walletId: "wallet-2",
      name: "Outra",
      number: "9",
      type: "CHECKING",
      currency: "BRL",
      initialBalance: 5000,
    });
    assert.ok(foreign.value);

    const result = service.pay({
      invoice,
      account: foreign.value,
      amount: 1800,
    });

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "UNAUTHORIZED_ACCESS");
  });
});

describe("InvoiceAssignmentService", () => {
  const service = new InvoiceAssignmentService();

  it("opens the cycle invoice when the card has none", () => {
    const result = service.assign({
      companyId: "company-1",
      card: creditCard(),
      purchaseDate: new Date("2026-07-20T00:00:00Z"),
      existingInvoices: [],
    });

    assert.ok(result.isSuccess);
    assert.equal(result.value?.created, true);
    assert.equal(
      result.value?.invoice.closingDate.toISOString().slice(0, 10),
      "2026-08-03",
    );
  });

  it("reuses the open invoice whose cycle covers the purchase", () => {
    const existing = invoiceWith({});

    const result = service.assign({
      companyId: "company-1",
      card: creditCard(),
      purchaseDate: new Date("2026-07-20T00:00:00Z"),
      existingInvoices: [existing],
    });

    assert.ok(result.isSuccess);
    assert.equal(result.value?.created, false);
    assert.equal(result.value?.invoice.id, existing.id);
  });

  it("sends a purchase made after the closing date to the next cycle", () => {
    const closed = invoiceWith({ status: "CLOSED", totalAmount: brl(1800) });

    const result = service.assign({
      companyId: "company-1",
      card: creditCard(),
      purchaseDate: new Date("2026-08-05T00:00:00Z"),
      existingInvoices: [closed],
    });

    assert.ok(result.isSuccess);
    assert.equal(result.value?.created, true);
    assert.equal(
      result.value?.invoice.closingDate.toISOString().slice(0, 10),
      "2026-09-03",
    );
  });

  it("rejects a purchase on an inactive card", () => {
    const card = creditCard();
    assert.ok(card.deactivate(0, 0).isSuccess);

    const result = service.assign({
      companyId: "company-1",
      card,
      purchaseDate: new Date("2026-07-20T00:00:00Z"),
      existingInvoices: [],
    });

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "INVALID_OPERATION");
  });
});
