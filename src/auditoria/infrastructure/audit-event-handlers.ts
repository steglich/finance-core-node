import type { DomainEvent } from "../../shared/domain/domain-event.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import type { Logger } from "../../shared/infrastructure/logger.js";
import { AuditEntry, type AuditOperation } from "../domain/audit-entry.js";
import { DomainEventLog } from "../domain/domain-event-log.js";
import type {
  AuditRepository,
  DomainEventLogRepository,
} from "./audit-repository.js";

/**
 * Every domain event published in Phase 1 by the financeiro context.
 * Identity events are plain objects and do not travel on this bus yet.
 */
export const PHASE_1_EVENT_TYPES = [
  "AccountCreated",
  "AccountInitialBalanceRecorded",
  "AccountCredited",
  "AccountDebited",
  "AccountDeactivated",
  "AccountBalanceMismatchDetected",
  "TransactionRegistered",
  "TransactionPosted",
  "TransactionCancelled",
  "TransactionRefunded",
  "TransactionEdited",
  "InstallmentPaid",
  "InstallmentOverdue",
  "InstallmentDueDateChanged",
  "TransferCompleted",
  "TransferReversed",
  "RecurrenceCreated",
  "RecurrencePaused",
  "RecurrenceResumed",
  "RecurrenceCancelled",
  "RecurrenceCompleted",
  "RecurrenceOccurrenceGenerated",
] as const;

/**
 * Maps an event type to the audited entity type and the operation it represents.
 * Events not listed here are logged as domain events but produce no audit entry.
 */
const AUDITED_EVENTS: Readonly<
  Record<string, { entityType: string; operation: AuditOperation }>
> = {
  AccountCreated: { entityType: "Account", operation: "CREATE" },
  AccountDeactivated: { entityType: "Account", operation: "STATUS_CHANGE" },
  TransactionRegistered: { entityType: "Transaction", operation: "CREATE" },
  TransactionPosted: { entityType: "Transaction", operation: "STATUS_CHANGE" },
  TransactionCancelled: {
    entityType: "Transaction",
    operation: "STATUS_CHANGE",
  },
  TransactionRefunded: {
    entityType: "Transaction",
    operation: "STATUS_CHANGE",
  },
  TransactionEdited: { entityType: "Transaction", operation: "UPDATE" },
  InstallmentPaid: { entityType: "Installment", operation: "STATUS_CHANGE" },
  InstallmentOverdue: { entityType: "Installment", operation: "STATUS_CHANGE" },
  InstallmentDueDateChanged: {
    entityType: "Installment",
    operation: "UPDATE",
  },
  TransferCompleted: { entityType: "Transfer", operation: "CREATE" },
  TransferReversed: { entityType: "Transfer", operation: "STATUS_CHANGE" },
  RecurrenceCreated: { entityType: "Recurrence", operation: "CREATE" },
  RecurrencePaused: { entityType: "Recurrence", operation: "STATUS_CHANGE" },
  RecurrenceResumed: { entityType: "Recurrence", operation: "STATUS_CHANGE" },
  RecurrenceCancelled: { entityType: "Recurrence", operation: "STATUS_CHANGE" },
  RecurrenceCompleted: { entityType: "Recurrence", operation: "STATUS_CHANGE" },
};

/**
 * Field-level change carried by TransactionEdited.
 */
interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

/**
 * Turns an event instance into a serializable payload: every own enumerable
 * property plus the base metadata.
 */
function toPayload(event: DomainEvent<string>): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    aggregateId: event.aggregateId,
    timestamp: event.timestamp.toISOString(),
  };

  for (const [key, value] of Object.entries(event)) {
    if (key.startsWith("_")) continue;
    payload[key] =
      value && typeof value === "object" && "toJSON" in value
        ? (value as { toJSON: () => unknown }).toJSON()
        : value;
  }

  return payload;
}

function companyIdOf(event: DomainEvent<string>): string | undefined {
  const value = (event as unknown as { companyId?: unknown }).companyId;
  return typeof value === "string" ? value : undefined;
}

/**
 * Builds the audit entries for an event: one per changed field when the event
 * carries a diff, otherwise a single entry describing the operation.
 */
function toAuditEntries(event: DomainEvent<string>): AuditEntry[] {
  const mapping = AUDITED_EVENTS[event.getEventType()];
  if (!mapping) {
    return [];
  }

  const companyId = companyIdOf(event);
  const changes = (event as unknown as { changes?: FieldChange[] }).changes;

  if (Array.isArray(changes) && changes.length > 0) {
    return changes.map(
      (change) =>
        new AuditEntry({
          companyId,
          entityType: mapping.entityType,
          entityId: event.aggregateId,
          operation: mapping.operation,
          field: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
        }),
    );
  }

  return [
    new AuditEntry({
      companyId,
      entityType: mapping.entityType,
      entityId: event.aggregateId,
      operation: mapping.operation,
      field: "status",
      newValue: event.getEventType(),
    }),
  ];
}

/**
 * Subscribes the audit handlers to every Phase 1 event.
 *
 * The bus is synchronous, so persistence runs detached; a failure to write the
 * trail is logged and never breaks the request that produced the event.
 */
export function registerAuditHandlers(
  eventBus: DomainEventBus,
  auditRepository: AuditRepository,
  eventLogRepository: DomainEventLogRepository,
  logger: Logger,
): void {
  for (const eventType of PHASE_1_EVENT_TYPES) {
    eventBus.subscribe(eventType, (event: DomainEvent<string>) => {
      const log = new DomainEventLog({
        companyId: companyIdOf(event),
        eventType: event.getEventType(),
        entityId: String(event.aggregateId),
        payload: toPayload(event),
        createdAt: event.timestamp,
      });

      void eventLogRepository.persist(log).catch((error: unknown) => {
        logger.error(
          `Failed to persist domain event ${eventType}: ${String(error)}`,
        );
      });

      const entries = toAuditEntries(event);
      if (entries.length > 0) {
        void auditRepository.append(entries).catch((error: unknown) => {
          logger.error(
            `Failed to persist audit entries for ${eventType}: ${String(error)}`,
          );
        });
      }
    });
  }
}
