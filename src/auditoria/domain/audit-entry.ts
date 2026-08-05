import { randomUUID } from "node:crypto";
import { Entity } from "../../shared/domain/entity.js";
import { DomainError } from "../../shared/domain/domain-error.js";

/**
 * Operation that produced an audit entry.
 */
export type AuditOperation = "CREATE" | "UPDATE" | "DELETE" | "STATUS_CHANGE";

/**
 * Constructor properties for an audit entry.
 */
export interface AuditEntryProps {
  id?: string;
  companyId?: string | undefined;
  entityType: string;
  entityId: string;
  operation: AuditOperation;
  field?: string | undefined;
  oldValue?: unknown;
  newValue?: unknown;
  userId?: string | undefined;
  createdAt?: Date;
}

const OPERATIONS: ReadonlySet<string> = new Set<AuditOperation>([
  "CREATE",
  "UPDATE",
  "DELETE",
  "STATUS_CHANGE",
]);

/**
 * Serializes a value for storage as text, keeping `undefined` distinguishable
 * from a stored empty string.
 */
function serialize(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * A single recorded change to an entity (RN-09).
 *
 * Entries are append-only: there is no setter and no update operation — once
 * created, an entry is immutable.
 */
export class AuditEntry extends Entity<string> {
  private readonly _companyId: string | undefined;
  private readonly _entityType: string;
  private readonly _entityId: string;
  private readonly _operation: AuditOperation;
  private readonly _field: string | undefined;
  private readonly _oldValue: string | undefined;
  private readonly _newValue: string | undefined;
  private readonly _userId: string | undefined;

  constructor(props: AuditEntryProps) {
    super(props.id ?? randomUUID(), props.createdAt);

    const entityType = props.entityType.trim();

    if (entityType.length === 0) {
      throw DomainError.create("VALIDATION_ERROR", "entityType is required");
    }

    if (props.entityId.trim().length === 0) {
      throw DomainError.create("VALIDATION_ERROR", "entityId is required");
    }

    if (!OPERATIONS.has(props.operation)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid audit operation: ${props.operation}`,
      );
    }

    this._companyId = props.companyId;
    this._entityType = entityType;
    this._entityId = props.entityId;
    this._operation = props.operation;
    this._field = props.field;
    this._oldValue = serialize(props.oldValue);
    this._newValue = serialize(props.newValue);
    this._userId = props.userId;
  }

  get companyId(): string | undefined {
    return this._companyId;
  }

  get entityType(): string {
    return this._entityType;
  }

  get entityId(): string {
    return this._entityId;
  }

  get operation(): AuditOperation {
    return this._operation;
  }

  get field(): string | undefined {
    return this._field;
  }

  get oldValue(): string | undefined {
    return this._oldValue;
  }

  get newValue(): string | undefined {
    return this._newValue;
  }

  get userId(): string | undefined {
    return this._userId;
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this._companyId,
      entityType: this._entityType,
      entityId: this._entityId,
      operation: this._operation,
      field: this._field,
      oldValue: this._oldValue,
      newValue: this._newValue,
      userId: this._userId,
      createdAt: this.createdAt,
    };
  }
}
