import type { Knex } from "knex";
import { Money } from "../../financeiro/domain/money.js";
import { Percent } from "../../financeiro/domain/percent.js";
import type { QueryExecutor } from "../../financeiro/infrastructure/account-repository.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Charge } from "../domain/charge.js";
import type { ChargeStatus } from "../domain/charge.js";
import type {
  ChargeFilter,
  ChargeReceiptRecord,
  ChargeRepository,
} from "./charge-repository.js";

/**
 * The statuses a charge may be updated *from*. PAID and CANCELLED are final, so
 * an update that finds the row in one of them must fail rather than overwrite it.
 */
const UPDATABLE_STATUSES: readonly ChargeStatus[] = ["ISSUED", "OVERDUE"];

/**
 * Maps a `charges` row into the Charge aggregate.
 */
function toCharge(row: Record<string, unknown>): Charge {
  const currency = row.currency as string;

  return new Charge({
    id: row.id as string,
    companyId: row.company_id as string,
    personId: row.person_id as string,
    amount: Money.fromDecimalString(String(row.amount), currency),
    currency,
    issueDate: new Date(row.issue_date as string),
    dueDate: new Date(row.due_date as string),
    description: (row.description as string | null) ?? undefined,
    penaltyPercent: Percent.create(Number(row.penalty_percent ?? 0)),
    monthlyInterestPercent: Percent.create(
      Number(row.monthly_interest_percent ?? 0),
    ),
    status: row.status as ChargeStatus,
    externalReference: (row.external_reference as string | null) ?? undefined,
    cancelReason: (row.cancel_reason as string | null) ?? undefined,
    cancelledAt: row.cancelled_at
      ? new Date(row.cancelled_at as string)
      : undefined,
    paidAt: row.paid_at ? new Date(row.paid_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
  });
}

function toReceipt(row: Record<string, unknown>): ChargeReceiptRecord {
  return {
    id: row.id as string,
    chargeId: row.charge_id as string,
    transactionId: row.transaction_id as string,
    accountId: row.account_id as string,
    amount: String(row.amount),
    penaltyAmount: String(row.penalty_amount),
    interestAmount: String(row.interest_amount),
    receivedAt: new Date(row.received_at as string),
  };
}

/**
 * Knex-based implementation of ChargeRepository.
 */
export class KnexChargeRepository implements ChargeRepository {
  constructor(private readonly knex: Knex) {}

  async create(charge: Charge, executor?: QueryExecutor): Promise<void> {
    await (executor ?? this.knex)("charges").insert({
      id: charge.id,
      company_id: charge.companyId,
      person_id: charge.personId,
      amount: charge.amount.toDecimalString(),
      currency: charge.currency,
      issue_date: charge.issueDate,
      due_date: charge.dueDate,
      description: charge.description ?? null,
      penalty_percent: charge.penaltyPercent.value,
      monthly_interest_percent: charge.monthlyInterestPercent.value,
      status: charge.status,
      external_reference: charge.externalReference ?? null,
      created_at: charge.createdAt,
      updated_at: new Date(),
    });
  }

  async findById(companyId: string, id: string): Promise<Charge | null> {
    const row = await this.knex("charges")
      .where({ id, company_id: companyId })
      .first();

    return row ? toCharge(row as Record<string, unknown>) : null;
  }

  async findByCompany(
    companyId: string,
    filter: ChargeFilter = {},
  ): Promise<{ items: Charge[]; total: number }> {
    const base = this.knex("charges").where({ company_id: companyId });

    if (filter.personId) {
      base.andWhere("person_id", filter.personId);
    }
    if (filter.status) {
      base.andWhere("status", filter.status);
    }
    if (filter.dueFrom) {
      base.andWhere("due_date", ">=", filter.dueFrom);
    }
    if (filter.dueTo) {
      base.andWhere("due_date", "<=", filter.dueTo);
    }

    const countResult = (await base
      .clone()
      .count<{ count: string }[]>("id as count")) as { count: string }[];

    const query = base.clone().orderBy("due_date", "asc");
    if (filter.limit !== undefined) {
      query.limit(filter.limit);
    }
    if (filter.offset !== undefined) {
      query.offset(filter.offset);
    }

    const rows = await query;

    return {
      items: rows.map((row) => toCharge(row as Record<string, unknown>)),
      total: Number(countResult[0]?.count ?? 0),
    };
  }

  /**
   * Writes the charge with the status it was allowed to move from in the WHERE
   * clause, and demands exactly one row.
   *
   * Two concurrent receipts both build a valid income transaction, but only the
   * first commit leaves the row in a status the second can match: the second
   * update touches zero rows, throws here, and the surrounding `runAtomic`
   * rolls its transaction back. Cheaper than a row lock, and it works the same
   * way for the scheduler's overdue pass.
   */
  async update(charge: Charge, executor?: QueryExecutor): Promise<void> {
    const updated = await (executor ?? this.knex)("charges")
      .where({ id: charge.id, company_id: charge.companyId })
      .whereIn("status", [...UPDATABLE_STATUSES])
      .update({
        amount: charge.amount.toDecimalString(),
        due_date: charge.dueDate,
        description: charge.description ?? null,
        penalty_percent: charge.penaltyPercent.value,
        monthly_interest_percent: charge.monthlyInterestPercent.value,
        status: charge.status,
        cancel_reason: charge.cancelReason ?? null,
        cancelled_at: charge.cancelledAt ?? null,
        paid_at: charge.paidAt ?? null,
        updated_at: new Date(),
      });

    if (updated !== 1) {
      throw DomainError.create(
        "INVALID_OPERATION",
        `Charge ${charge.id} is no longer in a state that accepts this operation`,
      );
    }
  }

  async findOverdueCandidates(referenceDate: Date): Promise<Charge[]> {
    const rows = await this.knex("charges")
      .where("status", "ISSUED")
      .andWhere("due_date", "<", referenceDate)
      .orderBy("due_date", "asc");

    return rows.map((row) => toCharge(row as Record<string, unknown>));
  }

  async hasOpenCharges(companyId: string, personId: string): Promise<number> {
    const result = (await this.knex("charges")
      .where({ company_id: companyId, person_id: personId })
      .whereIn("status", [...UPDATABLE_STATUSES])
      .count<{ count: string }[]>("id as count")) as { count: string }[];

    return Number(result[0]?.count ?? 0);
  }

  async registerReceipt(
    receipt: ChargeReceiptRecord,
    executor?: QueryExecutor,
  ): Promise<void> {
    await (executor ?? this.knex)("charge_receipts").insert({
      id: receipt.id,
      charge_id: receipt.chargeId,
      transaction_id: receipt.transactionId,
      account_id: receipt.accountId,
      amount: receipt.amount,
      penalty_amount: receipt.penaltyAmount,
      interest_amount: receipt.interestAmount,
      received_at: receipt.receivedAt,
    });
  }

  async isReceiptTransaction(
    companyId: string,
    transactionId: string,
  ): Promise<boolean> {
    const row = await this.knex("charge_receipts as r")
      .join("charges as c", "c.id", "r.charge_id")
      .where({ "r.transaction_id": transactionId, "c.company_id": companyId })
      .first();

    return row !== undefined;
  }

  async listReceipts(
    companyId: string,
    chargeId: string,
  ): Promise<ChargeReceiptRecord[]> {
    const rows = await this.knex("charge_receipts as r")
      .join("charges as c", "c.id", "r.charge_id")
      .where({ "r.charge_id": chargeId, "c.company_id": companyId })
      .orderBy("r.received_at", "asc")
      .select("r.*");

    return rows.map((row) => toReceipt(row as Record<string, unknown>));
  }
}
