import { DomainEvent } from "../../shared/domain/domain-event.js";

/**
 * Raised when a recurrence configuration is created.
 */
export class RecurrenceCreated extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly accountId: string,
    readonly periodicity: string,
    readonly startDate: Date,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "RecurrenceCreated";
  }
}

/**
 * Raised when a recurrence is paused; generation stops until it is resumed.
 */
export class RecurrencePaused extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "RecurrencePaused";
  }
}

/**
 * Raised when a paused recurrence is resumed.
 */
export class RecurrenceResumed extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "RecurrenceResumed";
  }
}

/**
 * Raised when a recurrence is cancelled; already generated transactions stay.
 */
export class RecurrenceCancelled extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly generatedCount: number,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "RecurrenceCancelled";
  }
}

/**
 * Raised when a recurrence reaches its end date or maximum occurrences.
 */
export class RecurrenceCompleted extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly generatedCount: number,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "RecurrenceCompleted";
  }
}

/**
 * Raised when a recurrence generates an occurrence for a given date.
 */
export class RecurrenceOccurrenceGenerated extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly occurrenceNumber: number,
    readonly occurrenceDate: Date,
    readonly transactionId: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "RecurrenceOccurrenceGenerated";
  }
}
