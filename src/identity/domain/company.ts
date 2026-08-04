import { Entity } from "../../shared/domain/entity.js";

/**
 * Company type enumeration (re-exported for convenience).
 */
export type { CompanyTypeValue } from "./company-type.js";
import { CompanyType, type CompanyTypeValue } from "./company-type.js";

/**
 * Domain events for Company entity.
 */
export interface UserAddedToCompany {
  eventName: "UserAddedToCompany";
  companyId: string;
  userId: string;
  profileId: string;
}

/**
 * Factory function to create a UserAddedToCompany event.
 */
export function createUserAddedToCompany(
  companyId: string,
  userId: string,
  profileId: string,
): UserAddedToCompany {
  return {
    eventName: "UserAddedToCompany",
    companyId,
    userId,
    profileId,
  };
}

/**
 * Company entity.
 * Represents a business/company in the multi-tenant system.
 */
export class Company extends Entity<string> {
  private readonly _name: string;
  private readonly _type: CompanyTypeValue;
  private readonly _defaultCurrency: string;
  private _userIds: Set<string>;

  constructor(
    id: string,
    name: string,
    type: CompanyTypeValue,
    defaultCurrency: string = "BRL",
    userIds?: string[],
    createdAt?: Date,
  ) {
    super(id, createdAt);
    this._name = name.trim();
    this._type = type;
    this._defaultCurrency = defaultCurrency.toUpperCase();
    this._userIds = new Set(userIds ?? []);
  }

  get name(): string {
    return this._name;
  }

  get type(): CompanyTypeValue {
    return this._type;
  }

  get defaultCurrency(): string {
    return this._defaultCurrency;
  }

  get userIds(): string[] {
    return [...this._userIds];
  }

  hasUser(userId: string): boolean {
    return this._userIds.has(userId);
  }

  addUser(userId: string, profileId?: string): Company {
    const newInstance = new Company(
      this.id,
      this._name,
      this._type,
      this._defaultCurrency,
      [...this._userIds, userId],
      this.createdAt,
    );
    return newInstance;
  }

  removeUser(userId: string): { company: Company; hadUser: boolean } {
    const hadUser = this._userIds.has(userId);
    if (!hadUser) {
      return { company: this, hadUser: false };
    }
    const newInstance = new Company(
      this.id,
      this._name,
      this._type,
      this._defaultCurrency,
      [...this._userIds].filter((id) => id !== userId),
      this.createdAt,
    );
    return { company: newInstance, hadUser: true };
  }

  updateName(name: string): Company {
    return new Company(
      this.id,
      name.trim(),
      this._type,
      this._defaultCurrency,
      [...this._userIds],
      this.createdAt,
    );
  }

  toJSON(): unknown {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      defaultCurrency: this.defaultCurrency,
      userIds: this.userIds,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
