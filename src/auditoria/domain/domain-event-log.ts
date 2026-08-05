import { randomUUID } from "node:crypto";
import { Entity } from "../../shared/domain/entity.js";
import { DomainError } from "../../shared/domain/domain-error.js";

/**
 * Constructor properties for a domain event log record.
 */
export interface DomainEventLogProps {
  id?: string;
  companyId?: string | undefined;
  eventType: string;
  entityId: string;
  payload: unknown;
  userId?: string | undefined;
  createdAt?: Date;
}

/**
 * Persisted copy of a published domain event. Append-only and immutable.
 */
export class DomainEventLog extends Entity<string> {
  private readonly _companyId: string | undefined;
  private readonly _eventType: string;
  private readonly _entityId: string;
  private readonly _payload: unknown;
  private readonly _userId: string | undefined;

  constructor(props: DomainEventLogProps) {
    super(props.id ?? randomUUID(), props.createdAt);

    const eventType = props.eventType.trim();

    if (eventType.length === 0) {
      throw DomainError.create("VALIDATION_ERROR", "eventType is required");
    }

    if (props.entityId.trim().length === 0) {
      throw DomainError.create("VALIDATION_ERROR", "entityId is required");
    }

    this._companyId = props.companyId;
    this._eventType = eventType;
    this._entityId = props.entityId;
    this._payload = props.payload ?? {};
    this._userId = props.userId;
  }

  get companyId(): string | undefined {
    return this._companyId;
  }

  get eventType(): string {
    return this._eventType;
  }

  get entityId(): string {
    return this._entityId;
  }

  get payload(): unknown {
    return this._payload;
  }

  get userId(): string | undefined {
    return this._userId;
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this._companyId,
      eventType: this._eventType,
      entityId: this._entityId,
      payload: this._payload,
      userId: this._userId,
      createdAt: this.createdAt,
    };
  }
}
