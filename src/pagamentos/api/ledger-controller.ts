import type { PersonRepository } from "../../cadastros/infrastructure/person-repository.js";
import type { ControllerResult } from "../../shared/api/controller-result.js";
import type { LedgerRepository } from "../infrastructure/ledger-repository.js";

/**
 * Customer and supplier ledgers.
 *
 * Everything served here is derived from the charges and payables themselves —
 * no total is stored on the person, so there is no second source of truth to
 * reconcile.
 */
export class LedgerController {
  constructor(
    private readonly ledgerRepository: LedgerRepository,
    private readonly personRepository: PersonRepository,
  ) {}

  /**
   * GET /api/v1/customers/:personId/ledger
   */
  async customer(
    companyId: string,
    personId: string,
  ): Promise<ControllerResult> {
    const person = await this.personRepository.findById(companyId, personId);
    if (!person) {
      return { statusCode: 404, body: { error: "Customer not found" } };
    }

    if (!person.hasRole("CUSTOMER")) {
      return {
        statusCode: 400,
        body: { error: "Person is not classified as CUSTOMER" },
      };
    }

    const ledger = await this.ledgerRepository.customerLedger(
      companyId,
      personId,
      new Date(),
    );

    return {
      statusCode: 200,
      body: { ...ledger, person: person.toJSON() },
    };
  }

  /**
   * GET /api/v1/suppliers/:personId/ledger
   */
  async supplier(
    companyId: string,
    personId: string,
  ): Promise<ControllerResult> {
    const person = await this.personRepository.findById(companyId, personId);
    if (!person) {
      return { statusCode: 404, body: { error: "Supplier not found" } };
    }

    if (!person.hasRole("SUPPLIER")) {
      return {
        statusCode: 400,
        body: { error: "Person is not classified as SUPPLIER" },
      };
    }

    const ledger = await this.ledgerRepository.supplierLedger(
      companyId,
      personId,
      new Date(),
    );

    return {
      statusCode: 200,
      body: { ...ledger, person: person.toJSON() },
    };
  }
}
