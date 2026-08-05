import type { AccessLog, AccessEventType } from "../domain/access-log.js";
import type { AuditEntry } from "../domain/audit-entry.js";
import type { DomainEventLog } from "../domain/domain-event-log.js";

/**
 * Filters accepted when querying domain event logs.
 */
export interface DomainEventLogFilter {
  eventType?: string | undefined;
  entityId?: string | undefined;
  userId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * Filters accepted when querying access logs.
 */
export interface AccessLogFilter {
  eventType?: AccessEventType | undefined;
  userId?: string | undefined;
  email?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * Append-only repository for entity change history (RN-09).
 * There is deliberately no update or delete operation.
 */
export interface AuditRepository {
  append(entries: readonly AuditEntry[]): Promise<void>;

  findByEntity(
    companyId: string,
    entityType: string,
    entityId: string,
  ): Promise<AuditEntry[]>;
}

/**
 * Append-only repository for published domain events.
 */
export interface DomainEventLogRepository {
  persist(log: DomainEventLog): Promise<void>;

  findMany(
    companyId: string,
    filter?: DomainEventLogFilter,
  ): Promise<{ items: DomainEventLog[]; total: number }>;
}

/**
 * Repository for authentication events. Access logs are not company-scoped:
 * a failed login happens before any company context exists.
 */
export interface AccessLogRepository {
  append(log: AccessLog): Promise<void>;

  findMany(
    filter?: AccessLogFilter,
  ): Promise<{ items: AccessLog[]; total: number }>;
}
