import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import type { Card } from "./card.js";
import { Invoice } from "./invoice.js";

/**
 * Input for assigning a credit card purchase to the invoice of its cycle.
 */
export interface AssignPurchaseInput {
  companyId: string;
  card: Card;
  purchaseDate: Date;
  /**
   * Invoices the card already has. The service picks the one whose cycle covers
   * the purchase date and opens a new one only when none does.
   */
  existingInvoices: readonly Invoice[];
}

/**
 * Outcome of the assignment: the invoice the purchase belongs to and whether it
 * had to be opened.
 */
export interface AssignPurchaseResult {
  invoice: Invoice;
  created: boolean;
}

/**
 * Domain service that binds a purchase to exactly one invoice.
 *
 * A purchase made after the closing date belongs to the next cycle, never to
 * the invoice that just closed — the cycle each invoice covers is decided by
 * the dates it materialized when it was opened.
 */
export class InvoiceAssignmentService {
  assign(input: AssignPurchaseInput): Result<AssignPurchaseResult> {
    const { card, purchaseDate } = input;

    if (!card.isActive) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "Inactive cards do not accept new purchases",
        ),
      );
    }

    if (card.companyId !== input.companyId) {
      return Result.failed(
        DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "The card belongs to a different company",
        ),
      );
    }

    if (!card.isCredit) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "Only credit card purchases are consolidated into invoices",
        ),
      );
    }

    const existing = input.existingInvoices.find(
      (invoice) => invoice.isOpen && invoice.covers(purchaseDate),
    );

    if (existing) {
      return Result.success({ invoice: existing, created: false });
    }

    const opened = Invoice.open({
      companyId: input.companyId,
      card,
      purchaseDate,
    });

    if (opened.isFailure || !opened.value) {
      return Result.failed(
        opened.error ??
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            "Could not open the invoice for the cycle",
          ),
      );
    }

    return Result.success({ invoice: opened.value, created: true });
  }
}
