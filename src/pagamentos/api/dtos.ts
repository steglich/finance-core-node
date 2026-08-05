import { DomainError } from "../../shared/domain/domain-error.js";
import type { ChargeStatus } from "../domain/charge.js";
import type { PayableStatus } from "../domain/payable.js";
import type { PixDirection } from "../infrastructure/pix-repository.js";

/**
 * Result type for API validation, mirroring the other contexts.
 */
export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: DomainError };

const INVALID = Symbol("invalid");

function invalid<T>(message: string): ApiResult<T> {
  return {
    success: false,
    error: DomainError.create("VALIDATION_ERROR", message),
  };
}

function asObject(body: unknown): Record<string, unknown> | undefined {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : undefined;
}

function requiredString(
  source: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = source[field];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function optionalString(
  source: Record<string, unknown>,
  field: string,
): string | null | undefined | typeof INVALID {
  const value = source[field];
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" ? value.trim() : INVALID;
}

function requiredNumber(
  source: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = source[field];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalNumber(
  source: Record<string, unknown>,
  field: string,
): number | undefined | typeof INVALID {
  const value = source[field];
  if (value === undefined || value === null) return undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : INVALID;
}

/**
 * Parses an ISO date (YYYY-MM-DD or full ISO 8601).
 */
function parseDate(value: unknown): Date | undefined | typeof INVALID {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return INVALID;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? INVALID : date;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

const CHARGE_STATUSES = ["ISSUED", "OVERDUE", "PAID", "CANCELLED"] as const;
const PAYABLE_STATUSES = ["PENDING", "OVERDUE", "PAID", "CANCELLED"] as const;
const PIX_DIRECTIONS = ["SENT", "RECEIVED"] as const;

/* -------------------------------------------------------------------------- */
/* Charges                                                                     */
/* -------------------------------------------------------------------------- */

export interface IssueChargeRequest {
  personId: string;
  amount: number;
  dueDate: Date;
  issueDate?: Date | undefined;
  description?: string | undefined;
  penaltyPercent?: number | undefined;
  monthlyInterestPercent?: number | undefined;
}

export function validateIssueChargeRequest(
  body: unknown,
): ApiResult<IssueChargeRequest> {
  const source = asObject(body);
  if (!source) return invalid("Request body must be an object");

  const personId = requiredString(source, "personId");
  if (!personId) return invalid("personId is required");

  const amount = requiredNumber(source, "amount");
  if (amount === undefined) return invalid("amount is required");

  const dueDate = parseDate(source.dueDate);
  if (dueDate === undefined || dueDate === INVALID) {
    return invalid("dueDate is required and must be a valid date");
  }

  const issueDate = parseDate(source.issueDate);
  if (issueDate === INVALID) return invalid("issueDate must be a valid date");

  const description = optionalString(source, "description");
  if (description === INVALID) return invalid("description must be a string");

  const penaltyPercent = optionalNumber(source, "penaltyPercent");
  if (penaltyPercent === INVALID) {
    return invalid("penaltyPercent must be a number");
  }

  const monthlyInterestPercent = optionalNumber(
    source,
    "monthlyInterestPercent",
  );
  if (monthlyInterestPercent === INVALID) {
    return invalid("monthlyInterestPercent must be a number");
  }

  return {
    success: true,
    data: {
      personId,
      amount,
      dueDate,
      issueDate,
      description: description ?? undefined,
      penaltyPercent,
      monthlyInterestPercent,
    },
  };
}

export interface UpdateChargeRequest {
  amount?: number | undefined;
  dueDate?: Date | undefined;
  description?: string | null | undefined;
  penaltyPercent?: number | undefined;
  monthlyInterestPercent?: number | undefined;
}

export function validateUpdateChargeRequest(
  body: unknown,
): ApiResult<UpdateChargeRequest> {
  const source = asObject(body);
  if (!source) return invalid("Request body must be an object");

  const request: UpdateChargeRequest = {};

  const amount = optionalNumber(source, "amount");
  if (amount === INVALID) return invalid("amount must be a number");
  if (amount !== undefined) request.amount = amount;

  const dueDate = parseDate(source.dueDate);
  if (dueDate === INVALID) return invalid("dueDate must be a valid date");
  if (dueDate !== undefined) request.dueDate = dueDate;

  const description = optionalString(source, "description");
  if (description === INVALID) return invalid("description must be a string");
  if (description !== undefined) request.description = description;

  const penaltyPercent = optionalNumber(source, "penaltyPercent");
  if (penaltyPercent === INVALID) {
    return invalid("penaltyPercent must be a number");
  }
  if (penaltyPercent !== undefined) request.penaltyPercent = penaltyPercent;

  const monthlyInterestPercent = optionalNumber(
    source,
    "monthlyInterestPercent",
  );
  if (monthlyInterestPercent === INVALID) {
    return invalid("monthlyInterestPercent must be a number");
  }
  if (monthlyInterestPercent !== undefined) {
    request.monthlyInterestPercent = monthlyInterestPercent;
  }

  if (Object.keys(request).length === 0) {
    return invalid("No editable field was provided");
  }

  return { success: true, data: request };
}

export interface ChargeReceiptRequest {
  accountId: string;
  amount: number;
  /** Required: the total due is a function of this date. */
  receivedAt: Date;
  categoryId?: string | undefined;
  costCenterId?: string | undefined;
  description?: string | undefined;
}

export function validateChargeReceiptRequest(
  body: unknown,
): ApiResult<ChargeReceiptRequest> {
  const source = asObject(body);
  if (!source) return invalid("Request body must be an object");

  const accountId = requiredString(source, "accountId");
  if (!accountId) return invalid("accountId is required");

  const amount = requiredNumber(source, "amount");
  if (amount === undefined) return invalid("amount is required");

  // Not defaulted to "now": penalty and interest depend on it, so the caller
  // must state the date the money actually arrived.
  const receivedAt = parseDate(source.receivedAt);
  if (receivedAt === undefined || receivedAt === INVALID) {
    return invalid("receivedAt is required and must be a valid date");
  }

  const categoryId = optionalString(source, "categoryId");
  if (categoryId === INVALID) return invalid("categoryId must be a string");

  const costCenterId = optionalString(source, "costCenterId");
  if (costCenterId === INVALID) return invalid("costCenterId must be a string");

  const description = optionalString(source, "description");
  if (description === INVALID) return invalid("description must be a string");

  return {
    success: true,
    data: {
      accountId,
      amount,
      receivedAt,
      categoryId: categoryId || undefined,
      costCenterId: costCenterId || undefined,
      description: description ?? undefined,
    },
  };
}

export interface CancelRequest {
  reason: string;
}

export function validateCancelRequest(body: unknown): ApiResult<CancelRequest> {
  const source = asObject(body);
  if (!source) return invalid("Request body must be an object");

  const reason = requiredString(source, "reason");
  if (!reason) return invalid("reason is required");

  return { success: true, data: { reason } };
}

export interface ListChargesQuery {
  personId?: string | undefined;
  status?: ChargeStatus | undefined;
  dueFrom?: Date | undefined;
  dueTo?: Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export function validateListChargesQuery(
  query: unknown,
): ApiResult<ListChargesQuery> {
  const source = asObject(query) ?? {};
  const request: ListChargesQuery = {};

  if (source.personId !== undefined) {
    const personId = requiredString(source, "personId");
    if (!personId) return invalid("personId must be a non-empty string");
    request.personId = personId;
  }

  if (source.status !== undefined) {
    const status = oneOf(source.status, CHARGE_STATUSES);
    if (!status) {
      return invalid(`status must be one of ${CHARGE_STATUSES.join(", ")}`);
    }
    request.status = status;
  }

  const dueFrom = parseDate(source.dueFrom);
  if (dueFrom === INVALID) return invalid("dueFrom must be a valid date");
  if (dueFrom !== undefined) request.dueFrom = dueFrom;

  const dueTo = parseDate(source.dueTo);
  if (dueTo === INVALID) return invalid("dueTo must be a valid date");
  if (dueTo !== undefined) request.dueTo = dueTo;

  const pagination = parsePagination(source);
  if (!pagination.success) return pagination;
  request.limit = pagination.data.limit;
  request.offset = pagination.data.offset;

  return { success: true, data: request };
}

/* -------------------------------------------------------------------------- */
/* Payables                                                                    */
/* -------------------------------------------------------------------------- */

export interface RegisterPayableRequest {
  personId: string;
  categoryId: string;
  costCenterId?: string | undefined;
  amount: number;
  dueDate: Date;
  competenceDate?: Date | undefined;
  description?: string | undefined;
  documentNumber?: string | undefined;
}

export function validateRegisterPayableRequest(
  body: unknown,
): ApiResult<RegisterPayableRequest> {
  const source = asObject(body);
  if (!source) return invalid("Request body must be an object");

  const personId = requiredString(source, "personId");
  if (!personId) return invalid("personId is required");

  const categoryId = requiredString(source, "categoryId");
  if (!categoryId) return invalid("categoryId is required");

  const amount = requiredNumber(source, "amount");
  if (amount === undefined) return invalid("amount is required");

  const dueDate = parseDate(source.dueDate);
  if (dueDate === undefined || dueDate === INVALID) {
    return invalid("dueDate is required and must be a valid date");
  }

  const competenceDate = parseDate(source.competenceDate);
  if (competenceDate === INVALID) {
    return invalid("competenceDate must be a valid date");
  }

  const costCenterId = optionalString(source, "costCenterId");
  if (costCenterId === INVALID) return invalid("costCenterId must be a string");

  const description = optionalString(source, "description");
  if (description === INVALID) return invalid("description must be a string");

  const documentNumber = optionalString(source, "documentNumber");
  if (documentNumber === INVALID) {
    return invalid("documentNumber must be a string");
  }

  return {
    success: true,
    data: {
      personId,
      categoryId,
      costCenterId: costCenterId || undefined,
      amount,
      dueDate,
      competenceDate,
      description: description ?? undefined,
      documentNumber: documentNumber ?? undefined,
    },
  };
}

export interface UpdatePayableRequest {
  amount?: number | undefined;
  dueDate?: Date | undefined;
  categoryId?: string | undefined;
  costCenterId?: string | null | undefined;
  description?: string | null | undefined;
}

export function validateUpdatePayableRequest(
  body: unknown,
): ApiResult<UpdatePayableRequest> {
  const source = asObject(body);
  if (!source) return invalid("Request body must be an object");

  const request: UpdatePayableRequest = {};

  const amount = optionalNumber(source, "amount");
  if (amount === INVALID) return invalid("amount must be a number");
  if (amount !== undefined) request.amount = amount;

  const dueDate = parseDate(source.dueDate);
  if (dueDate === INVALID) return invalid("dueDate must be a valid date");
  if (dueDate !== undefined) request.dueDate = dueDate;

  if (source.categoryId !== undefined) {
    const categoryId = requiredString(source, "categoryId");
    if (!categoryId) return invalid("categoryId cannot be empty");
    request.categoryId = categoryId;
  }

  const costCenterId = optionalString(source, "costCenterId");
  if (costCenterId === INVALID) return invalid("costCenterId must be a string");
  if (costCenterId !== undefined) request.costCenterId = costCenterId;

  const description = optionalString(source, "description");
  if (description === INVALID) return invalid("description must be a string");
  if (description !== undefined) request.description = description;

  if (Object.keys(request).length === 0) {
    return invalid("No editable field was provided");
  }

  return { success: true, data: request };
}

export interface PayablePaymentRequest {
  accountId: string;
  amount: number;
  paidAt: Date;
  description?: string | undefined;
}

export function validatePayablePaymentRequest(
  body: unknown,
): ApiResult<PayablePaymentRequest> {
  const source = asObject(body);
  if (!source) return invalid("Request body must be an object");

  const accountId = requiredString(source, "accountId");
  if (!accountId) return invalid("accountId is required");

  const amount = requiredNumber(source, "amount");
  if (amount === undefined) return invalid("amount is required");

  const paidAt = parseDate(source.paidAt);
  if (paidAt === undefined || paidAt === INVALID) {
    return invalid("paidAt is required and must be a valid date");
  }

  const description = optionalString(source, "description");
  if (description === INVALID) return invalid("description must be a string");

  return {
    success: true,
    data: {
      accountId,
      amount,
      paidAt,
      description: description ?? undefined,
    },
  };
}

export interface ListPayablesQuery {
  personId?: string | undefined;
  categoryId?: string | undefined;
  costCenterId?: string | undefined;
  status?: PayableStatus | undefined;
  dueFrom?: Date | undefined;
  dueTo?: Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export function validateListPayablesQuery(
  query: unknown,
): ApiResult<ListPayablesQuery> {
  const source = asObject(query) ?? {};
  const request: ListPayablesQuery = {};

  for (const field of ["personId", "categoryId", "costCenterId"] as const) {
    if (source[field] !== undefined) {
      const value = requiredString(source, field);
      if (!value) return invalid(`${field} must be a non-empty string`);
      request[field] = value;
    }
  }

  if (source.status !== undefined) {
    const status = oneOf(source.status, PAYABLE_STATUSES);
    if (!status) {
      return invalid(`status must be one of ${PAYABLE_STATUSES.join(", ")}`);
    }
    request.status = status;
  }

  const dueFrom = parseDate(source.dueFrom);
  if (dueFrom === INVALID) return invalid("dueFrom must be a valid date");
  if (dueFrom !== undefined) request.dueFrom = dueFrom;

  const dueTo = parseDate(source.dueTo);
  if (dueTo === INVALID) return invalid("dueTo must be a valid date");
  if (dueTo !== undefined) request.dueTo = dueTo;

  const pagination = parsePagination(source);
  if (!pagination.success) return pagination;
  request.limit = pagination.data.limit;
  request.offset = pagination.data.offset;

  return { success: true, data: request };
}

/* -------------------------------------------------------------------------- */
/* PIX                                                                         */
/* -------------------------------------------------------------------------- */

export interface SendPixRequest {
  accountId: string;
  /** Absent when the caller selected a payee's registered bank detail instead. */
  pixKey?: string | undefined;
  amount: number;
  occurredAt: Date;
  personId?: string | undefined;
  bankAccountId?: string | undefined;
  categoryId?: string | undefined;
  costCenterId?: string | undefined;
  description?: string | undefined;
}

export function validateSendPixRequest(
  body: unknown,
): ApiResult<SendPixRequest> {
  const source = asObject(body);
  if (!source) return invalid("Request body must be an object");

  const accountId = requiredString(source, "accountId");
  if (!accountId) return invalid("accountId is required");

  const pixKey = optionalString(source, "pixKey");
  if (pixKey === INVALID) return invalid("pixKey must be a string");

  const amount = requiredNumber(source, "amount");
  if (amount === undefined) return invalid("amount is required");

  const occurredAt = parseDate(source.occurredAt);
  if (occurredAt === undefined || occurredAt === INVALID) {
    return invalid("occurredAt is required and must be a valid date");
  }

  const optional: Record<string, string | undefined> = {};
  for (const field of [
    "personId",
    "bankAccountId",
    "categoryId",
    "costCenterId",
    "description",
  ] as const) {
    const value = optionalString(source, field);
    if (value === INVALID) return invalid(`${field} must be a string`);
    optional[field] = value || undefined;
  }

  // One of the two ways of naming the destination must be there.
  if (!pixKey && !optional.bankAccountId) {
    return invalid("Either pixKey or bankAccountId is required");
  }

  return {
    success: true,
    data: {
      accountId,
      pixKey: pixKey || undefined,
      amount,
      occurredAt,
      personId: optional.personId,
      bankAccountId: optional.bankAccountId,
      categoryId: optional.categoryId,
      costCenterId: optional.costCenterId,
      description: optional.description,
    },
  };
}

export interface ReceivePixRequest {
  accountId: string;
  pixKey: string;
  amount: number;
  occurredAt: Date;
  /** When present, the receipt settles this charge instead of standing alone. */
  chargeId?: string | undefined;
  personId?: string | undefined;
  categoryId?: string | undefined;
  costCenterId?: string | undefined;
  description?: string | undefined;
}

export function validateReceivePixRequest(
  body: unknown,
): ApiResult<ReceivePixRequest> {
  const source = asObject(body);
  if (!source) return invalid("Request body must be an object");

  const accountId = requiredString(source, "accountId");
  if (!accountId) return invalid("accountId is required");

  const pixKey = requiredString(source, "pixKey");
  if (!pixKey) return invalid("pixKey is required");

  const amount = requiredNumber(source, "amount");
  if (amount === undefined) return invalid("amount is required");

  const occurredAt = parseDate(source.occurredAt);
  if (occurredAt === undefined || occurredAt === INVALID) {
    return invalid("occurredAt is required and must be a valid date");
  }

  const optional: Record<string, string | undefined> = {};
  for (const field of [
    "chargeId",
    "personId",
    "categoryId",
    "costCenterId",
    "description",
  ] as const) {
    const value = optionalString(source, field);
    if (value === INVALID) return invalid(`${field} must be a string`);
    optional[field] = value || undefined;
  }

  return {
    success: true,
    data: {
      accountId,
      pixKey,
      amount,
      occurredAt,
      chargeId: optional.chargeId,
      personId: optional.personId,
      categoryId: optional.categoryId,
      costCenterId: optional.costCenterId,
      description: optional.description,
    },
  };
}

export function validatePixDirection(
  value: unknown,
): ApiResult<PixDirection | undefined> {
  if (value === undefined) return { success: true, data: undefined };

  const direction = oneOf(value, PIX_DIRECTIONS);
  if (!direction) {
    return invalid(`direction must be one of ${PIX_DIRECTIONS.join(", ")}`);
  }

  return { success: true, data: direction };
}

/* -------------------------------------------------------------------------- */

function parsePagination(
  source: Record<string, unknown>,
): ApiResult<{ limit?: number | undefined; offset?: number | undefined }> {
  const read = (field: string): number | undefined | typeof INVALID => {
    const raw = source[field];
    if (raw === undefined || raw === null || raw === "") return undefined;
    const value = typeof raw === "string" ? Number(raw) : raw;
    return typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0
      ? value
      : INVALID;
  };

  const limit = read("limit");
  if (limit === INVALID) return invalid("limit must be a non-negative integer");

  const offset = read("offset");
  if (offset === INVALID) {
    return invalid("offset must be a non-negative integer");
  }

  return { success: true, data: { limit, offset } };
}
