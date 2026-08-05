import { randomUUID } from "node:crypto";
import { Entity } from "../../shared/domain/entity.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";

/**
 * Input for creating a new wallet.
 */
export interface CreateWalletInput {
  id?: string;
  companyId: string;
  name: string;
  institution?: string;
}

/**
 * Wallet entity.
 * Represents the institution (bank, broker, cash drawer) that holds accounts.
 */
export class Wallet extends Entity<string> {
  private readonly _companyId: string;
  private readonly _name: string;
  private readonly _institution: string | undefined;

  constructor(
    id: string,
    companyId: string,
    name: string,
    institution?: string,
    createdAt?: Date,
  ) {
    super(id, createdAt);

    const trimmedName = name.trim();

    if (trimmedName.length === 0) {
      throw DomainError.create("VALIDATION_ERROR", "Wallet name is required");
    }

    if (companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Wallet requires a company",
      );
    }

    this._companyId = companyId;
    this._name = trimmedName;
    this._institution = institution?.trim() || undefined;
  }

  get companyId(): string {
    return this._companyId;
  }

  get name(): string {
    return this._name;
  }

  get institution(): string | undefined {
    return this._institution;
  }

  rename(name: string): Wallet {
    return new Wallet(
      this.id,
      this._companyId,
      name,
      this._institution,
      this.createdAt,
    );
  }

  changeInstitution(institution: string | undefined): Wallet {
    return new Wallet(
      this.id,
      this._companyId,
      this._name,
      institution,
      this.createdAt,
    );
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this.companyId,
      name: this.name,
      institution: this.institution,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Creates a wallet, returning a failed Result instead of throwing on invalid input.
   */
  static create(input: CreateWalletInput): Result<Wallet> {
    try {
      return Result.success(
        new Wallet(
          input.id ?? randomUUID(),
          input.companyId,
          input.name,
          input.institution,
        ),
      );
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }
  }
}
