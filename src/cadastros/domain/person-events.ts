import { DomainEvent } from "../../shared/domain/domain-event.js";

/**
 * Raised when a person is registered in a company's registry.
 */
export class PersonRegistered extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly name: string,
    readonly personType: string,
    readonly document: string,
    readonly roles: readonly string[],
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "PersonRegistered";
  }
}

/**
 * Raised when the mutable fields of a person change (RN-09 audit trail).
 */
export class PersonEdited extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly name: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "PersonEdited";
  }
}

/**
 * Raised when a classification is added or removed.
 */
export class PersonRoleChanged extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly role: string,
    readonly operation: "ADDED" | "REMOVED",
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "PersonRoleChanged";
  }
}

/**
 * Raised when a person is deactivated. People are never physically deleted.
 */
export class PersonDeactivated extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "PersonDeactivated";
  }
}
