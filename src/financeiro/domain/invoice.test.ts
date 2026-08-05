import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Card } from "./card.js";
import { Invoice, type InvoiceProps } from "./invoice.js";
import { Money } from "./money.js";

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

function openInvoice(purchaseDate = new Date("2026-07-20T00:00:00Z")): Invoice {
  const result = Invoice.open({
    companyId: "company-1",
    card: creditCard(),
    purchaseDate,
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

const brl = (value: number): Money => Money.create(value, "BRL");

describe("Invoice opening", () => {
  it("derives and materializes the cycle dates from the card", () => {
    const invoice = openInvoice();

    assert.equal(invoice.status, "OPEN");
    assert.equal(invoice.closingDate.toISOString().slice(0, 10), "2026-08-03");
    assert.equal(invoice.dueDate.toISOString().slice(0, 10), "2026-08-10");
    assert.equal(invoice.cycleStart.toISOString().slice(0, 10), "2026-07-04");
    assert.equal(invoice.total.amount, 0);
    assert.equal(invoice.outstanding.amount, 0);
  });

  it("covers only the dates of its own cycle", () => {
    const invoice = openInvoice();

    assert.ok(invoice.covers(new Date("2026-07-20T00:00:00Z")));
    assert.ok(invoice.covers(new Date("2026-08-03T00:00:00Z")));
    assert.ok(!invoice.covers(new Date("2026-08-05T00:00:00Z")));
  });

  it("refuses to open an invoice for a debit card", () => {
    const debit = Card.create({
      companyId: "company-1",
      account: {
        id: "account-1",
        companyId: "company-1",
        currency: "BRL",
        isActive: true,
      },
      name: "Débito",
      type: "DEBIT",
      brand: "Visa",
    });
    assert.ok(debit.value);

    const result = Invoice.open({
      companyId: "company-1",
      card: debit.value,
      purchaseDate: new Date("2026-07-20T00:00:00Z"),
    });

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "INVALID_OPERATION");
  });
});

describe("Invoice closing", () => {
  it("consolidates the purchases and publishes InvoiceClosed", () => {
    const invoice = openInvoice();

    const result = invoice.close(brl(1800), ["t1", "t2"]);

    assert.ok(result.isSuccess);
    assert.equal(invoice.status, "CLOSED");
    assert.equal(invoice.total.amount, 1800);
    assert.equal(invoice.outstanding.amount, 1800);
    assert.ok(
      invoice.events.some((event) => event.getEventType() === "InvoiceClosed"),
    );
  });

  it("closes an empty cycle as already paid", () => {
    const invoice = openInvoice();

    assert.ok(invoice.close(brl(0), []).isSuccess);
    assert.equal(invoice.status, "PAID");
    assert.equal(invoice.total.amount, 0);
    assert.ok(
      invoice.events.some((event) => event.getEventType() === "InvoicePaid"),
    );
  });

  it("leaves an already closed invoice untouched on a second pass", () => {
    const invoice = openInvoice();
    assert.ok(invoice.close(brl(1800), ["t1"]).isSuccess);
    invoice.clearEvents();

    const again = invoice.close(brl(1800), ["t1"]);

    assert.ok(again.isFailure);
    assert.equal(again.error?.code, "INVALID_OPERATION");
    assert.equal(invoice.events.length, 0);
  });

  it("rejects reopening a closed invoice", () => {
    const invoice = invoiceWith({ status: "CLOSED", totalAmount: brl(1800) });

    // There is no reopen() — the state machine has no edge back to OPEN, which
    // `close()` proves by refusing to run from CLOSED.
    assert.ok(invoice.close(brl(1800), []).isFailure);
    assert.equal(invoice.status, "CLOSED");
  });
});

describe("Invoice payment", () => {
  it("settles a closed invoice in full", () => {
    const invoice = invoiceWith({ status: "CLOSED", totalAmount: brl(1800) });

    assert.ok(invoice.registerPayment(brl(1800)).isSuccess);
    assert.equal(invoice.status, "PAID");
    assert.equal(invoice.outstanding.amount, 0);
    assert.ok(
      invoice.events.some((event) => event.getEventType() === "InvoicePaid"),
    );
  });

  it("moves to partially paid and publishes nothing", () => {
    const invoice = invoiceWith({ status: "CLOSED", totalAmount: brl(1800) });

    assert.ok(invoice.registerPayment(brl(900)).isSuccess);
    assert.equal(invoice.status, "PARTIALLY_PAID");
    assert.equal(invoice.outstanding.amount, 900);
    assert.ok(
      !invoice.events.some((event) => event.getEventType() === "InvoicePaid"),
    );
  });

  it("settles a partially paid invoice with the remaining amount", () => {
    const invoice = invoiceWith({
      status: "PARTIALLY_PAID",
      totalAmount: brl(1800),
      paidAmount: brl(900),
    });

    assert.ok(invoice.registerPayment(brl(900)).isSuccess);
    assert.equal(invoice.status, "PAID");
    assert.equal(invoice.outstanding.amount, 0);
  });

  it("rejects a payment on a paid invoice", () => {
    const invoice = invoiceWith({
      status: "PAID",
      totalAmount: brl(1800),
      paidAmount: brl(1800),
    });

    const result = invoice.registerPayment(brl(10));
    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "INVALID_OPERATION");
  });

  it("rejects a payment on an open invoice", () => {
    const invoice = invoiceWith({ status: "OPEN", totalAmount: brl(1800) });

    const result = invoice.registerPayment(brl(100));
    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "INVALID_OPERATION");
  });

  it("rejects a payment above the outstanding balance", () => {
    const invoice = invoiceWith({
      status: "PARTIALLY_PAID",
      totalAmount: brl(1800),
      paidAmount: brl(900),
    });

    const result = invoice.registerPayment(brl(2000));
    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
    assert.equal(invoice.paidAmount.amount, 900);
  });

  it("rejects a non-positive payment", () => {
    const invoice = invoiceWith({ status: "CLOSED", totalAmount: brl(1800) });

    assert.ok(invoice.registerPayment(brl(0)).isFailure);
  });
});

describe("Invoice overdue", () => {
  it("flags a closed invoice past its due date with the overdue days", () => {
    const invoice = invoiceWith({ status: "CLOSED", totalAmount: brl(1800) });

    const result = invoice.markOverdue(new Date("2026-08-15T00:00:00Z"));

    assert.ok(result.isSuccess);
    assert.equal(invoice.status, "OVERDUE");

    const event = invoice.events.find(
      (candidate) => candidate.getEventType() === "InvoiceOverdue",
    );
    assert.ok(event);
    assert.equal((event as unknown as { overdueDays: number }).overdueDays, 5);
  });

  it("does nothing before the due date", () => {
    const invoice = invoiceWith({ status: "CLOSED", totalAmount: brl(1800) });

    assert.ok(invoice.markOverdue(new Date("2026-08-05T00:00:00Z")).isFailure);
    assert.equal(invoice.status, "CLOSED");
  });

  it("is idempotent — a second pass changes nothing", () => {
    const invoice = invoiceWith({ status: "CLOSED", totalAmount: brl(1800) });
    assert.ok(invoice.markOverdue(new Date("2026-08-15T00:00:00Z")).isSuccess);
    invoice.clearEvents();

    assert.ok(invoice.markOverdue(new Date("2026-08-16T00:00:00Z")).isFailure);
    assert.equal(invoice.events.length, 0);
  });

  it("accepts full payment of an overdue invoice", () => {
    const invoice = invoiceWith({ status: "OVERDUE", totalAmount: brl(1800) });

    assert.ok(invoice.registerPayment(brl(1800)).isSuccess);
    assert.equal(invoice.status, "PAID");
    assert.ok(
      invoice.events.some((event) => event.getEventType() === "InvoicePaid"),
    );
  });

  it("never leaves the paid state", () => {
    const invoice = invoiceWith({
      status: "PAID",
      totalAmount: brl(1800),
      paidAmount: brl(1800),
    });

    assert.ok(invoice.markOverdue(new Date("2026-09-01T00:00:00Z")).isFailure);
    assert.ok(invoice.close(brl(1800), []).isFailure);
    assert.equal(invoice.status, "PAID");
  });
});

describe("Invoice refund adjustment", () => {
  it("reduces the total and the outstanding balance of an unpaid invoice", () => {
    const invoice = invoiceWith({ status: "CLOSED", totalAmount: brl(1800) });

    assert.ok(invoice.adjustForRefund(brl(200)).isSuccess);
    assert.equal(invoice.total.amount, 1600);
    assert.equal(invoice.outstanding.amount, 1600);
  });

  it("refuses to adjust a paid invoice", () => {
    const invoice = invoiceWith({
      status: "PAID",
      totalAmount: brl(1800),
      paidAmount: brl(1800),
    });

    assert.ok(invoice.adjustForRefund(brl(200)).isFailure);
  });

  it("refuses to adjust beyond the outstanding balance", () => {
    const invoice = invoiceWith({
      status: "PARTIALLY_PAID",
      totalAmount: brl(1800),
      paidAmount: brl(1700),
    });

    assert.ok(invoice.adjustForRefund(brl(200)).isFailure);
  });
});
