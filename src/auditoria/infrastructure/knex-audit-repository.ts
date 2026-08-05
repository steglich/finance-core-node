import type { Knex } from "knex";
import {
  AccessLog,
  type AccessEventType,
} from "../domain/access-log.js";
import { AuditEntry, type AuditOperation } from "../domain/audit-entry.js";
import { DomainEventLog } from "../domain/domain-event-log.js";
import type {
  AccessLogFilter,
  AccessLogRepository,
  AuditRepository,
  DomainEventLogFilter,
  DomainEventLogRepository,
} from "./audit-repository.js";

function toAuditEntry(row: Record<string, unknown>): AuditEntry {
  return new AuditEntry({
    id: row.id as string,
    companyId: (row.company_id as string | null) ?? undefined,
    entityType: row.entity_type as string,
    entityId: row.entity_id as string,
    operation: row.operation as AuditOperation,
    field: (row.field as string | null) ?? undefined,
    oldValue: (row.old_value as string | null) ?? undefined,
    newValue: (row.new_value as string | null) ?? undefined,
    userId: (row.user_id as string | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
  });
}

function toEventLog(row: Record<string, unknown>): DomainEventLog {
  const payload = row.payload;

  return new DomainEventLog({
    id: row.id as string,
    companyId: (row.company_id as string | null) ?? undefined,
    eventType: row.event_type as string,
    entityId: row.entity_id as string,
    payload: typeof payload === "string" ? JSON.parse(payload) : payload,
    userId: (row.user_id as string | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
  });
}

function toAccessLog(row: Record<string, unknown>): AccessLog {
  return new AccessLog({
    id: row.id as string,
    eventType: row.event_type as AccessEventType,
    userId: (row.user_id as string | null) ?? undefined,
    email: (row.email as string | null) ?? "",
    ipAddress: (row.ip_address as string | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
  });
}

/**
 * Applies the shared date/pagination filters to a query.
 */
function applyCommonFilters(
  query: Knex.QueryBuilder,
  filter: { from?: Date | undefined; to?: Date | undefined },
): Knex.QueryBuilder {
  if (filter.from) query.andWhere("created_at", ">=", filter.from);
  if (filter.to) query.andWhere("created_at", "<=", filter.to);
  return query;
}

async function countAndPage<T>(
  base: Knex.QueryBuilder,
  filter: { limit?: number | undefined; offset?: number | undefined },
  map: (row: Record<string, unknown>) => T,
): Promise<{ items: T[]; total: number }> {
  const countResult = (await base
    .clone()
    .clearOrder()
    .count<{ count: string }[]>("id as count")) as { count: string }[];

  const rowsQuery = base.clone().orderBy("created_at", "desc");
  if (filter.limit !== undefined) rowsQuery.limit(filter.limit);
  if (filter.offset !== undefined) rowsQuery.offset(filter.offset);

  const rows = (await rowsQuery) as Record<string, unknown>[];

  return { items: rows.map(map), total: Number(countResult[0]?.count ?? 0) };
}

/**
 * Knex-based, append-only implementation of AuditRepository.
 */
export class KnexAuditRepository implements AuditRepository {
  constructor(private readonly knex: Knex) {}

  async append(entries: readonly AuditEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    await this.knex("audit_entries").insert(
      entries.map((entry) => ({
        id: entry.id,
        company_id: entry.companyId ?? null,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        operation: entry.operation,
        field: entry.field ?? null,
        old_value: entry.oldValue ?? null,
        new_value: entry.newValue ?? null,
        user_id: entry.userId ?? null,
        created_at: entry.createdAt,
      })),
    );
  }

  async findByEntity(
    companyId: string,
    entityType: string,
    entityId: string,
  ): Promise<AuditEntry[]> {
    const rows = (await this.knex("audit_entries")
      .where({
        company_id: companyId,
        entity_type: entityType,
        entity_id: entityId,
      })
      .orderBy("created_at", "asc")) as Record<string, unknown>[];

    return rows.map(toAuditEntry);
  }
}

/**
 * Knex-based, append-only implementation of DomainEventLogRepository.
 */
export class KnexDomainEventLogRepository
  implements DomainEventLogRepository
{
  constructor(private readonly knex: Knex) {}

  async persist(log: DomainEventLog): Promise<void> {
    await this.knex("domain_event_logs").insert({
      id: log.id,
      company_id: log.companyId ?? null,
      event_type: log.eventType,
      entity_id: log.entityId,
      payload: JSON.stringify(log.payload ?? {}),
      user_id: log.userId ?? null,
      created_at: log.createdAt,
    });
  }

  async findMany(
    companyId: string,
    filter: DomainEventLogFilter = {},
  ): Promise<{ items: DomainEventLog[]; total: number }> {
    const base = this.knex("domain_event_logs").where(
      "company_id",
      companyId,
    );

    if (filter.eventType) base.andWhere("event_type", filter.eventType);
    if (filter.entityId) base.andWhere("entity_id", filter.entityId);
    if (filter.userId) base.andWhere("user_id", filter.userId);
    applyCommonFilters(base, filter);

    return countAndPage(base, filter, toEventLog);
  }
}

/**
 * Knex-based implementation of AccessLogRepository.
 */
export class KnexAccessLogRepository implements AccessLogRepository {
  constructor(private readonly knex: Knex) {}

  async append(log: AccessLog): Promise<void> {
    await this.knex("access_logs").insert({
      id: log.id,
      event_type: log.eventType,
      user_id: log.userId ?? null,
      email: log.email,
      ip_address: log.ipAddress ?? null,
      created_at: log.createdAt,
    });
  }

  async findMany(
    filter: AccessLogFilter = {},
  ): Promise<{ items: AccessLog[]; total: number }> {
    const base = this.knex("access_logs");

    if (filter.eventType) base.where("event_type", filter.eventType);
    if (filter.userId) base.andWhere("user_id", filter.userId);
    if (filter.email) base.andWhere("email", filter.email.toLowerCase());
    applyCommonFilters(base, filter);

    return countAndPage(base, filter, toAccessLog);
  }
}
