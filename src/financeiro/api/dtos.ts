import { DomainError } from "../../shared/domain/domain-error.js";
import type { AccountType } from "../domain/account.js";
import type { CardType } from "../domain/card.js";
import type { CategoryType } from "../domain/category.js";
import type { Periodicity } from "../domain/recurrence.js";
import type {
  TransactionStatus,
  TransactionType,
} from "../domain/transaction.js";

/**
 * Result type for API validation, mirroring the identity context.
 */
export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: DomainError };

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

/**
 * Reads a required non-empty string field.
 */
function requiredString(
  source: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = source[field];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/**
 * Reads an optional string field. Returns null when present but invalid.
 */
function optionalString(
  source: Record<string, unknown>,
  field: string,
): string | undefined | null {
  const value = source[field];
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value.trim() : null;
}

/**
 * Reads an optional finite number. Returns null when present but invalid.
 */
function optionalNumber(
  source: Record<string, unknown>,
  field: string,
): number | undefined | null {
  const value = source[field];
  if (value === undefined || value === null) return undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Parses an ISO date (YYYY-MM-DD or full ISO 8601). Returns null when invalid.
 */
function parseDate(value: unknown): Date | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseTags(value: unknown): string[] | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;
  if (value.some((tag) => typeof tag !== "string")) return null;
  return (value as string[]).map((tag) => tag.trim()).filter(Boolean);
}

const ACCOUNT_TYPES = ["CHECKING", "SAVINGS", "INVESTMENT", "CASH"] as const;
const CATEGORY_TYPES = ["EXPENSE", "INCOME"] as const;
const TRANSACTION_TYPES = [
  "EXPENSE",
  "INCOME",
  "TRANSFER",
  "ADJUSTMENT",
] as const;
const TRANSACTION_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "REFUNDED",
] as const;
const PERIODICITIES = [
  "DAILY",
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "SEMIANNUAL",
  "ANNUAL",
] as const;

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/* -------------------------------------------------------------------------- */
/* Accounts                                                                    */
/* -------------------------------------------------------------------------- */

export interface CreateAccountRequest {
  walletId: string;
  name: string;
  number: string;
  type: AccountType;
  currency: string;
  initialBalance?: number | undefined;
}

export function validateCreateAccountRequest(
  body: unknown,
): ApiResult<CreateAccountRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const walletId = requiredString(b, "walletId");
  if (!walletId) return invalid("walletId is required");

  const name = requiredString(b, "name");
  if (!name) return invalid("name is required");

  const number = requiredString(b, "number");
  if (!number) return invalid("number is required");

  const type = oneOf(b.type, ACCOUNT_TYPES);
  if (!type) return invalid(`type must be one of ${ACCOUNT_TYPES.join(", ")}`);

  const currency = requiredString(b, "currency");
  if (!currency) return invalid("currency is required");

  const initialBalance = optionalNumber(b, "initialBalance");
  if (initialBalance === null) return invalid("initialBalance must be a number");

  return {
    success: true,
    data: { walletId, name, number, type, currency, initialBalance },
  };
}

export interface UpdateAccountRequest {
  name?: string | undefined;
  walletId?: string | undefined;
}

export function validateUpdateAccountRequest(
  body: unknown,
): ApiResult<UpdateAccountRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const name = optionalString(b, "name");
  if (name === null || name === "") return invalid("name must be a non-empty string");

  const walletId = optionalString(b, "walletId");
  if (walletId === null || walletId === "") {
    return invalid("walletId must be a non-empty string");
  }

  if (name === undefined && walletId === undefined) {
    return invalid("Nothing to update");
  }

  return { success: true, data: { name, walletId } };
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                  */
/* -------------------------------------------------------------------------- */

export interface CreateCategoryRequest {
  name: string;
  type: CategoryType;
  parentId?: string | undefined;
  color?: string | undefined;
  icon?: string | undefined;
}

export function validateCreateCategoryRequest(
  body: unknown,
): ApiResult<CreateCategoryRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const name = requiredString(b, "name");
  if (!name) return invalid("name is required");

  const type = oneOf(b.type, CATEGORY_TYPES);
  if (!type) return invalid(`type must be one of ${CATEGORY_TYPES.join(", ")}`);

  const parentId = optionalString(b, "parentId");
  if (parentId === null) return invalid("parentId must be a string");

  const color = optionalString(b, "color");
  if (color === null) return invalid("color must be a string");

  const icon = optionalString(b, "icon");
  if (icon === null) return invalid("icon must be a string");

  return {
    success: true,
    data: { name, type, parentId: parentId || undefined, color: color || undefined, icon: icon || undefined },
  };
}

export interface UpdateCategoryRequest {
  name?: string | undefined;
  type?: CategoryType | undefined;
  color?: string | undefined;
  icon?: string | undefined;
}

export function validateUpdateCategoryRequest(
  body: unknown,
): ApiResult<UpdateCategoryRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const name = optionalString(b, "name");
  if (name === null || name === "") return invalid("name must be a non-empty string");

  const type = b.type === undefined ? undefined : oneOf(b.type, CATEGORY_TYPES);
  if (b.type !== undefined && !type) {
    return invalid(`type must be one of ${CATEGORY_TYPES.join(", ")}`);
  }

  const color = optionalString(b, "color");
  if (color === null) return invalid("color must be a string");

  const icon = optionalString(b, "icon");
  if (icon === null) return invalid("icon must be a string");

  return { success: true, data: { name, type, color, icon } };
}

export interface MoveCategoryRequest {
  parentId: string | undefined;
}

export function validateMoveCategoryRequest(
  body: unknown,
): ApiResult<MoveCategoryRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  if (b.parentId === null || b.parentId === undefined) {
    return { success: true, data: { parentId: undefined } };
  }

  const parentId = requiredString(b, "parentId");
  if (!parentId) return invalid("parentId must be a non-empty string or null");

  return { success: true, data: { parentId } };
}

/* -------------------------------------------------------------------------- */
/* Transactions                                                                */
/* -------------------------------------------------------------------------- */

export interface CreateTransactionRequest {
  accountId: string;
  categoryId?: string | undefined;
  type: TransactionType;
  grossAmount: number;
  discount?: number | undefined;
  interest?: number | undefined;
  penalty?: number | undefined;
  currency?: string | undefined;
  date: Date;
  competence?: Date | undefined;
  description?: string | undefined;
  tags?: string[] | undefined;
  installments?: number | undefined;
  cardId?: string | undefined;
  exchangeRate?:
    | { sourceCurrency: string; targetCurrency: string; rate: number; date: Date }
    | undefined;
}

export function validateCreateTransactionRequest(
  body: unknown,
): ApiResult<CreateTransactionRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const accountId = requiredString(b, "accountId");
  if (!accountId) return invalid("accountId is required (RN-03)");

  const type = oneOf(b.type, TRANSACTION_TYPES);
  if (!type) {
    return invalid(`type must be one of ${TRANSACTION_TYPES.join(", ")}`);
  }

  const grossAmount = optionalNumber(b, "grossAmount");
  if (grossAmount === null || grossAmount === undefined) {
    return invalid("grossAmount is required and must be a number");
  }

  const discount = optionalNumber(b, "discount");
  if (discount === null) return invalid("discount must be a number");

  const interest = optionalNumber(b, "interest");
  if (interest === null) return invalid("interest must be a number");

  const penalty = optionalNumber(b, "penalty");
  if (penalty === null) return invalid("penalty must be a number");

  const date = parseDate(b.date);
  if (date === null || date === undefined) {
    return invalid("date is required and must be an ISO date");
  }

  const competence = parseDate(b.competence);
  if (competence === null) return invalid("competence must be an ISO date");

  const categoryId = optionalString(b, "categoryId");
  if (categoryId === null) return invalid("categoryId must be a string");

  const currency = optionalString(b, "currency");
  if (currency === null) return invalid("currency must be a string");

  const description = optionalString(b, "description");
  if (description === null) return invalid("description must be a string");

  const tags = parseTags(b.tags);
  if (tags === null) return invalid("tags must be an array of strings");

  const installments = optionalNumber(b, "installments");
  if (installments === null) return invalid("installments must be a number");
  if (
    installments !== undefined &&
    (!Number.isInteger(installments) || installments < 1)
  ) {
    return invalid("installments must be a positive integer");
  }

  const cardId = optionalString(b, "cardId");
  if (cardId === null) return invalid("cardId must be a string");

  const exchangeRate = parseExchangeRate(b.exchangeRate);
  if (exchangeRate === null) {
    return invalid(
      "exchangeRate must be { sourceCurrency, targetCurrency, rate, date }",
    );
  }

  return {
    success: true,
    data: {
      accountId,
      cardId: cardId || undefined,
      categoryId: categoryId || undefined,
      type,
      grossAmount,
      discount,
      interest,
      penalty,
      currency: currency || undefined,
      date,
      competence,
      description: description || undefined,
      tags,
      installments,
      exchangeRate,
    },
  };
}

/**
 * Parses the exchange rate payload shared by transactions and transfers.
 */
function parseExchangeRate(
  value: unknown,
):
  | { sourceCurrency: string; targetCurrency: string; rate: number; date: Date }
  | undefined
  | null {
  if (value === undefined || value === null) return undefined;

  const raw = asObject(value);
  if (!raw) return null;

  const sourceCurrency = requiredString(raw, "sourceCurrency");
  const targetCurrency = requiredString(raw, "targetCurrency");
  const rate = optionalNumber(raw, "rate");
  const date = parseDate(raw.date) ?? new Date();

  if (!sourceCurrency || !targetCurrency || !rate || rate <= 0) {
    return null;
  }

  return { sourceCurrency, targetCurrency, rate, date };
}

export interface UpdateTransactionRequest {
  grossAmount?: number | undefined;
  discount?: number | undefined;
  interest?: number | undefined;
  penalty?: number | undefined;
  categoryId?: string | undefined;
  date?: Date | undefined;
  competence?: Date | undefined;
  description?: string | undefined;
  tags?: string[] | undefined;
}

export function validateUpdateTransactionRequest(
  body: unknown,
): ApiResult<UpdateTransactionRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const grossAmount = optionalNumber(b, "grossAmount");
  if (grossAmount === null) return invalid("grossAmount must be a number");

  const discount = optionalNumber(b, "discount");
  if (discount === null) return invalid("discount must be a number");

  const interest = optionalNumber(b, "interest");
  if (interest === null) return invalid("interest must be a number");

  const penalty = optionalNumber(b, "penalty");
  if (penalty === null) return invalid("penalty must be a number");

  const categoryId = optionalString(b, "categoryId");
  if (categoryId === null) return invalid("categoryId must be a string");

  const date = parseDate(b.date);
  if (date === null) return invalid("date must be an ISO date");

  const competence = parseDate(b.competence);
  if (competence === null) return invalid("competence must be an ISO date");

  const description = optionalString(b, "description");
  if (description === null) return invalid("description must be a string");

  const tags = parseTags(b.tags);
  if (tags === null) return invalid("tags must be an array of strings");

  return {
    success: true,
    data: {
      grossAmount,
      discount,
      interest,
      penalty,
      categoryId,
      date,
      competence,
      description,
      tags,
    },
  };
}

export interface TransactionQueryRequest {
  accountId?: string | undefined;
  categoryId?: string | undefined;
  type?: TransactionType | undefined;
  status?: TransactionStatus | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  tag?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export function validateTransactionQuery(
  query: unknown,
): ApiResult<TransactionQueryRequest> {
  const q = asObject(query) ?? {};

  const type = q.type === undefined ? undefined : oneOf(q.type, TRANSACTION_TYPES);
  if (q.type !== undefined && !type) {
    return invalid(`type must be one of ${TRANSACTION_TYPES.join(", ")}`);
  }

  const status =
    q.status === undefined ? undefined : oneOf(q.status, TRANSACTION_STATUSES);
  if (q.status !== undefined && !status) {
    return invalid(`status must be one of ${TRANSACTION_STATUSES.join(", ")}`);
  }

  const from = parseDate(q.from);
  if (from === null) return invalid("from must be an ISO date");

  const to = parseDate(q.to);
  if (to === null) return invalid("to must be an ISO date");

  const pagination = parsePagination(q);
  if (!pagination.success) return pagination;

  return {
    success: true,
    data: {
      accountId: optionalString(q, "accountId") || undefined,
      categoryId: optionalString(q, "categoryId") || undefined,
      type,
      status,
      from,
      to,
      tag: optionalString(q, "tag") || undefined,
      ...pagination.data,
    },
  };
}

/**
 * Query strings arrive as strings; limit/offset are parsed and bounded here.
 */
function parsePagination(
  query: Record<string, unknown>,
): ApiResult<{ limit?: number | undefined; offset?: number | undefined }> {
  const parse = (value: unknown): number | undefined | null => {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  };

  const limit = parse(query.limit);
  if (limit === null) return invalid("limit must be a non-negative integer");

  const offset = parse(query.offset);
  if (offset === null) return invalid("offset must be a non-negative integer");

  return {
    success: true,
    data: { limit: limit === undefined ? undefined : Math.min(limit, 200), offset },
  };
}

export interface AttachmentRequest {
  filename: string;
  mimeType: string;
  size: number;
  url: string;
}

export function validateAttachmentRequest(
  body: unknown,
): ApiResult<AttachmentRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const filename = requiredString(b, "filename");
  if (!filename) return invalid("filename is required");

  const mimeType = requiredString(b, "mimeType");
  if (!mimeType) return invalid("mimeType is required");

  const url = requiredString(b, "url");
  if (!url) return invalid("url is required");

  const size = optionalNumber(b, "size");
  if (size === null || size === undefined || size < 0) {
    return invalid("size is required and must be a non-negative number");
  }

  return { success: true, data: { filename, mimeType, size, url } };
}

export interface StateChangeRequest {
  reason?: string | undefined;
}

export function validateStateChangeRequest(
  body: unknown,
): ApiResult<StateChangeRequest> {
  if (body === undefined || body === null) {
    return { success: true, data: {} };
  }

  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const reason = optionalString(b, "reason");
  if (reason === null) return invalid("reason must be a string");

  return { success: true, data: { reason: reason || undefined } };
}

/* -------------------------------------------------------------------------- */
/* Installments                                                                */
/* -------------------------------------------------------------------------- */

export interface InstallmentQueryRequest {
  status?: "PENDING" | "PAID" | "OVERDUE" | undefined;
  accountId?: string | undefined;
  parentTransactionId?: string | undefined;
  dueFrom?: Date | undefined;
  dueTo?: Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export function validateInstallmentQuery(
  query: unknown,
): ApiResult<InstallmentQueryRequest> {
  const q = asObject(query) ?? {};

  const status =
    q.status === undefined
      ? undefined
      : oneOf(q.status, ["PENDING", "PAID", "OVERDUE"] as const);
  if (q.status !== undefined && !status) {
    return invalid("status must be one of PENDING, PAID, OVERDUE");
  }

  const dueFrom = parseDate(q.dueFrom);
  if (dueFrom === null) return invalid("dueFrom must be an ISO date");

  const dueTo = parseDate(q.dueTo);
  if (dueTo === null) return invalid("dueTo must be an ISO date");

  const pagination = parsePagination(q);
  if (!pagination.success) return pagination;

  return {
    success: true,
    data: {
      status,
      accountId: optionalString(q, "accountId") || undefined,
      parentTransactionId:
        optionalString(q, "parentTransactionId") || undefined,
      dueFrom,
      dueTo,
      ...pagination.data,
    },
  };
}

export interface PayInstallmentRequest {
  paymentDate: Date;
  accountId?: string | undefined;
}

export function validatePayInstallmentRequest(
  body: unknown,
): ApiResult<PayInstallmentRequest> {
  const b = asObject(body) ?? {};

  const paymentDate = parseDate(b.paymentDate);
  if (paymentDate === null) return invalid("paymentDate must be an ISO date");

  const accountId = optionalString(b, "accountId");
  if (accountId === null) return invalid("accountId must be a string");

  return {
    success: true,
    data: {
      paymentDate: paymentDate ?? new Date(),
      accountId: accountId || undefined,
    },
  };
}

export interface PayInstallmentsBatchRequest {
  installmentIds: string[];
  paymentDate: Date;
  accountId?: string | undefined;
}

export function validatePayInstallmentsBatchRequest(
  body: unknown,
): ApiResult<PayInstallmentsBatchRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const ids = b.installmentIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.some((id) => typeof id !== "string" || id.trim().length === 0)
  ) {
    return invalid("installmentIds must be a non-empty array of strings");
  }

  const single = validatePayInstallmentRequest(b);
  if (!single.success) return single;

  return {
    success: true,
    data: {
      installmentIds: (ids as string[]).map((id) => id.trim()),
      paymentDate: single.data.paymentDate,
      accountId: single.data.accountId,
    },
  };
}

export interface ChangeDueDateRequest {
  dueDate: Date;
}

export function validateChangeDueDateRequest(
  body: unknown,
): ApiResult<ChangeDueDateRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const dueDate = parseDate(b.dueDate);
  if (dueDate === null || dueDate === undefined) {
    return invalid("dueDate is required and must be an ISO date");
  }

  return { success: true, data: { dueDate } };
}

/* -------------------------------------------------------------------------- */
/* Transfers                                                                   */
/* -------------------------------------------------------------------------- */

export interface CreateTransferRequest {
  sourceAccountId: string;
  targetAccountId: string;
  amount: number;
  date: Date;
  description?: string | undefined;
  categoryId?: string | undefined;
  exchangeRate?:
    | { sourceCurrency: string; targetCurrency: string; rate: number; date: Date }
    | undefined;
}

export function validateCreateTransferRequest(
  body: unknown,
): ApiResult<CreateTransferRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const sourceAccountId = requiredString(b, "sourceAccountId");
  if (!sourceAccountId) return invalid("sourceAccountId is required");

  const targetAccountId = requiredString(b, "targetAccountId");
  if (!targetAccountId) return invalid("targetAccountId is required");

  const amount = optionalNumber(b, "amount");
  if (amount === null || amount === undefined || amount <= 0) {
    return invalid("amount is required and must be greater than zero");
  }

  const date = parseDate(b.date) ?? new Date();

  const description = optionalString(b, "description");
  if (description === null) return invalid("description must be a string");

  const categoryId = optionalString(b, "categoryId");
  if (categoryId === null) return invalid("categoryId must be a string");

  const exchangeRate = parseExchangeRate(b.exchangeRate);
  if (exchangeRate === null) {
    return invalid(
      "exchangeRate must be { sourceCurrency, targetCurrency, rate, date }",
    );
  }

  return {
    success: true,
    data: {
      sourceAccountId,
      targetAccountId,
      amount,
      date,
      description: description || undefined,
      categoryId: categoryId || undefined,
      exchangeRate,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Recurrences                                                                 */
/* -------------------------------------------------------------------------- */

export interface CreateRecurrenceRequest {
  accountId: string;
  categoryId?: string | undefined;
  description: string;
  amount: number;
  currency: string;
  type?: TransactionType | undefined;
  periodicity: Periodicity;
  startDate: Date;
  endDate?: Date | undefined;
  maxOccurrences?: number | undefined;
}

export function validateCreateRecurrenceRequest(
  body: unknown,
): ApiResult<CreateRecurrenceRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const accountId = requiredString(b, "accountId");
  if (!accountId) return invalid("accountId is required");

  const description = requiredString(b, "description");
  if (!description) return invalid("description is required");

  const amount = optionalNumber(b, "amount");
  if (amount === null || amount === undefined || amount <= 0) {
    return invalid("amount is required and must be greater than zero");
  }

  const periodicity = oneOf(b.periodicity, PERIODICITIES);
  if (!periodicity) {
    return invalid(`periodicity must be one of ${PERIODICITIES.join(", ")}`);
  }

  const startDate = parseDate(b.startDate);
  if (startDate === null || startDate === undefined) {
    return invalid("startDate is required and must be an ISO date");
  }

  const endDate = parseDate(b.endDate);
  if (endDate === null) return invalid("endDate must be an ISO date");

  const maxOccurrences = optionalNumber(b, "maxOccurrences");
  if (maxOccurrences === null) return invalid("maxOccurrences must be a number");

  const type = b.type === undefined ? undefined : oneOf(b.type, TRANSACTION_TYPES);
  if (b.type !== undefined && !type) {
    return invalid(`type must be one of ${TRANSACTION_TYPES.join(", ")}`);
  }

  const categoryId = optionalString(b, "categoryId");
  if (categoryId === null) return invalid("categoryId must be a string");

  const currency = optionalString(b, "currency");
  if (currency === null) return invalid("currency must be a string");

  return {
    success: true,
    data: {
      accountId,
      categoryId: categoryId || undefined,
      description,
      amount,
      currency: currency || "BRL",
      type,
      periodicity,
      startDate,
      endDate,
      maxOccurrences,
    },
  };
}

export interface UpdateRecurrenceRequest {
  description?: string | undefined;
  amount?: number | undefined;
  categoryId?: string | undefined;
  endDate?: Date | undefined;
  maxOccurrences?: number | undefined;
}

export function validateUpdateRecurrenceRequest(
  body: unknown,
): ApiResult<UpdateRecurrenceRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const description = optionalString(b, "description");
  if (description === null || description === "") {
    return invalid("description must be a non-empty string");
  }

  const amount = optionalNumber(b, "amount");
  if (amount === null) return invalid("amount must be a number");

  const categoryId = optionalString(b, "categoryId");
  if (categoryId === null) return invalid("categoryId must be a string");

  const endDate = parseDate(b.endDate);
  if (endDate === null) return invalid("endDate must be an ISO date");

  const maxOccurrences = optionalNumber(b, "maxOccurrences");
  if (maxOccurrences === null) return invalid("maxOccurrences must be a number");

  return {
    success: true,
    data: { description, amount, categoryId, endDate, maxOccurrences },
  };
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                       */
/* -------------------------------------------------------------------------- */

const CARD_TYPES = ["CREDIT", "DEBIT", "PREPAID"] as const;

/**
 * Reads an optional integer day-of-month. Returns null when present but invalid.
 */
function optionalCycleDay(
  source: Record<string, unknown>,
  field: string,
): number | undefined | null {
  const value = optionalNumber(source, field);
  if (value === undefined || value === null) return value;
  return Number.isInteger(value) && value >= 1 && value <= 31 ? value : null;
}

export interface CreateCardRequest {
  accountId: string;
  name: string;
  type: CardType;
  brand: string;
  bank?: string | undefined;
  limit?: number | undefined;
  closingDay?: number | undefined;
  dueDay?: number | undefined;
}

export function validateCreateCardRequest(
  body: unknown,
): ApiResult<CreateCardRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const accountId = requiredString(b, "accountId");
  if (!accountId) return invalid("accountId is required");

  const name = requiredString(b, "name");
  if (!name) return invalid("name is required");

  const type = oneOf(b.type, CARD_TYPES);
  if (!type) return invalid(`type must be one of ${CARD_TYPES.join(", ")}`);

  const brand = requiredString(b, "brand");
  if (!brand) return invalid("brand is required");

  const bank = optionalString(b, "bank");
  if (bank === null) return invalid("bank must be a string");

  const limit = optionalNumber(b, "limit");
  if (limit === null) return invalid("limit must be a number");

  const closingDay = optionalCycleDay(b, "closingDay");
  if (closingDay === null) {
    return invalid("closingDay must be an integer between 1 and 31");
  }

  const dueDay = optionalCycleDay(b, "dueDay");
  if (dueDay === null) {
    return invalid("dueDay must be an integer between 1 and 31");
  }

  return {
    success: true,
    data: {
      accountId,
      name,
      type,
      brand,
      bank: bank || undefined,
      limit,
      closingDay,
      dueDay,
    },
  };
}

export interface EditCardRequest {
  name?: string | undefined;
  brand?: string | undefined;
  bank?: string | undefined;
  limit?: number | undefined;
  closingDay?: number | undefined;
  dueDay?: number | undefined;
}

export function validateEditCardRequest(
  body: unknown,
): ApiResult<EditCardRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const name = optionalString(b, "name");
  if (name === null || name === "") {
    return invalid("name must be a non-empty string");
  }

  const brand = optionalString(b, "brand");
  if (brand === null || brand === "") {
    return invalid("brand must be a non-empty string");
  }

  const bank = optionalString(b, "bank");
  if (bank === null) return invalid("bank must be a string");

  const limit = optionalNumber(b, "limit");
  if (limit === null) return invalid("limit must be a number");

  const closingDay = optionalCycleDay(b, "closingDay");
  if (closingDay === null) {
    return invalid("closingDay must be an integer between 1 and 31");
  }

  const dueDay = optionalCycleDay(b, "dueDay");
  if (dueDay === null) {
    return invalid("dueDay must be an integer between 1 and 31");
  }

  if (
    name === undefined &&
    brand === undefined &&
    bank === undefined &&
    limit === undefined &&
    closingDay === undefined &&
    dueDay === undefined
  ) {
    return invalid("Nothing to update");
  }

  return {
    success: true,
    data: { name, brand, bank, limit, closingDay, dueDay },
  };
}

/* -------------------------------------------------------------------------- */
/* Invoices                                                                    */
/* -------------------------------------------------------------------------- */

export interface InvoicePaymentRequest {
  accountId: string;
  amount: number;
  date?: Date | undefined;
  categoryId?: string | undefined;
  description?: string | undefined;
}

export function validateInvoicePaymentRequest(
  body: unknown,
): ApiResult<InvoicePaymentRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const accountId = requiredString(b, "accountId");
  if (!accountId) return invalid("accountId is required");

  const amount = optionalNumber(b, "amount");
  if (amount === null || amount === undefined) {
    return invalid("amount is required and must be a number");
  }
  if (amount <= 0) return invalid("amount must be greater than zero");

  const date = parseDate(b.date);
  if (date === null) return invalid("date must be an ISO date");

  const categoryId = optionalString(b, "categoryId");
  if (categoryId === null) return invalid("categoryId must be a string");

  const description = optionalString(b, "description");
  if (description === null) return invalid("description must be a string");

  return {
    success: true,
    data: {
      accountId,
      amount,
      date,
      categoryId: categoryId || undefined,
      description: description || undefined,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Budgets                                                                     */
/* -------------------------------------------------------------------------- */

export interface CreateBudgetRequest {
  categoryId: string;
  periodStart: Date;
  periodEnd: Date;
  plannedAmount: number;
  currency?: string | undefined;
}

export function validateCreateBudgetRequest(
  body: unknown,
): ApiResult<CreateBudgetRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const categoryId = requiredString(b, "categoryId");
  if (!categoryId) return invalid("categoryId is required");

  const periodStart = parseDate(b.periodStart);
  if (periodStart === null || periodStart === undefined) {
    return invalid("periodStart is required and must be an ISO date");
  }

  const periodEnd = parseDate(b.periodEnd);
  if (periodEnd === null || periodEnd === undefined) {
    return invalid("periodEnd is required and must be an ISO date");
  }

  if (periodStart.getTime() > periodEnd.getTime()) {
    return invalid("periodStart must not be later than periodEnd");
  }

  const plannedAmount = optionalNumber(b, "plannedAmount");
  if (plannedAmount === null || plannedAmount === undefined) {
    return invalid("plannedAmount is required and must be a number");
  }
  if (plannedAmount <= 0) {
    return invalid("plannedAmount must be greater than zero");
  }

  const currency = optionalString(b, "currency");
  if (currency === null) return invalid("currency must be a string");

  return {
    success: true,
    data: {
      categoryId,
      periodStart,
      periodEnd,
      plannedAmount,
      currency: currency || undefined,
    },
  };
}

export interface EditBudgetRequest {
  plannedAmount: number;
}

export function validateEditBudgetRequest(
  body: unknown,
): ApiResult<EditBudgetRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const plannedAmount = optionalNumber(b, "plannedAmount");
  if (plannedAmount === null || plannedAmount === undefined) {
    return invalid("plannedAmount is required and must be a number");
  }
  if (plannedAmount <= 0) {
    return invalid("plannedAmount must be greater than zero");
  }

  return { success: true, data: { plannedAmount } };
}

/* -------------------------------------------------------------------------- */
/* Goals                                                                       */
/* -------------------------------------------------------------------------- */

export interface CreateGoalRequest {
  accountId: string;
  name: string;
  targetAmount: number;
  deadline: Date;
}

export function validateCreateGoalRequest(
  body: unknown,
): ApiResult<CreateGoalRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const accountId = requiredString(b, "accountId");
  if (!accountId) return invalid("accountId is required");

  const name = requiredString(b, "name");
  if (!name) return invalid("name is required");

  const targetAmount = optionalNumber(b, "targetAmount");
  if (targetAmount === null || targetAmount === undefined) {
    return invalid("targetAmount is required and must be a number");
  }
  if (targetAmount <= 0) {
    return invalid("targetAmount must be greater than zero");
  }

  const deadline = parseDate(b.deadline);
  if (deadline === null || deadline === undefined) {
    return invalid("deadline is required and must be an ISO date");
  }

  return { success: true, data: { accountId, name, targetAmount, deadline } };
}

export interface EditGoalRequest {
  name?: string | undefined;
  targetAmount?: number | undefined;
  deadline?: Date | undefined;
}

export function validateEditGoalRequest(
  body: unknown,
): ApiResult<EditGoalRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const name = optionalString(b, "name");
  if (name === null || name === "") {
    return invalid("name must be a non-empty string");
  }

  const targetAmount = optionalNumber(b, "targetAmount");
  if (targetAmount === null) return invalid("targetAmount must be a number");

  const deadline = parseDate(b.deadline);
  if (deadline === null) return invalid("deadline must be an ISO date");

  if (
    name === undefined &&
    targetAmount === undefined &&
    deadline === undefined
  ) {
    return invalid("Nothing to update");
  }

  return { success: true, data: { name, targetAmount, deadline } };
}

export interface ContributionRequest {
  amount: number;
  date?: Date | undefined;
}

export function validateContributionRequest(
  body: unknown,
): ApiResult<ContributionRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const amount = optionalNumber(b, "amount");
  if (amount === null || amount === undefined) {
    return invalid("amount is required and must be a number");
  }
  if (amount <= 0) return invalid("amount must be greater than zero");

  const date = parseDate(b.date);
  if (date === null) return invalid("date must be an ISO date");

  return { success: true, data: { amount, date } };
}

/* -------------------------------------------------------------------------- */
/* Dashboard and reports                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Reads a list of ids sent either as repeated query params or as a single
 * comma-separated value. Returns null when present but not a list of strings.
 */
function parseIdList(value: unknown): string[] | undefined | null {
  if (value === undefined || value === null) return undefined;

  if (typeof value === "string") {
    const ids = value
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    return ids.length > 0 ? ids : undefined;
  }

  if (Array.isArray(value)) {
    if (value.some((id) => typeof id !== "string")) return null;
    const ids = (value as string[]).map((id) => id.trim()).filter(Boolean);
    return ids.length > 0 ? ids : undefined;
  }

  return null;
}

/**
 * First and last day of the month containing `reference`, in UTC.
 */
function currentMonth(reference: Date): { start: Date; end: Date } {
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();

  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 0)),
  };
}

export interface DashboardQuery {
  start: Date;
  end: Date;
  accountIds?: string[] | undefined;
}

export function validateDashboardQuery(
  query: unknown,
  reference: Date = new Date(),
): ApiResult<DashboardQuery> {
  const q = asObject(query) ?? {};

  const start = parseDate(q.start);
  if (start === null) return invalid("start must be an ISO date");

  const end = parseDate(q.end);
  if (end === null) return invalid("end must be an ISO date");

  const accountIds = parseIdList(q.accountIds ?? q.accountId);
  if (accountIds === null) {
    return invalid("accountIds must be a list of strings");
  }

  // No period supplied means the current month.
  const period =
    start === undefined || end === undefined
      ? currentMonth(reference)
      : { start, end };

  if (period.start.getTime() > period.end.getTime()) {
    return invalid("start must not be later than end");
  }

  return {
    success: true,
    data: { start: period.start, end: period.end, accountIds },
  };
}

export const REPORT_TYPES = [
  "cash-flow",
  "income-statement",
  "by-category",
  "by-card",
  "by-account",
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export interface ReportQuery {
  type: ReportType;
  start: Date;
  end: Date;
  accountIds?: string[] | undefined;
}

export function validateReportQuery(
  type: unknown,
  query: unknown,
  reference: Date = new Date(),
): ApiResult<ReportQuery> {
  const reportType = oneOf(type, REPORT_TYPES);
  if (!reportType) {
    return invalid(`type must be one of ${REPORT_TYPES.join(", ")}`);
  }

  const period = validateDashboardQuery(query, reference);
  if (!period.success) {
    return period;
  }

  return {
    success: true,
    data: {
      type: reportType,
      start: period.data.start,
      end: period.data.end,
      accountIds: period.data.accountIds,
    },
  };
}
