import type { Knex } from "knex";
import { Invoice, type InvoiceStatus } from "../domain/invoice.js";
import { Money } from "../domain/money.js";
import type { QueryExecutor } from "./account-repository.js";
import type {
  InvoicePaymentRecord,
  InvoiceRepository,
} from "./invoice-repository.js";

const UNSETTLED_STATUSES = ["CLOSED", "PARTIALLY_PAID", "OVERDUE"];

function toInvoice(row: Record<string, unknown>): Invoice {
  const currency = row.currency as string;

  return new Invoice({
    id: row.id as string,
    companyId: row.company_id as string,
    cardId: row.card_id as string,
    accountId: row.account_id as string,
    cycleStart: new Date(row.cycle_start as string),
    closingDate: new Date(row.closing_date as string),
    dueDate: new Date(row.due_date as string),
    currency,
    status: row.status as InvoiceStatus,
    totalAmount: Money.fromDecimalString(
      String(row.total_amount ?? "0"),
      currency,
    ),
    paidAmount: Money.fromDecimalString(
      String(row.paid_amount ?? "0"),
      currency,
    ),
    closedAt: row.closed_at ? new Date(row.closed_at as string) : undefined,
    closedBy: (row.closed_by as string | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
  });
}

function toPaymentRecord(row: Record<string, unknown>): InvoicePaymentRecord {
  return {
    id: row.id as string,
    invoiceId: row.invoice_id as string,
    transactionId: row.transaction_id as string,
    accountId: row.account_id as string,
    amount: String(row.amount ?? "0"),
    paidAt: new Date(row.paid_at as string),
  };
}

/**
 * Knex-based implementation of InvoiceRepository.
 *
 * The account is not stored on the invoice row — it is the account the card is
 * bound to, joined in on every read, so a card can never end up pointing at one
 * account while its invoices point at another.
 */
export class KnexInvoiceRepository implements InvoiceRepository {
  constructor(private readonly knex: Knex) {}

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.knex;
  }

  private baseQuery(executor?: QueryExecutor): Knex.QueryBuilder {
    return this.executor(executor)("invoices")
      .join("cards", "cards.id", "invoices.card_id")
      .select("invoices.*", "cards.account_id as account_id");
  }

  async create(invoice: Invoice, executor?: QueryExecutor): Promise<void> {
    await this.executor(executor)("invoices").insert({
      id: invoice.id,
      company_id: invoice.companyId,
      card_id: invoice.cardId,
      cycle_start: invoice.cycleStart,
      closing_date: invoice.closingDate,
      due_date: invoice.dueDate,
      status: invoice.status,
      total_amount: invoice.total.toDecimalString(),
      paid_amount: invoice.paidAmount.toDecimalString(),
      currency: invoice.currency,
      closed_at: invoice.closedAt ?? null,
      closed_by: invoice.closedBy ?? null,
      created_at: invoice.createdAt,
      updated_at: new Date(),
    });
  }

  async findById(companyId: string, id: string): Promise<Invoice | null> {
    const row = await this.baseQuery()
      .where({ "invoices.id": id, "invoices.company_id": companyId })
      .first();

    return row ? toInvoice(row as Record<string, unknown>) : null;
  }

  async findOpenByCard(
    companyId: string,
    cardId: string,
    executor?: QueryExecutor,
  ): Promise<Invoice | null> {
    const row = await this.baseQuery(executor)
      .where({
        "invoices.company_id": companyId,
        "invoices.card_id": cardId,
        "invoices.status": "OPEN",
      })
      .orderBy("invoices.closing_date", "asc")
      .first();

    return row ? toInvoice(row as Record<string, unknown>) : null;
  }

  async findByCard(companyId: string, cardId: string): Promise<Invoice[]> {
    const rows = (await this.baseQuery()
      .where({ "invoices.company_id": companyId, "invoices.card_id": cardId })
      .orderBy("invoices.closing_date", "desc")) as Record<string, unknown>[];

    return rows.map(toInvoice);
  }

  async findDueForClosing(referenceDate: Date): Promise<Invoice[]> {
    const rows = (await this.baseQuery()
      .where("invoices.status", "OPEN")
      .andWhere("invoices.closing_date", "<=", referenceDate)
      .orderBy("invoices.closing_date", "asc")) as Record<string, unknown>[];

    return rows.map(toInvoice);
  }

  async findOverdue(referenceDate: Date): Promise<Invoice[]> {
    const rows = (await this.baseQuery()
      .whereIn("invoices.status", ["CLOSED", "PARTIALLY_PAID"])
      .andWhere("invoices.due_date", "<", referenceDate)
      .andWhere(
        this.knex.raw("invoices.total_amount > invoices.paid_amount"),
      )
      .orderBy("invoices.due_date", "asc")) as Record<string, unknown>[];

    return rows.map(toInvoice);
  }

  async update(invoice: Invoice, executor?: QueryExecutor): Promise<void> {
    await this.executor(executor)("invoices")
      .where({ id: invoice.id, company_id: invoice.companyId })
      .update({
        cycle_start: invoice.cycleStart,
        closing_date: invoice.closingDate,
        due_date: invoice.dueDate,
        status: invoice.status,
        total_amount: invoice.total.toDecimalString(),
        paid_amount: invoice.paidAmount.toDecimalString(),
        closed_at: invoice.closedAt ?? null,
        closed_by: invoice.closedBy ?? null,
        updated_at: new Date(),
      });
  }

  async linkTransaction(
    invoiceId: string,
    transactionId: string,
    executor?: QueryExecutor,
  ): Promise<void> {
    await this.executor(executor)("transactions")
      .where("id", transactionId)
      .update({ invoice_id: invoiceId, updated_at: new Date() });
  }

  async registerPayment(
    payment: InvoicePaymentRecord,
    executor?: QueryExecutor,
  ): Promise<void> {
    await this.executor(executor)("invoice_payments").insert({
      id: payment.id,
      invoice_id: payment.invoiceId,
      transaction_id: payment.transactionId,
      account_id: payment.accountId,
      amount: payment.amount,
      paid_at: payment.paidAt,
    });
  }

  async listPayments(
    companyId: string,
    invoiceId: string,
  ): Promise<InvoicePaymentRecord[]> {
    const rows = (await this.knex("invoice_payments")
      .join("invoices", "invoices.id", "invoice_payments.invoice_id")
      .where({
        "invoice_payments.invoice_id": invoiceId,
        "invoices.company_id": companyId,
      })
      .select("invoice_payments.*")
      .orderBy("invoice_payments.paid_at", "asc")) as Record<string, unknown>[];

    return rows.map(toPaymentRecord);
  }

  async consolidatePurchases(
    companyId: string,
    invoiceId: string,
    executor?: QueryExecutor,
  ): Promise<{ transactionId: string; netAmount: Money }[]> {
    const db = this.executor(executor);

    const rows = (await db("transactions")
      .where({
        company_id: companyId,
        invoice_id: invoiceId,
        status: "CONFIRMED",
      })
      .select("id", "net_amount", "currency")
      .orderBy("date", "asc")) as {
      id: string;
      net_amount: string;
      currency: string;
    }[];

    const invoice = (await db("invoices")
      .where({ id: invoiceId, company_id: companyId })
      .select("currency")
      .first()) as { currency: string } | undefined;

    const currency = invoice?.currency ?? rows[0]?.currency ?? "BRL";

    return rows.map((row) => ({
      transactionId: row.id,
      netAmount: Money.fromDecimalString(row.net_amount, currency),
    }));
  }

  async countOpenByCard(companyId: string, cardId: string): Promise<number> {
    return this.countInvoices(companyId, { card_id: cardId }, ["OPEN"]);
  }

  async countUnpaidByCard(companyId: string, cardId: string): Promise<number> {
    return this.countInvoices(
      companyId,
      { card_id: cardId },
      UNSETTLED_STATUSES,
    );
  }

  /**
   * Unpaid invoices across every card bound to an account; blocks account
   * deactivation.
   */
  async countUnpaidByAccount(
    companyId: string,
    accountId: string,
  ): Promise<number> {
    const result = (await this.knex("invoices")
      .join("cards", "cards.id", "invoices.card_id")
      .where({
        "invoices.company_id": companyId,
        "cards.account_id": accountId,
      })
      .whereIn("invoices.status", UNSETTLED_STATUSES)
      .count<{ count: string }[]>("invoices.id as count")) as {
      count: string;
    }[];

    return Number(result[0]?.count ?? 0);
  }

  private async countInvoices(
    companyId: string,
    filter: Record<string, unknown>,
    statuses: readonly string[],
  ): Promise<number> {
    const result = (await this.knex("invoices")
      .where({ company_id: companyId, ...filter })
      .whereIn("status", [...statuses])
      .count<{ count: string }[]>("id as count")) as { count: string }[];

    return Number(result[0]?.count ?? 0);
  }
}
