import { DomainError } from "../../shared/domain/domain-error.js";
import type {
  PersonAddress,
  PersonRole,
  PersonType,
} from "../domain/person.js";

/**
 * Result type for API validation, mirroring the other contexts.
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
 * Reads an optional string. `null` means "clear the field"; `undefined` means
 * "leave it as it is". Returns the sentinel `INVALID` when the type is wrong.
 */
const INVALID = Symbol("invalid");

function optionalString(
  source: Record<string, unknown>,
  field: string,
): string | null | undefined | typeof INVALID {
  const value = source[field];
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" ? value.trim() : INVALID;
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

const PERSON_TYPES = ["INDIVIDUAL", "LEGAL_ENTITY"] as const;
const PERSON_ROLES = ["CUSTOMER", "SUPPLIER", "PAYEE"] as const;

const ADDRESS_FIELDS = [
  "street",
  "number",
  "complement",
  "district",
  "city",
  "state",
  "zipCode",
] as const;

/**
 * Reads the address object, accepting only known string fields.
 */
function parseAddress(
  value: unknown,
): PersonAddress | null | undefined | typeof INVALID {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const source = asObject(value);
  if (!source) return INVALID;

  const address: PersonAddress = {};
  for (const field of ADDRESS_FIELDS) {
    const raw = source[field];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") return INVALID;
    address[field] = raw.trim();
  }

  return address;
}

/* -------------------------------------------------------------------------- */
/* People                                                                      */
/* -------------------------------------------------------------------------- */

export interface CreatePersonRequest {
  name: string;
  personType: PersonType;
  document: string;
  email?: string | undefined;
  phone?: string | undefined;
  address?: PersonAddress | undefined;
  roles?: PersonRole[] | undefined;
}

export function validateCreatePersonRequest(
  body: unknown,
): ApiResult<CreatePersonRequest> {
  const source = asObject(body);
  if (!source) return invalid("Request body must be an object");

  const name = requiredString(source, "name");
  if (!name) return invalid("name is required");

  const personType = oneOf(source.personType, PERSON_TYPES);
  if (!personType) {
    return invalid(`personType must be one of ${PERSON_TYPES.join(", ")}`);
  }

  const document = requiredString(source, "document");
  if (!document) return invalid("document is required");

  const email = optionalString(source, "email");
  if (email === INVALID) return invalid("email must be a string");

  const phone = optionalString(source, "phone");
  if (phone === INVALID) return invalid("phone must be a string");

  const address = parseAddress(source.address);
  if (address === INVALID) return invalid("address must be an object");

  let roles: PersonRole[] | undefined;
  if (source.roles !== undefined && source.roles !== null) {
    if (!Array.isArray(source.roles)) return invalid("roles must be an array");
    roles = [];
    for (const raw of source.roles) {
      const role = oneOf(raw, PERSON_ROLES);
      if (!role) return invalid(`roles must contain only ${PERSON_ROLES.join(", ")}`);
      roles.push(role);
    }
  }

  return {
    success: true,
    data: {
      name,
      personType,
      document,
      email: email ?? undefined,
      phone: phone ?? undefined,
      address: address ?? undefined,
      roles,
    },
  };
}

export interface UpdatePersonRequest {
  name?: string | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  address?: PersonAddress | null | undefined;
}

export function validateUpdatePersonRequest(
  body: unknown,
): ApiResult<UpdatePersonRequest> {
  const source = asObject(body);
  if (!source) return invalid("Request body must be an object");

  // Rejected up front rather than silently ignored: a client that sends them
  // believes the change will stick.
  if (source.document !== undefined || source.personType !== undefined) {
    return invalid("document and personType cannot be changed after registration");
  }

  const request: UpdatePersonRequest = {};

  if (source.name !== undefined) {
    const name = requiredString(source, "name");
    if (!name) return invalid("name cannot be empty");
    request.name = name;
  }

  const email = optionalString(source, "email");
  if (email === INVALID) return invalid("email must be a string");
  if (email !== undefined) request.email = email;

  const phone = optionalString(source, "phone");
  if (phone === INVALID) return invalid("phone must be a string");
  if (phone !== undefined) request.phone = phone;

  const address = parseAddress(source.address);
  if (address === INVALID) return invalid("address must be an object");
  if (address !== undefined) request.address = address;

  if (Object.keys(request).length === 0) {
    return invalid("No editable field was provided");
  }

  return { success: true, data: request };
}

export interface PersonRoleRequest {
  role: PersonRole;
}

export function validatePersonRoleRequest(
  body: unknown,
): ApiResult<PersonRoleRequest> {
  const source = asObject(body);
  if (!source) return invalid("Request body must be an object");

  const role = oneOf(source.role, PERSON_ROLES);
  if (!role) return invalid(`role must be one of ${PERSON_ROLES.join(", ")}`);

  return { success: true, data: { role } };
}

export function validatePersonRoleParam(value: unknown): ApiResult<PersonRole> {
  const role = oneOf(value, PERSON_ROLES);
  if (!role) return invalid(`role must be one of ${PERSON_ROLES.join(", ")}`);
  return { success: true, data: role };
}

/* -------------------------------------------------------------------------- */
/* Payee bank accounts                                                         */
/* -------------------------------------------------------------------------- */

export interface BankAccountRequest {
  label: string;
  pixKey?: string | undefined;
  bank?: string | undefined;
  branch?: string | undefined;
  accountNumber?: string | undefined;
  isDefault?: boolean | undefined;
}

export function validateBankAccountRequest(
  body: unknown,
): ApiResult<BankAccountRequest> {
  const source = asObject(body);
  if (!source) return invalid("Request body must be an object");

  const label = requiredString(source, "label");
  if (!label) return invalid("label is required");

  const pixKey = optionalString(source, "pixKey");
  if (pixKey === INVALID) return invalid("pixKey must be a string");

  const bank = optionalString(source, "bank");
  if (bank === INVALID) return invalid("bank must be a string");

  const branch = optionalString(source, "branch");
  if (branch === INVALID) return invalid("branch must be a string");

  const accountNumber = optionalString(source, "accountNumber");
  if (accountNumber === INVALID) {
    return invalid("accountNumber must be a string");
  }

  if (source.isDefault !== undefined && typeof source.isDefault !== "boolean") {
    return invalid("isDefault must be a boolean");
  }

  if (!pixKey && !(bank && branch && accountNumber)) {
    return invalid(
      "Either pixKey or bank, branch and accountNumber must be provided",
    );
  }

  return {
    success: true,
    data: {
      label,
      pixKey: pixKey ?? undefined,
      bank: bank ?? undefined,
      branch: branch ?? undefined,
      accountNumber: accountNumber ?? undefined,
      isDefault: source.isDefault as boolean | undefined,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Cost centers                                                                */
/* -------------------------------------------------------------------------- */

export interface CreateCostCenterRequest {
  name: string;
  description?: string | undefined;
  parentId?: string | undefined;
}

export function validateCreateCostCenterRequest(
  body: unknown,
): ApiResult<CreateCostCenterRequest> {
  const source = asObject(body);
  if (!source) return invalid("Request body must be an object");

  const name = requiredString(source, "name");
  if (!name) return invalid("name is required");

  const description = optionalString(source, "description");
  if (description === INVALID) return invalid("description must be a string");

  const parentId = optionalString(source, "parentId");
  if (parentId === INVALID) return invalid("parentId must be a string");

  return {
    success: true,
    data: {
      name,
      description: description ?? undefined,
      parentId: parentId || undefined,
    },
  };
}

export interface UpdateCostCenterRequest {
  name?: string | undefined;
  description?: string | null | undefined;
  /** Present only when the caller asked for a reparent. */
  parentId?: string | null | undefined;
  parentProvided: boolean;
}

export function validateUpdateCostCenterRequest(
  body: unknown,
): ApiResult<UpdateCostCenterRequest> {
  const source = asObject(body);
  if (!source) return invalid("Request body must be an object");

  const request: UpdateCostCenterRequest = { parentProvided: false };

  if (source.name !== undefined) {
    const name = requiredString(source, "name");
    if (!name) return invalid("name cannot be empty");
    request.name = name;
  }

  const description = optionalString(source, "description");
  if (description === INVALID) return invalid("description must be a string");
  if (description !== undefined) request.description = description;

  if (source.parentId !== undefined) {
    const parentId = optionalString(source, "parentId");
    if (parentId === INVALID) return invalid("parentId must be a string");
    request.parentProvided = true;
    request.parentId = parentId || null;
  }

  if (
    request.name === undefined &&
    request.description === undefined &&
    !request.parentProvided
  ) {
    return invalid("No editable field was provided");
  }

  return { success: true, data: request };
}
