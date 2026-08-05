import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEvent } from "../../shared/domain/domain-event.js";
import { Result } from "../../shared/domain/result.js";
import type { Invoice } from "./invoice.js";
import { Money } from "./money.js";

/**
 * Input for closing the invoice of a finished cycle.
 */
export interface CloseInvoiceInput {
  invoice: Invoice;
  /** Net amounts of the confirmed purchases of the cycle. */
  purchases: readonly { transactionId: string; netAmount: Money }[];
  closedBy?: string | undefined;
}

/**
 * Outcome of a closing: the invoice already transitioned, plus the events for
 * the caller to publish after persisting.
 */
export interface CloseInvoiceResult {
  invoice: Invoice;
  total: Money;
  transactionIds: readonly string[];
  events: readonly DomainEvent<string>[];
}

/**
 * Domain service that consolidates a cycle's purchases into the invoice total
 * and closes it (the `FechamentoFaturaService` of the conceptual model).
 *
 * Idempotency comes from the state machine, not from a control table: closing is
 * only accepted from OPEN, so a second scheduler pass over the same cycle fails
 * harmlessly and publishes nothing.
 */
export class InvoiceClosingService {
  close(input: CloseInvoiceInput): Result<CloseInvoiceResult> {
    const { invoice } = input;

    if (!invoice.isOpen) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `Invoice ${invoice.id} is ${invoice.status} and cannot be closed again`,
        ),
      );
    }

    let total: Money;
    try {
      total = Money.sum(
        invoice.currency,
        input.purchases.map((purchase) => purchase.netAmount),
      );
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }

    const transactionIds = input.purchases.map(
      (purchase) => purchase.transactionId,
    );

    const closed = invoice.close(total, transactionIds, input.closedBy);
    if (closed.isFailure) {
      return Result.failed(
        closed.error ??
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            "Could not close the invoice",
          ),
      );
    }

    return Result.success({
      invoice,
      total,
      transactionIds,
      events: invoice.events,
    });
  }
}
