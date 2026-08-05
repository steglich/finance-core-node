import type { Knex } from "knex";
import { Money } from "../../financeiro/domain/money.js";
import type { QueryExecutor } from "../../financeiro/infrastructure/account-repository.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Payable } from "../domain/payable.js";
import type { PayableStatus } from "../domain/payable.js";
import type {
  PayableFilter,
  PayablePaymentRecord,
  PayableRepository,
} from "./payable-repository.js";

/**
 * The statuses a payable may be updated *from*. PAID and CANCELLED are final.
 */
const UPDATABLE_STATUSES: readonly PayableStatus[] = ["PENDING", "OVERDUE"];

/**
 * Maps a `payables` row into the Payable aggregate.
 */
function toPayable(row: Record<string, unknown>): Payable {
  const currency = row.currency as string;

  return new Payable({
    id: row.id as string,
    companyId: row.company_id as string,
    personId: row.person_id as string,
    categoryId: row.category_id as string,
    costCenterId: (row.cost_center_id as string | null) ?? undefined,
    amount: Money.fromDecimalString(String(row.amount), currency),
    currency,
    dueDate: new Date(row.due_date as string),
    competenceDate: row.competence_date
      ? new Date(row.competence_date as string)
      : undefined,
    description: (row.description as string | null) ?? undefined,
    documentNumber: (row.document_number as string | null) ?? undefined,
    status: row.status as PayableStatus,
    cancelReason: (row.cancel_reason as string | null) ?? undefined,
    cancelledAt: row.cancelled_at
      ? new Date(row.cancelled_at as string)
      : undefined,
    paidAt: row.paid_at ? new Date(row.paid_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
  });
}

function toPayment(row: Record<string, unknown>): PayablePaymentRecord {
  return {
    id: row.id as string,
    payableId: row.payable_id as string,
    transactionId: row.transaction_id as string,
    accountId: row.account_id as string,
    amount: String(row.amount),
    paidAt: new Date(row.paid_at as string),
  };
}

/**
 * Knex-based implementation of PayableRepository.
 */
export class KnexPayableRepository implements PayableRepository {
  constructor(private readonly knex: Knex) {}

  async create(payable: Payable, executor?: QueryExecutor): Promise<void> {
    await (executor ?? this.knex)("payables").insert({
      id: payable.id,
      company_id: payable.companyId,
      person_id: payable.personId,
      category_id: payable.categoryId,
      cost_center_id: payable.costCenterId ?? null,
      amount: payable.amount.toDecimalString(),
      currency: payable.currency,
      due_date: payable.dueDate,
      competence_date: payable.competenceDate ?? null,
      description: payable.description ?? null,
      document_number: payable.documentNumber ?? null,
      status: payable.status,
      created_at: payable.createdAt,
      updated_at: new Date(),
    });
  }

  async findById(companyId: string, id: string): Promise<Payable | null> {
    const row = await this.knex("payables")
      .where({ id, company_id: companyId })
      .first();

    return row ? toPayable(row as Record<string, unknown>) : null;
  }

  async findByCompany(
    companyId: string,
    filter: PayableFilter = {},
  ): Promise<{ items: Payable[]; total: number }> {
    const base = this.knex("payables").where({ company_id: companyId });

    if (filter.personId) {
      base.andWhere("person_id", filter.personId);
    }
    if (filter.categoryId) {
      base.andWhere("category_id", filter.categoryId);
    }
    if (filter.costCenterId) {
      base.andWhere("cost_center_id", filter.costCenterId);
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
      items: rows.map((row) => toPayable(row as Record<string, unknown>)),
      total: Number(countResult[0]?.count ?? 0),
    };
  }

  /**
   * Guarded by status, exactly as the charge update is: a second settlement of
   * the same payable matches zero rows and rolls its `runAtomic` back instead
   * of writing a second expense transaction.
   */
  async update(payable: Payable, executor?: QueryExecutor): Promise<void> {
    const updated = await (executor ?? this.knex)("payables")
      .where({ id: payable.id, company_id: payable.companyId })
      .whereIn("status", [...UPDATABLE_STATUSES])
      .update({
        category_id: payable.categoryId,
        cost_center_id: payable.costCenterId ?? null,
        amount: payable.amount.toDecimalString(),
        due_date: payable.dueDate,
        description: payable.description ?? null,
        status: payable.status,
        cancel_reason: payable.cancelReason ?? null,
        cancelled_at: payable.cancelledAt ?? null,
        paid_at: payable.paidAt ?? null,
        updated_at: new Date(),
      });

    if (updated !== 1) {
      throw DomainError.create(
        "INVALID_OPERATION",
        `Payable ${payable.id} is no longer in a state that accepts this operation`,
      );
    }
  }

  async findOverdueCandidates(referenceDate: Date): Promise<Payable[]> {
    const rows = await this.knex("payables")
      .where("status", "PENDING")
      .andWhere("due_date", "<", referenceDate)
      .orderBy("due_date", "asc");

    return rows.map((row) => toPayable(row as Record<string, unknown>));
  }

  async hasOpenPayables(companyId: string, personId: string): Promise<number> {
    const result = (await this.knex("payables")
      .where({ company_id: companyId, person_id: personId })
      .whereIn("status", [...UPDATABLE_STATUSES])
      .count<{ count: string }[]>("id as count")) as { count: string }[];

    return Number(result[0]?.count ?? 0);
  }

  async registerPayment(
    payment: PayablePaymentRecord,
    executor?: QueryExecutor,
  ): Promise<void> {
    await (executor ?? this.knex)("payable_payments").insert({
      id: payment.id,
      payable_id: payment.payableId,
      transaction_id: payment.transactionId,
      account_id: payment.accountId,
      amount: payment.amount,
      paid_at: payment.paidAt,
    });
  }

  async isPaymentTransaction(
    companyId: string,
    transactionId: string,
  ): Promise<boolean> {
    const row = await this.knex("payable_payments as p")
      .join("payables as pa", "pa.id", "p.payable_id")
      .where({ "p.transaction_id": transactionId, "pa.company_id": companyId })
      .first();

    return row !== undefined;
  }

  async listPayments(
    companyId: string,
    payableId: string,
  ): Promise<PayablePaymentRecord[]> {
    const rows = await this.knex("payable_payments as p")
      .join("payables as pa", "pa.id", "p.payable_id")
      .where({ "p.payable_id": payableId, "pa.company_id": companyId })
      .orderBy("p.paid_at", "asc")
      .select("p.*");

    return rows.map((row) => toPayment(row as Record<string, unknown>));
  }
}
