import type { Knex } from "knex";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Card, type CardType } from "../domain/card.js";
import { Money } from "../domain/money.js";
import type { QueryExecutor } from "./account-repository.js";
import type { CardRepository } from "./card-repository.js";

/**
 * Invoice states that still hold an outstanding obligation on the card.
 */
const UNSETTLED_INVOICE_STATUSES = ["CLOSED", "PARTIALLY_PAID", "OVERDUE"];

function toCard(row: Record<string, unknown>): Card {
  const currency = row.currency as string;
  const rawLimit = row.credit_limit as string | null;

  return new Card({
    id: row.id as string,
    companyId: row.company_id as string,
    accountId: row.account_id as string,
    name: row.name as string,
    type: row.type as CardType,
    brand: row.brand as string,
    bank: (row.bank as string | null) ?? undefined,
    limit:
      rawLimit === null || rawLimit === undefined
        ? undefined
        : Money.fromDecimalString(String(rawLimit), currency),
    closingDay: (row.closing_day as number | null) ?? undefined,
    dueDay: (row.due_day as number | null) ?? undefined,
    currency,
    isActive: Boolean(row.is_active),
    createdAt: new Date(row.created_at as string),
  });
}

/**
 * Knex-based implementation of CardRepository.
 *
 * The card currency is not stored on the card row: it is always the currency of
 * the bound account, joined in on every read so the aggregate can be rebuilt.
 */
export class KnexCardRepository implements CardRepository {
  constructor(private readonly knex: Knex) {}

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.knex;
  }

  private baseQuery(companyId: string, executor?: QueryExecutor): Knex.QueryBuilder {
    return this.executor(executor)("cards")
      .join("accounts", "accounts.id", "cards.account_id")
      .where("cards.company_id", companyId)
      .select("cards.*", "accounts.currency as currency");
  }

  async create(card: Card, executor?: QueryExecutor): Promise<void> {
    await this.executor(executor)("cards").insert({
      id: card.id,
      company_id: card.companyId,
      account_id: card.accountId,
      name: card.name,
      type: card.type,
      brand: card.brand,
      bank: card.bank ?? null,
      credit_limit: card.limit?.toDecimalString() ?? null,
      closing_day: card.closingDay ?? null,
      due_day: card.dueDay ?? null,
      is_active: card.isActive,
      created_at: card.createdAt,
      updated_at: new Date(),
    });
  }

  async findById(companyId: string, id: string): Promise<Card | null> {
    const row = await this.baseQuery(companyId).andWhere("cards.id", id).first();
    return row ? toCard(row as Record<string, unknown>) : null;
  }

  async findByCompany(
    companyId: string,
    includeInactive = false,
  ): Promise<Card[]> {
    const query = this.baseQuery(companyId).orderBy("cards.name", "asc");

    if (!includeInactive) {
      query.andWhere("cards.is_active", true);
    }

    const rows = (await query) as Record<string, unknown>[];
    return rows.map(toCard);
  }

  async findByAccount(companyId: string, accountId: string): Promise<Card[]> {
    const rows = (await this.baseQuery(companyId)
      .andWhere("cards.account_id", accountId)
      .orderBy("cards.name", "asc")) as Record<string, unknown>[];

    return rows.map(toCard);
  }

  async update(card: Card, executor?: QueryExecutor): Promise<void> {
    await this.executor(executor)("cards")
      .where({ id: card.id, company_id: card.companyId })
      .update({
        name: card.name,
        brand: card.brand,
        bank: card.bank ?? null,
        credit_limit: card.limit?.toDecimalString() ?? null,
        closing_day: card.closingDay ?? null,
        due_day: card.dueDay ?? null,
        is_active: card.isActive,
        updated_at: new Date(),
      });
  }

  /**
   * Unbilled confirmed purchases plus the outstanding balance of every invoice
   * that is neither open nor settled. Locking the card row keeps the limit check
   * and the purchase insert from interleaving with a concurrent purchase.
   */
  async committedAmount(
    companyId: string,
    cardId: string,
    options: { executor?: QueryExecutor; lockForUpdate?: boolean } = {},
  ): Promise<Money> {
    const db = this.executor(options.executor);

    const cardQuery = db("cards")
      .join("accounts", "accounts.id", "cards.account_id")
      .where({ "cards.id": cardId, "cards.company_id": companyId })
      .select("accounts.currency as currency");

    if (options.lockForUpdate) {
      cardQuery.forUpdate("cards");
    }

    const card = (await cardQuery.first()) as
      | { currency: string }
      | undefined;

    if (!card) {
      throw DomainError.create(
        "ENTITY_NOT_FOUND",
        `Card ${cardId} not found for company ${companyId}`,
      );
    }

    // Purchases still in the open cycle: not linked to an invoice yet, or
    // linked to one that has not closed.
    const purchases = (await db("transactions")
      .leftJoin("invoices", "invoices.id", "transactions.invoice_id")
      .where({
        "transactions.company_id": companyId,
        "transactions.card_id": cardId,
        "transactions.status": "CONFIRMED",
      })
      .andWhere((builder) => {
        void builder
          .whereNull("transactions.invoice_id")
          .orWhere("invoices.status", "OPEN");
      })
      .select(
        db.raw("COALESCE(SUM(transactions.net_amount), 0) as total"),
      )
      .first()) as { total: string } | undefined;

    const outstanding = (await db("invoices")
      .where({ company_id: companyId, card_id: cardId })
      .whereIn("status", UNSETTLED_INVOICE_STATUSES)
      .select(
        db.raw("COALESCE(SUM(total_amount - paid_amount), 0) as total"),
      )
      .first()) as { total: string } | undefined;

    const purchasesTotal = Number(purchases?.total ?? 0);
    const outstandingTotal = Number(outstanding?.total ?? 0);

    return Money.fromCents(
      Math.round((purchasesTotal + outstandingTotal) * 100),
      card.currency,
    );
  }

  async countActiveByAccount(
    companyId: string,
    accountId: string,
  ): Promise<number> {
    const result = (await this.knex("cards")
      .where({ company_id: companyId, account_id: accountId, is_active: true })
      .count<{ count: string }[]>("id as count")) as { count: string }[];

    return Number(result[0]?.count ?? 0);
  }
}
