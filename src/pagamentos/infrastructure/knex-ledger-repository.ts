import type { Knex } from "knex";
import { Money } from "../../financeiro/domain/money.js";
import { Percent } from "../../financeiro/domain/percent.js";
import { amountsDueFor, daysLate } from "../domain/charge-math.js";
import type {
  CustomerLedger,
  CustomerLedgerEntry,
  LedgerRepository,
  SupplierLedger,
  SupplierLedgerEntry,
} from "./ledger-repository.js";

const OPEN_CHARGE_STATUSES = ["ISSUED", "OVERDUE"] as const;
const OPEN_PAYABLE_STATUSES = ["PENDING", "OVERDUE"] as const;
const DEFAULT_CURRENCY = "BRL";

/**
 * Knex-based implementation of the customer and supplier ledgers.
 *
 * The rows and the settled amounts are aggregated by the database; penalty and
 * interest are computed by `charge-math`, the very functions the domain uses.
 * Reimplementing that arithmetic in SQL would give the system two formulas to
 * keep in step, and the one that drifts is always the copy.
 */
export class KnexLedgerRepository implements LedgerRepository {
  constructor(private readonly knex: Knex) {}

  async customerLedger(
    companyId: string,
    personId: string,
    referenceDate: Date,
  ): Promise<CustomerLedger> {
    const rows = (await this.knex("charges as c")
      .leftJoin("charge_receipts as r", "r.charge_id", "c.id")
      .where({ "c.company_id": companyId, "c.person_id": personId })
      .groupBy("c.id")
      .orderBy("c.due_date", "asc")
      .select(
        "c.id",
        "c.status",
        "c.due_date",
        "c.amount",
        "c.currency",
        "c.penalty_percent",
        "c.monthly_interest_percent",
        "c.created_at",
      )
      .sum({ settled: "r.amount" })
      .max({ settled_at: "r.received_at" })) as Record<string, unknown>[];

    const currency = (rows[0]?.currency as string) ?? DEFAULT_CURRENCY;
    let outstanding = Money.zero(currency);

    const history: CustomerLedgerEntry[] = rows.map((row) => {
      const rowCurrency = row.currency as string;
      const original = Money.fromDecimalString(String(row.amount), rowCurrency);
      const status = row.status as string;
      const dueDate = new Date(row.due_date as string);

      const isOpen = (OPEN_CHARGE_STATUSES as readonly string[]).includes(status);
      const days = isOpen ? daysLate(dueDate, referenceDate) : 0;

      const due = amountsDueFor(
        original,
        Percent.create(Number(row.penalty_percent ?? 0)),
        Percent.create(Number(row.monthly_interest_percent ?? 0)),
        days,
      );

      if (isOpen) {
        outstanding = outstanding.add(due.totalDue);
      }

      return {
        chargeId: row.id as string,
        status,
        dueDate,
        originalAmount: original.toDecimalString(),
        chargesAccrued: due.penalty.add(due.interest).toDecimalString(),
        totalDue: due.totalDue.toDecimalString(),
        settledAmount: Money.fromDecimalString(
          String(row.settled ?? "0"),
          rowCurrency,
        ).toDecimalString(),
        settledAt: row.settled_at
          ? new Date(row.settled_at as string)
          : undefined,
      };
    });

    // "Last charge" is the most recently issued one, not the next to fall due.
    const last = rows.reduce<Record<string, unknown> | undefined>(
      (latest, row) =>
        !latest ||
        new Date(row.created_at as string) >
          new Date(latest.created_at as string)
          ? row
          : latest,
      undefined,
    );

    return {
      personId,
      currency,
      outstandingTotal: outstanding.toDecimalString(),
      lastChargeDate: last ? new Date(last.created_at as string) : undefined,
      lastChargeAmount: last
        ? Money.fromDecimalString(
            String(last.amount),
            last.currency as string,
          ).toDecimalString()
        : undefined,
      history,
    };
  }

  async supplierLedger(
    companyId: string,
    personId: string,
    referenceDate: Date,
  ): Promise<SupplierLedger> {
    const rows = (await this.knex("payables")
      .where({ company_id: companyId, person_id: personId })
      .whereIn("status", [...OPEN_PAYABLE_STATUSES])
      // Overdue first, then by how soon they fall due.
      .orderBy("due_date", "asc")
      .select(
        "id",
        "status",
        "due_date",
        "amount",
        "currency",
        "document_number",
      )) as Record<string, unknown>[];

    const currency = (rows[0]?.currency as string) ?? DEFAULT_CURRENCY;
    let owed = Money.zero(currency);
    let overdue = Money.zero(currency);

    const pending: SupplierLedgerEntry[] = rows.map((row) => {
      const rowCurrency = row.currency as string;
      const amount = Money.fromDecimalString(String(row.amount), rowCurrency);
      const dueDate = new Date(row.due_date as string);

      owed = owed.add(amount);
      // A payable past its due date counts as overdue even if the daily pass
      // has not relabelled it yet.
      if (
        row.status === "OVERDUE" ||
        daysLate(dueDate, referenceDate) > 0
      ) {
        overdue = overdue.add(amount);
      }

      return {
        payableId: row.id as string,
        status: row.status as string,
        dueDate,
        amount: amount.toDecimalString(),
        documentNumber: (row.document_number as string | null) ?? undefined,
      };
    });

    return {
      personId,
      currency,
      owedTotal: owed.toDecimalString(),
      overdueTotal: overdue.toDecimalString(),
      pending,
    };
  }
}
