import type { Knex } from "knex";
import type {
  NetWorthComponentRow,
  NetWorthRepository,
} from "./net-worth-repository.js";

const DEFAULT_CURRENCY = "BRL";

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * The signed contribution of a confirmed transaction to its account's balance,
 * expressed in the **account's** currency.
 *
 * A credit card purchase (one bound to an invoice) never touched the balance,
 * so it contributes nothing — the debit happens when the invoice is paid
 * (RN-08). A transaction registered in another currency is converted by the
 * rate stored on it, in whichever direction that rate was registered; today's
 * rate is never applied to a past movement (RN-07).
 */
const SIGNED_ENTRY = `
  case when t.invoice_id is not null then 0
       else (case when t.type = 'INCOME' then 1 else -1 end) *
            (case
               when t.currency = a.currency then t.net_amount
               when t.exchange_rate->>'sourceCurrency' = t.currency
                    and t.exchange_rate->>'targetCurrency' = a.currency
                 then t.net_amount * (t.exchange_rate->>'rate')::numeric
               when t.exchange_rate->>'sourceCurrency' = a.currency
                    and t.exchange_rate->>'targetCurrency' = t.currency
                 then t.net_amount / nullif((t.exchange_rate->>'rate')::numeric, 0)
               else t.net_amount
             end)
  end
`;

/**
 * Knex read model for net worth.
 *
 * Every component is summed in SQL and returned in its own currency; the
 * conversion to a display currency happens in TypeScript through the
 * `ExchangeService`, so the rate resolution rule — most recent on or before the
 * date, with the inverse-pair fallback — exists exactly once (design,
 * decision 11).
 */
export class KnexNetWorthRepository implements NetWorthRepository {
  constructor(private readonly knex: Knex) {}

  async defaultCurrency(companyId: string): Promise<string> {
    const row = (await this.knex("companies")
      .where("id", companyId)
      .first("default_currency")) as
      | { default_currency?: string }
      | undefined;

    return row?.default_currency ?? DEFAULT_CURRENCY;
  }

  async netWorthAt(
    companyId: string,
    referenceDate: Date,
    accountIds?: readonly string[],
  ): Promise<NetWorthComponentRow[]> {
    const [
      accountBalances,
      portfolio,
      receivables,
      loans,
      invoices,
      payables,
    ] = await Promise.all([
      this.accountBalances(companyId, referenceDate, accountIds),
      this.investmentPortfolio(companyId, referenceDate, accountIds),
      this.openReceivables(companyId, referenceDate),
      this.loanBalances(companyId, referenceDate),
      this.openInvoices(companyId, referenceDate),
      this.openPayables(companyId, referenceDate),
    ]);

    return [
      ...accountBalances,
      ...portfolio,
      ...receivables,
      ...loans,
      ...invoices,
      ...payables,
    ].filter((row) => row.amount !== 0);
  }

  /**
   * Balances of the **active** accounts, rebuilt from the confirmed entries
   * dated up to the reference date rather than read from the cached balance
   * column — the cache answers about today, and this question is about a date.
   *
   * The account's initial balance is itself an adjustment transaction (RN-02),
   * so it is already in the sum.
   */
  private async accountBalances(
    companyId: string,
    referenceDate: Date,
    accountIds?: readonly string[],
  ): Promise<NetWorthComponentRow[]> {
    // One pass over the confirmed entries, summed per account …
    const entries = this.knex("transactions as t")
      .join("accounts as a", "a.id", "t.account_id")
      .where("t.company_id", companyId)
      .andWhere("t.status", "CONFIRMED")
      .andWhere("t.date", "<=", referenceDate)
      .groupBy("t.account_id")
      .select("t.account_id")
      .select(this.knex.raw(`coalesce(sum(${SIGNED_ENTRY}), 0) as total`))
      .as("e");

    // … then folded into the currencies of the still-active accounts. An
    // inactive account keeps its residual balance in storage but contributes
    // nothing to net worth.
    const query = this.knex("accounts as a")
      .leftJoin(entries, "e.account_id", "a.id")
      .where("a.company_id", companyId)
      .andWhere("a.is_active", true)
      .groupBy("a.currency")
      .select("a.currency")
      .select(this.knex.raw("coalesce(sum(e.total), 0) as total"));

    if (accountIds && accountIds.length > 0) {
      query.whereIn("a.id", [...accountIds]);
    }

    const rows = (await query) as Record<string, unknown>[];

    return rows.map((row) => ({
      component: "ACCOUNT_BALANCES" as const,
      side: "ASSET" as const,
      currency: (row.currency as string) ?? DEFAULT_CURRENCY,
      amount: round2(num(row.total)),
    }));
  }

  /**
   * The current value of the portfolio: the position at the reference date
   * priced by the quote in force at it, falling back to the invested cost when
   * there is none (design, decision 8).
   */
  private async investmentPortfolio(
    companyId: string,
    referenceDate: Date,
    accountIds?: readonly string[],
  ): Promise<NetWorthComponentRow[]> {
    const positions = this.knex("investment_operations as o")
      .where("o.company_id", companyId)
      .andWhere("o.operated_at", "<=", referenceDate)
      .groupBy("o.investment_id")
      .select("o.investment_id")
      .select(
        this.knex.raw(`
          coalesce(sum(case when o.operation_type = 'BUY' then o.quantity
                            when o.operation_type = 'SELL' then -o.quantity
                            else 0 end), 0) as quantity,
          coalesce(sum(case when o.operation_type = 'BUY' then o.amount else 0 end), 0) as bought_amount,
          coalesce(sum(case when o.operation_type = 'BUY' then o.quantity else 0 end), 0) as bought_quantity
        `),
      )
      .as("p");

    const quotes = this.knex("investment_quotes")
      .distinctOn("investment_id")
      .where("quote_date", "<=", referenceDate)
      .orderBy("investment_id")
      .orderBy("quote_date", "desc")
      .select("investment_id", "unit_price")
      .as("q");

    const query = this.knex("investments as i")
      .join(positions, "p.investment_id", "i.id")
      .leftJoin(quotes, "q.investment_id", "i.id")
      .where("i.company_id", companyId)
      .groupBy("i.currency")
      .select("i.currency")
      .select(
        this.knex.raw(`
          coalesce(sum(
            case
              when p.quantity <= 0 then 0
              when q.unit_price is not null then p.quantity * q.unit_price
              when p.bought_quantity > 0
                then p.quantity * (p.bought_amount / p.bought_quantity)
              else 0
            end
          ), 0) as total
        `),
      );

    if (accountIds && accountIds.length > 0) {
      query.whereIn("i.account_id", [...accountIds]);
    }

    const rows = (await query) as Record<string, unknown>[];

    return rows.map((row) => ({
      component: "INVESTMENT_PORTFOLIO" as const,
      side: "ASSET" as const,
      currency: (row.currency as string) ?? DEFAULT_CURRENCY,
      amount: round2(num(row.total)),
    }));
  }

  /**
   * Charges already issued at the reference date and not yet settled.
   */
  private async openReceivables(
    companyId: string,
    referenceDate: Date,
  ): Promise<NetWorthComponentRow[]> {
    const rows = (await this.knex("charges")
      .where("company_id", companyId)
      .whereIn("status", ["ISSUED", "OVERDUE"])
      .andWhere("issue_date", "<=", referenceDate)
      .groupBy("currency")
      .select("currency")
      .sum({ total: "amount" })) as Record<string, unknown>[];

    return rows.map((row) => ({
      component: "OPEN_RECEIVABLES" as const,
      side: "ASSET" as const,
      currency: (row.currency as string) ?? DEFAULT_CURRENCY,
      amount: round2(num(row.total)),
    }));
  }

  /**
   * The outstanding balance of the loans that are not settled: the sum of the
   * principal portions still open, which is exactly what `Loan.balanceFrom`
   * derives in the domain.
   */
  private async loanBalances(
    companyId: string,
    referenceDate: Date,
  ): Promise<NetWorthComponentRow[]> {
    const rows = (await this.knex("loan_installments as li")
      .join("loans as l", "l.id", "li.loan_id")
      .where("l.company_id", companyId)
      .whereNot("l.status", "SETTLED")
      .andWhere("l.created_at", "<=", referenceDate)
      .andWhere((builder) => {
        builder
          .whereNot("li.status", "PAID")
          .orWhere("li.paid_at", ">", referenceDate);
      })
      .groupBy("l.currency")
      .select("l.currency")
      .sum({ total: "li.principal_amount" })) as Record<string, unknown>[];

    return rows.map((row) => ({
      component: "LOAN_BALANCES" as const,
      side: "LIABILITY" as const,
      currency: (row.currency as string) ?? DEFAULT_CURRENCY,
      amount: round2(num(row.total)),
    }));
  }

  /**
   * Credit card invoices already closed and still owed, counted by what is left
   * to pay rather than by their total.
   */
  private async openInvoices(
    companyId: string,
    referenceDate: Date,
  ): Promise<NetWorthComponentRow[]> {
    const rows = (await this.knex("invoices")
      .where("company_id", companyId)
      .whereIn("status", ["OPEN", "CLOSED", "PARTIALLY_PAID", "OVERDUE"])
      .andWhere("cycle_start", "<=", referenceDate)
      .groupBy("currency")
      .select("currency")
      .select(
        this.knex.raw(
          "coalesce(sum(greatest(total_amount - paid_amount, 0)), 0) as total",
        ),
      )) as Record<string, unknown>[];

    return rows.map((row) => ({
      component: "OPEN_INVOICES" as const,
      side: "LIABILITY" as const,
      currency: (row.currency as string) ?? DEFAULT_CURRENCY,
      amount: round2(num(row.total)),
    }));
  }

  /**
   * Payables still owed at the reference date.
   */
  private async openPayables(
    companyId: string,
    referenceDate: Date,
  ): Promise<NetWorthComponentRow[]> {
    const rows = (await this.knex("payables")
      .where("company_id", companyId)
      .whereIn("status", ["PENDING", "OVERDUE"])
      .andWhere("due_date", "<=", referenceDate)
      .groupBy("currency")
      .select("currency")
      .sum({ total: "amount" })) as Record<string, unknown>[];

    return rows.map((row) => ({
      component: "OPEN_PAYABLES" as const,
      side: "LIABILITY" as const,
      currency: (row.currency as string) ?? DEFAULT_CURRENCY,
      amount: round2(num(row.total)),
    }));
  }
}
