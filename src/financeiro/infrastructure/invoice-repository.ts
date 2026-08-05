import type { Invoice } from "../domain/invoice.js";
import type { Money } from "../domain/money.js";
import type { QueryExecutor } from "./account-repository.js";

/**
 * A payment applied to an invoice, linked to the expense transaction that
 * debited the paying account.
 */
export interface InvoicePaymentRecord {
  id: string;
  invoiceId: string;
  transactionId: string;
  accountId: string;
  amount: string;
  paidAt: Date;
}

/**
 * Repository interface for the Invoice aggregate root.
 * Every read is scoped by companyId, except the scheduler sweeps, which run
 * across companies and carry the tenant on each returned aggregate.
 */
export interface InvoiceRepository {
  create(invoice: Invoice, executor?: QueryExecutor): Promise<void>;

  findById(companyId: string, id: string): Promise<Invoice | null>;

  /**
   * The single OPEN invoice of a card, if any. Respects the unique index on
   * (card_id, closing_date).
   */
  findOpenByCard(
    companyId: string,
    cardId: string,
    executor?: QueryExecutor,
  ): Promise<Invoice | null>;

  findByCard(companyId: string, cardId: string): Promise<Invoice[]>;

  /**
   * Open invoices whose closing date has been reached, across every company.
   */
  findDueForClosing(referenceDate: Date): Promise<Invoice[]>;

  /**
   * Closed or partially paid invoices past their due date, across every company.
   */
  findOverdue(referenceDate: Date): Promise<Invoice[]>;

  update(invoice: Invoice, executor?: QueryExecutor): Promise<void>;

  /**
   * Binds a purchase to the invoice of its cycle.
   */
  linkTransaction(
    invoiceId: string,
    transactionId: string,
    executor?: QueryExecutor,
  ): Promise<void>;

  registerPayment(
    payment: InvoicePaymentRecord,
    executor?: QueryExecutor,
  ): Promise<void>;

  listPayments(
    companyId: string,
    invoiceId: string,
  ): Promise<InvoicePaymentRecord[]>;

  /**
   * The confirmed purchases linked to the invoice, each with its net amount —
   * the input `InvoiceClosingService` consolidates into the invoice total.
   */
  consolidatePurchases(
    companyId: string,
    invoiceId: string,
    executor?: QueryExecutor,
  ): Promise<{ transactionId: string; netAmount: Money }[]>;

  /**
   * Counts used to guard card and account deactivation.
   */
  countOpenByCard(companyId: string, cardId: string): Promise<number>;

  countUnpaidByCard(companyId: string, cardId: string): Promise<number>;

  countUnpaidByAccount(companyId: string, accountId: string): Promise<number>;
}
