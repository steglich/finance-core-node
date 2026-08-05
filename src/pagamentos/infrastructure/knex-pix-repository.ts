import type { Knex } from "knex";
import type { QueryExecutor } from "../../financeiro/infrastructure/account-repository.js";
import type {
  PixDirection,
  PixPaymentRecord,
  PixRepository,
} from "./pix-repository.js";

function toRecord(row: Record<string, unknown>): PixPaymentRecord {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    transactionId: row.transaction_id as string,
    direction: row.direction as PixDirection,
    pixKey: row.pix_key as string,
    personId: (row.person_id as string | null) ?? undefined,
    bankAccountId: (row.bank_account_id as string | null) ?? undefined,
    chargeId: (row.charge_id as string | null) ?? undefined,
    occurredAt: new Date(row.occurred_at as string),
  };
}

/**
 * Knex-based implementation of PixRepository.
 */
export class KnexPixRepository implements PixRepository {
  constructor(private readonly knex: Knex) {}

  async create(
    record: PixPaymentRecord,
    executor?: QueryExecutor,
  ): Promise<void> {
    await (executor ?? this.knex)("pix_payments").insert({
      id: record.id,
      company_id: record.companyId,
      transaction_id: record.transactionId,
      direction: record.direction,
      pix_key: record.pixKey,
      person_id: record.personId ?? null,
      bank_account_id: record.bankAccountId ?? null,
      charge_id: record.chargeId ?? null,
      occurred_at: record.occurredAt,
    });
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<PixPaymentRecord | null> {
    const row = await this.knex("pix_payments")
      .where({ id, company_id: companyId })
      .first();

    return row ? toRecord(row as Record<string, unknown>) : null;
  }

  async findByCompany(
    companyId: string,
    filter: {
      direction?: PixDirection | undefined;
      personId?: string | undefined;
      from?: Date | undefined;
      to?: Date | undefined;
    } = {},
  ): Promise<PixPaymentRecord[]> {
    const query = this.knex("pix_payments").where({ company_id: companyId });

    if (filter.direction) {
      query.andWhere("direction", filter.direction);
    }
    if (filter.personId) {
      query.andWhere("person_id", filter.personId);
    }
    if (filter.from) {
      query.andWhere("occurred_at", ">=", filter.from);
    }
    if (filter.to) {
      query.andWhere("occurred_at", "<=", filter.to);
    }

    const rows = await query.orderBy("occurred_at", "desc");

    return rows.map((row) => toRecord(row as Record<string, unknown>));
  }
}
