import { randomUUID } from "node:crypto";
import { Entity } from "../../shared/domain/entity.js";
import { DomainError } from "../../shared/domain/domain-error.js";

/**
 * Authentication events worth recording.
 */
export type AccessEventType =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "PASSWORD_CHANGE";

const ACCESS_EVENT_TYPES: ReadonlySet<string> = new Set<AccessEventType>([
  "LOGIN_SUCCESS",
  "LOGIN_FAILED",
  "LOGOUT",
  "PASSWORD_CHANGE",
]);

/**
 * Constructor properties for an access log record.
 */
export interface AccessLogProps {
  id?: string;
  eventType: AccessEventType;
  userId?: string | undefined;
  email: string;
  ipAddress?: string | undefined;
  createdAt?: Date;
}

/**
 * Authentication event record. Append-only and immutable.
 */
export class AccessLog extends Entity<string> {
  private readonly _eventType: AccessEventType;
  private readonly _userId: string | undefined;
  private readonly _email: string;
  private readonly _ipAddress: string | undefined;

  constructor(props: AccessLogProps) {
    super(props.id ?? randomUUID(), props.createdAt);

    if (!ACCESS_EVENT_TYPES.has(props.eventType)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid access event type: ${props.eventType}`,
      );
    }

    const email = props.email.trim().toLowerCase();
    if (email.length === 0) {
      throw DomainError.create("VALIDATION_ERROR", "email is required");
    }

    this._eventType = props.eventType;
    this._userId = props.userId;
    this._email = email;
    this._ipAddress = props.ipAddress;
  }

  get eventType(): AccessEventType {
    return this._eventType;
  }

  get userId(): string | undefined {
    return this._userId;
  }

  get email(): string {
    return this._email;
  }

  get ipAddress(): string | undefined {
    return this._ipAddress;
  }

  toJSON(): unknown {
    return {
      id: this.id,
      eventType: this._eventType,
      userId: this._userId,
      email: this._email,
      ipAddress: this._ipAddress,
      createdAt: this.createdAt,
    };
  }
}
