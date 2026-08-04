import type { DomainEvent } from "./domain-event.js";

/**
 * Base class for aggregate roots.
 * Aggregates are responsible for ensuring consistency within their boundaries.
 */
export abstract class AggregateRoot<TId> {
  private readonly _id: TId;
  private readonly _createdAt: Date;
  private _updatedAt: Date | null = null;
  private readonly _events: DomainEvent<TId>[] = [];

  constructor(id: TId, createdAt?: Date) {
    this._id = id;
    this._createdAt = createdAt ?? new Date();
  }

  get id(): TId {
    return this._id;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date | null {
    return this._updatedAt;
  }

  protected setUpdatedAt(): void {
    this._updatedAt = new Date();
  }

  /**
   * Returns a copy of the events raised by this aggregate.
   */
  get events(): DomainEvent<TId>[] {
    return [...this._events];
  }

  /**
   * Raises a domain event and adds it to the event queue.
   */
  protected raiseEvent(event: DomainEvent<TId>): void {
    this._events.push(event);
  }

  /**
   * Clears all pending events. Called after events are published.
   */
  clearEvents(): void {
    this._events.length = 0;
  }

  /**
   * Checks equality based on aggregate ID.
   */
  equals(other: AggregateRoot<TId>): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    return this._id === other._id;
  }
}
