import { DomainEvent } from "../../shared/domain/domain-event.js";

/**
 * Raised when a cost center is created.
 */
export class CostCenterCreated extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly name: string,
    readonly parentId: string | undefined,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "CostCenterCreated";
  }
}

/**
 * Raised when the name, description or parent of a cost center changes.
 */
export class CostCenterEdited extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly name: string,
    readonly parentId: string | undefined,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "CostCenterEdited";
  }
}

/**
 * Raised for every node the deactivation cascade touches — the parent and each
 * descendant produce their own entry, so the audit trail shows the whole reach
 * of the operation.
 */
export class CostCenterDeactivated extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly name: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "CostCenterDeactivated";
  }
}
