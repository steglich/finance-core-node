import { randomUUID } from "node:crypto";
import { AggregateRoot } from "../../shared/domain/aggregate-root.js";
import { CNPJ } from "../../shared/domain/cnpj.js";
import { CPF } from "../../shared/domain/cpf.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Email } from "../../shared/domain/email.js";
import { Result } from "../../shared/domain/result.js";
import {
  PersonDeactivated,
  PersonEdited,
  PersonRegistered,
  PersonRoleChanged,
} from "./person-events.js";

/**
 * Natural person (CPF) or legal entity (CNPJ).
 */
export type PersonType = "INDIVIDUAL" | "LEGAL_ENTITY";

/**
 * Customer, supplier and payee are roles of the same person, not separate
 * entities — a person may hold any combination of them.
 */
export type PersonRole = "CUSTOMER" | "SUPPLIER" | "PAYEE";

const PERSON_TYPES: ReadonlySet<string> = new Set<PersonType>([
  "INDIVIDUAL",
  "LEGAL_ENTITY",
]);

const PERSON_ROLES: ReadonlySet<string> = new Set<PersonRole>([
  "CUSTOMER",
  "SUPPLIER",
  "PAYEE",
]);

/**
 * Postal address, stored as an opaque object — no postcode lookup and no
 * validation beyond the shape.
 */
export interface PersonAddress {
  street?: string | undefined;
  number?: string | undefined;
  complement?: string | undefined;
  district?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  zipCode?: string | undefined;
}

/**
 * Open-record counters the caller must supply, since charges and payables live
 * in another bounded context: the domain receives the fact, it does not fetch it.
 */
export interface OpenRecordCounts {
  openCharges: number;
  openPayables: number;
}

/**
 * Constructor properties for rehydrating a person from persistence.
 */
export interface PersonProps {
  id: string;
  companyId: string;
  name: string;
  personType: PersonType;
  document: string;
  email?: string | undefined;
  phone?: string | undefined;
  address?: PersonAddress | undefined;
  roles?: readonly PersonRole[] | undefined;
  isActive?: boolean;
  createdAt?: Date;
}

/**
 * Input for registering a new person.
 */
export interface CreatePersonInput {
  id?: string;
  companyId: string;
  name: string;
  personType: PersonType;
  document: string;
  email?: string | undefined;
  phone?: string | undefined;
  address?: PersonAddress | undefined;
  roles?: readonly PersonRole[] | undefined;
}

/**
 * Mutable fields of a person. Document and person type are immutable by design.
 */
export interface EditPersonInput {
  name?: string | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  address?: PersonAddress | null | undefined;
}

/**
 * Validates the document against the person type and returns it unmasked.
 */
function normalizeDocument(personType: PersonType, document: string): string {
  return personType === "INDIVIDUAL"
    ? CPF.create(document).value
    : CNPJ.create(document).value;
}

/**
 * Aggregate root of the registry context: the customers, suppliers and payees
 * a company deals with.
 *
 * Document and person type never change after registration — a wrong document
 * means a wrong person, which is a new registration, not an edit.
 */
export class Person extends AggregateRoot<string> {
  private readonly _companyId: string;
  private readonly _personType: PersonType;
  private readonly _document: string;
  private _name: string;
  private _email: Email | undefined;
  private _phone: string | undefined;
  private _address: PersonAddress | undefined;
  private readonly _roles: Set<PersonRole>;
  private _isActive: boolean;

  constructor(props: PersonProps) {
    super(props.id, props.createdAt);

    const name = props.name.trim();

    if (props.companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Person requires a company",
      );
    }

    if (name.length === 0) {
      throw DomainError.create("VALIDATION_ERROR", "Person name is required");
    }

    if (!PERSON_TYPES.has(props.personType)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid person type: ${props.personType}`,
      );
    }

    for (const role of props.roles ?? []) {
      if (!PERSON_ROLES.has(role)) {
        throw DomainError.create(
          "VALIDATION_ERROR",
          `Invalid person role: ${role}`,
        );
      }
    }

    this._companyId = props.companyId;
    this._name = name;
    this._personType = props.personType;
    this._document = normalizeDocument(props.personType, props.document);
    this._email = props.email ? Email.create(props.email) : undefined;
    this._phone = props.phone?.trim() || undefined;
    this._address = props.address;
    this._roles = new Set(props.roles ?? []);
    this._isActive = props.isActive ?? true;
  }

  get companyId(): string {
    return this._companyId;
  }

  get name(): string {
    return this._name;
  }

  /**
   * Immutable after registration.
   */
  get personType(): PersonType {
    return this._personType;
  }

  /**
   * Unmasked CPF or CNPJ. Immutable after registration.
   */
  get document(): string {
    return this._document;
  }

  get email(): string | undefined {
    return this._email?.value;
  }

  get phone(): string | undefined {
    return this._phone;
  }

  get address(): PersonAddress | undefined {
    return this._address;
  }

  get roles(): PersonRole[] {
    return [...this._roles];
  }

  get isActive(): boolean {
    return this._isActive;
  }

  hasRole(role: PersonRole): boolean {
    return this._roles.has(role);
  }

  /**
   * Adds a classification. Re-adding a role the person already holds is a no-op
   * rather than an error, so the endpoint is idempotent.
   */
  addRole(role: PersonRole): Result<Person> {
    if (!PERSON_ROLES.has(role)) {
      return Result.failed(
        DomainError.create("VALIDATION_ERROR", `Invalid person role: ${role}`),
      );
    }

    if (!this._isActive) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "An inactive person cannot be classified",
        ),
      );
    }

    if (this._roles.has(role)) {
      return Result.success(this);
    }

    this._roles.add(role);
    this.setUpdatedAt();
    this.raiseEvent(
      new PersonRoleChanged(this.id, this._companyId, role, "ADDED"),
    );
    return Result.success(this);
  }

  /**
   * Removes a classification, refusing while an open record still references it:
   * CUSTOMER with unsettled charges, SUPPLIER with unsettled payables.
   */
  removeRole(role: PersonRole, counts: OpenRecordCounts): Result<Person> {
    if (!this._roles.has(role)) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          `Person is not classified as ${role}`,
        ),
      );
    }

    if (role === "CUSTOMER" && counts.openCharges > 0) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Person has ${counts.openCharges} open charge(s) and cannot stop being a CUSTOMER`,
        ),
      );
    }

    if (role === "SUPPLIER" && counts.openPayables > 0) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Person has ${counts.openPayables} open payable(s) and cannot stop being a SUPPLIER`,
        ),
      );
    }

    this._roles.delete(role);
    this.setUpdatedAt();
    this.raiseEvent(
      new PersonRoleChanged(this.id, this._companyId, role, "REMOVED"),
    );
    return Result.success(this);
  }

  /**
   * Edits the mutable fields. Passing `null` clears an optional field.
   */
  edit(input: EditPersonInput): Result<Person> {
    if (!this._isActive) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "An inactive person cannot be edited",
        ),
      );
    }

    try {
      if (input.name !== undefined) {
        const name = input.name.trim();
        if (name.length === 0) {
          throw DomainError.create(
            "VALIDATION_ERROR",
            "Person name is required",
          );
        }
        this._name = name;
      }

      if (input.email !== undefined) {
        this._email =
          input.email === null || input.email.trim().length === 0
            ? undefined
            : Email.create(input.email);
      }

      if (input.phone !== undefined) {
        this._phone =
          input.phone === null ? undefined : input.phone.trim() || undefined;
      }

      if (input.address !== undefined) {
        this._address = input.address === null ? undefined : input.address;
      }
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }

    this.setUpdatedAt();
    this.raiseEvent(new PersonEdited(this.id, this._companyId, this._name));
    return Result.success(this);
  }

  /**
   * Deactivates the person. People are never physically deleted, and the
   * deactivation is blocked while any charge or payable is still unsettled.
   */
  deactivate(counts: OpenRecordCounts): Result<Person> {
    if (!this._isActive) {
      return Result.failed(
        DomainError.create("INVALID_OPERATION", "Person is already inactive"),
      );
    }

    if (counts.openCharges > 0) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Person has ${counts.openCharges} open charge(s) and cannot be deactivated`,
        ),
      );
    }

    if (counts.openPayables > 0) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Person has ${counts.openPayables} open payable(s) and cannot be deactivated`,
        ),
      );
    }

    this._isActive = false;
    this.setUpdatedAt();
    this.raiseEvent(new PersonDeactivated(this.id, this._companyId));
    return Result.success(this);
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this._companyId,
      name: this._name,
      personType: this._personType,
      document: this._document,
      email: this._email?.value,
      phone: this._phone,
      address: this._address,
      roles: this.roles,
      isActive: this._isActive,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Registers a person, validating the document against the person type.
   * Uniqueness of the document inside the company is a repository concern.
   */
  static create(input: CreatePersonInput): Result<Person> {
    try {
      const person = new Person({
        id: input.id ?? randomUUID(),
        companyId: input.companyId,
        name: input.name,
        personType: input.personType,
        document: input.document,
        email: input.email,
        phone: input.phone,
        address: input.address,
        roles: input.roles,
      });

      person.raiseEvent(
        new PersonRegistered(
          person.id,
          person.companyId,
          person.name,
          person.personType,
          person.document,
          person.roles,
        ),
      );

      return Result.success(person);
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }
  }
}
