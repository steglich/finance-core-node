import type { DomainEvent } from "./domain-event.js";

/**
 * Base class for all domain entities.
 * Uses a generic ID type and provides equality checks based on ID.
 */
export abstract class Entity<TId> {
  private readonly _id: TId;
  private readonly _createdAt: Date;
  private _updatedAt: Date | null = null;

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
   * Checks equality based on entity ID.
   */
  equals(other: Entity<TId>): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    return this._id === other._id;
  }
}
