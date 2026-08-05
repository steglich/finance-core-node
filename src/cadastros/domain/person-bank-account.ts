import { randomUUID } from "node:crypto";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Entity } from "../../shared/domain/entity.js";
import { PixKey } from "../../shared/domain/pix-key.js";
import type { PixKeyType } from "../../shared/domain/pix-key.js";
import { Result } from "../../shared/domain/result.js";
import type { Person } from "./person.js";

/**
 * Constructor properties for rehydrating a bank account from persistence.
 */
export interface PersonBankAccountProps {
  id: string;
  companyId: string;
  personId: string;
  label: string;
  pixKey?: string | undefined;
  bank?: string | undefined;
  branch?: string | undefined;
  accountNumber?: string | undefined;
  isDefault?: boolean;
  createdAt?: Date;
}

/**
 * Input for registering bank details for a payee.
 */
export interface CreatePersonBankAccountInput {
  id?: string;
  companyId: string;
  person: Person;
  label: string;
  pixKey?: string | undefined;
  bank?: string | undefined;
  branch?: string | undefined;
  accountNumber?: string | undefined;
  isDefault?: boolean | undefined;
}

/**
 * Mutable fields of a bank account.
 */
export interface EditPersonBankAccountInput {
  label?: string | undefined;
  pixKey?: string | null | undefined;
  bank?: string | null | undefined;
  branch?: string | null | undefined;
  accountNumber?: string | null | undefined;
}

/**
 * Bank details of a payee: either a PIX key or a bank/branch/account triple.
 * A child entity of the `Person` aggregate — it never exists on its own.
 */
export class PersonBankAccount extends Entity<string> {
  private readonly _companyId: string;
  private readonly _personId: string;
  private _label: string;
  private _pixKey: PixKey | undefined;
  private _bank: string | undefined;
  private _branch: string | undefined;
  private _accountNumber: string | undefined;
  private _isDefault: boolean;

  constructor(props: PersonBankAccountProps) {
    super(props.id, props.createdAt);

    const label = props.label.trim();

    if (props.companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Bank account requires a company",
      );
    }

    if (props.personId.trim().length === 0) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Bank account requires a person",
      );
    }

    if (label.length === 0) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Bank account label is required",
      );
    }

    const pixKey = props.pixKey ? PixKey.create(props.pixKey) : undefined;
    const bank = props.bank?.trim() || undefined;
    const branch = props.branch?.trim() || undefined;
    const accountNumber = props.accountNumber?.trim() || undefined;

    // One of the two ways of being paid must be there — otherwise the record
    // says nothing about where the money should go.
    if (!pixKey && !(bank && branch && accountNumber)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Bank account requires either a PIX key or bank, branch and account number",
      );
    }

    this._companyId = props.companyId;
    this._personId = props.personId;
    this._label = label;
    this._pixKey = pixKey;
    this._bank = bank;
    this._branch = branch;
    this._accountNumber = accountNumber;
    this._isDefault = props.isDefault ?? false;
  }

  get companyId(): string {
    return this._companyId;
  }

  get personId(): string {
    return this._personId;
  }

  get label(): string {
    return this._label;
  }

  get pixKey(): string | undefined {
    return this._pixKey?.value;
  }

  get pixKeyType(): PixKeyType | undefined {
    return this._pixKey?.type;
  }

  get bank(): string | undefined {
    return this._bank;
  }

  get branch(): string | undefined {
    return this._branch;
  }

  get accountNumber(): string | undefined {
    return this._accountNumber;
  }

  get isDefault(): boolean {
    return this._isDefault;
  }

  edit(input: EditPersonBankAccountInput): Result<PersonBankAccount> {
    // Everything is resolved into locals first, so an invalid value leaves the
    // entity untouched.
    try {
      let pixKey = this._pixKey;
      if (input.pixKey !== undefined) {
        pixKey =
          input.pixKey === null || input.pixKey.trim().length === 0
            ? undefined
            : PixKey.create(input.pixKey);
      }

      const label =
        input.label === undefined ? this._label : input.label.trim();
      if (label.length === 0) {
        throw DomainError.create(
          "VALIDATION_ERROR",
          "Bank account label is required",
        );
      }

      const resolve = (
        value: string | null | undefined,
        current: string | undefined,
      ): string | undefined =>
        value === undefined ? current : value === null ? undefined : value.trim() || undefined;

      const bank = resolve(input.bank, this._bank);
      const branch = resolve(input.branch, this._branch);
      const accountNumber = resolve(input.accountNumber, this._accountNumber);

      if (!pixKey && !(bank && branch && accountNumber)) {
        throw DomainError.create(
          "VALIDATION_ERROR",
          "Bank account requires either a PIX key or bank, branch and account number",
        );
      }

      this._label = label;
      this._pixKey = pixKey;
      this._bank = bank;
      this._branch = branch;
      this._accountNumber = accountNumber;
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }

    this.setUpdatedAt();
    return Result.success(this);
  }

  /**
   * Flags this account as the payee's default. Clearing the flag from the
   * previous default is the caller's job — see `makeDefault` below.
   */
  markAsDefault(): void {
    this._isDefault = true;
    this.setUpdatedAt();
  }

  clearDefault(): void {
    this._isDefault = false;
    this.setUpdatedAt();
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this._companyId,
      personId: this._personId,
      label: this._label,
      pixKey: this._pixKey?.value,
      pixKeyType: this._pixKey?.type,
      bank: this._bank,
      branch: this._branch,
      accountNumber: this._accountNumber,
      isDefault: this._isDefault,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Registers bank details for a person already classified as PAYEE.
   */
  static create(
    input: CreatePersonBankAccountInput,
  ): Result<PersonBankAccount> {
    try {
      const person = input.person;

      if (person.companyId !== input.companyId) {
        throw DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "Bank details can only be registered for a person of the same company",
        );
      }

      if (!person.hasRole("PAYEE")) {
        throw DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "Bank details can only be registered for a person classified as PAYEE",
        );
      }

      return Result.success(
        new PersonBankAccount({
          id: input.id ?? randomUUID(),
          companyId: input.companyId,
          personId: person.id,
          label: input.label,
          pixKey: input.pixKey,
          bank: input.bank,
          branch: input.branch,
          accountNumber: input.accountNumber,
          isDefault: input.isDefault ?? false,
        }),
      );
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }
  }

  /**
   * Makes `target` the single default among the payee's accounts, clearing the
   * flag from every other one so at most one default ever exists.
   */
  static makeDefault(
    accounts: readonly PersonBankAccount[],
    targetId: string,
  ): Result<PersonBankAccount[]> {
    const target = accounts.find((account) => account.id === targetId);
    if (!target) {
      return Result.failed(
        DomainError.create(
          "ENTITY_NOT_FOUND",
          `Bank account ${targetId} was not found`,
        ),
      );
    }

    const changed: PersonBankAccount[] = [];
    for (const account of accounts) {
      if (account.id === targetId) {
        if (!account.isDefault) {
          account.markAsDefault();
          changed.push(account);
        }
      } else if (account.isDefault) {
        account.clearDefault();
        changed.push(account);
      }
    }

    return Result.success(changed);
  }
}
