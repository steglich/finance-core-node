import type { AggregateRoot } from "./aggregate-root.js";

/**
 * Base class for all domain events.
 * Events are immutable and carry information about something that happened in the domain.
 */
export abstract class DomainEvent<TId = string> {
  private readonly _timestamp: Date;
  private readonly _aggregateId: TId;

  constructor(aggregateId: TId) {
    this._aggregateId = aggregateId;
    this._timestamp = new Date();
  }

  get timestamp(): Date {
    return this._timestamp;
  }

  get aggregateId(): TId {
    return this._aggregateId;
  }

  /**
   * Returns the event type name for event handlers.
   */
  abstract getEventType(): string;
}
