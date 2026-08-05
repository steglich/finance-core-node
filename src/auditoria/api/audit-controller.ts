import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { AccessEventType } from "../domain/access-log.js";
import type {
  AccessLogRepository,
  AuditRepository,
  DomainEventLogRepository,
} from "../infrastructure/audit-repository.js";

/**
 * Query filters shared by the audit endpoints, parsed from the query string.
 */
interface ParsedQuery {
  eventType?: string | undefined;
  entityId?: string | undefined;
  userId?: string | undefined;
  email?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

function parseQuery(query: unknown): ParsedQuery | DomainError {
  const q =
    typeof query === "object" && query !== null
      ? (query as Record<string, unknown>)
      : {};

  const parsed: ParsedQuery = {};

  for (const field of ["eventType", "entityId", "userId", "email"] as const) {
    const value = q[field];
    if (value !== undefined && typeof value !== "string") {
      return DomainError.create("VALIDATION_ERROR", `${field} must be a string`);
    }
    parsed[field] = value?.trim() || undefined;
  }

  for (const field of ["from", "to"] as const) {
    const value = q[field];
    if (value === undefined || value === "") continue;
    if (typeof value !== "string") {
      return DomainError.create(
        "VALIDATION_ERROR",
        `${field} must be an ISO date`,
      );
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return DomainError.create(
        "VALIDATION_ERROR",
        `${field} must be an ISO date`,
      );
    }
    parsed[field] = date;
  }

  for (const field of ["limit", "offset"] as const) {
    const value = q[field];
    if (value === undefined || value === "") continue;
    const parsedNumber = Number(value);
    if (!Number.isInteger(parsedNumber) || parsedNumber < 0) {
      return DomainError.create(
        "VALIDATION_ERROR",
        `${field} must be a non-negative integer`,
      );
    }
    parsed[field] = field === "limit" ? Math.min(parsedNumber, 200) : parsedNumber;
  }

  return parsed;
}

/**
 * Read-only audit endpoints. The trail itself is append-only: nothing here
 * writes, updates or deletes records.
 */
export class AuditController {
  constructor(
    private readonly auditRepository: AuditRepository,
    private readonly eventLogRepository: DomainEventLogRepository,
    private readonly accessLogRepository: AccessLogRepository,
  ) {}

  /**
   * GET /api/v1/audit/entities/:entityType/:entityId
   */
  async entityHistory(
    companyId: string,
    entityType: string,
    entityId: string,
  ): Promise<ControllerResult> {
    const entries = await this.auditRepository.findByEntity(
      companyId,
      entityType,
      entityId,
    );

    return {
      statusCode: 200,
      body: {
        entityType,
        entityId,
        history: entries.map((entry) => entry.toJSON()),
      },
    };
  }

  /**
   * GET /api/v1/audit/events
   */
  async events(companyId: string, query: unknown): Promise<ControllerResult> {
    const parsed = parseQuery(query);
    if (parsed instanceof DomainError) {
      return { statusCode: 400, body: { error: parsed.message } };
    }

    const { items, total } = await this.eventLogRepository.findMany(companyId, {
      eventType: parsed.eventType,
      entityId: parsed.entityId,
      userId: parsed.userId,
      from: parsed.from,
      to: parsed.to,
      limit: parsed.limit,
      offset: parsed.offset,
    });

    return {
      statusCode: 200,
      body: { events: items.map((event) => event.toJSON()), total },
    };
  }

  /**
   * GET /api/v1/audit/access-logs — authentication events are not
   * company-scoped, so the route restricts this endpoint to administrators.
   */
  async accessLogs(query: unknown): Promise<ControllerResult> {
    const parsed = parseQuery(query);
    if (parsed instanceof DomainError) {
      return { statusCode: 400, body: { error: parsed.message } };
    }

    const { items, total } = await this.accessLogRepository.findMany({
      eventType: parsed.eventType as AccessEventType | undefined,
      userId: parsed.userId,
      email: parsed.email,
      from: parsed.from,
      to: parsed.to,
      limit: parsed.limit,
      offset: parsed.offset,
    });

    return {
      statusCode: 200,
      body: { accessLogs: items.map((log) => log.toJSON()), total },
    };
  }
}
