import type { DomainEvent } from "./domain-event.js";

/**
 * Handler function type for domain events.
 */
export type EventHandler<T extends DomainEvent = DomainEvent> = (
  event: T,
) => void;

/**
 * In-process typed event bus for domain events.
 * Allows subscription and publication of events within the same process.
 */
export class DomainEventBus {
  private readonly handlers: Map<string, Set<EventHandler<DomainEvent>>> =
    new Map();

  /**
   * Subscribes a handler to all events of a specific type.
   */
  subscribe<T extends DomainEvent>(
    eventType: string,
    handler: EventHandler<T>,
  ): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      handlers.add(handler as EventHandler<DomainEvent>);
    }
  }

  /**
   * Unsubscribes a handler from a specific event type.
   */
  unsubscribe<T extends DomainEvent>(
    eventType: string,
    handler: EventHandler<T>,
  ): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      handlers.delete(handler as EventHandler<DomainEvent>);
    }
  }

  /**
   * Publishes an event to all subscribed handlers.
   */
  publish<T extends DomainEvent>(event: T): void {
    const eventType = event.getEventType();
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    }
  }

  /**
   * Publishes all events from an aggregate.
   */
  publishMany(events: DomainEvent[]): void {
    for (const event of events) {
      this.publish(event);
    }
  }

  /**
   * Clears all handlers for a specific event type.
   */
  clearHandlers(eventType: string): void {
    this.handlers.delete(eventType);
  }

  /**
   * Clears all handlers from the bus.
   */
  clearAll(): void {
    this.handlers.clear();
  }
}
