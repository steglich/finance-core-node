import { Entity } from "../../shared/domain/entity.js";

/**
 * Permission action types.
 */
export type PermissionAction = "READ" | "WRITE" | "DELETE" | "MANAGE";

/**
 * Permission resource types (subset for Phase 1).
 */
export type PermissionResource =
  | "users"
  | "companies"
  | "profiles"
  | "accounts"
  | "categories"
  | "transactions"
  | "installments"
  | "transfers"
  | "recurrences"
  | "audit";

/**
 * Permission value object.
 */
export class Permission {
  constructor(
    public readonly resource: PermissionResource,
    public readonly action: PermissionAction,
  ) {}

  equals(other: Permission): boolean {
    return this.resource === other.resource && this.action === other.action;
  }

  toJSON(): unknown {
    return {
      resource: this.resource,
      action: this.action,
    };
  }
}

/**
 * Profile entity.
 * Represents a user's role within a company with associated permissions.
 */
export class Profile extends Entity<string> {
  private readonly _companyId: string;
  private readonly _name: string;
  private _permissions: Permission[];

  constructor(
    id: string,
    companyId: string,
    name: string,
    permissions?: Permission[],
    createdAt?: Date,
  ) {
    super(id, createdAt);
    this._companyId = companyId;
    this._name = name.trim();
    this._permissions = permissions ? [...permissions] : [];
  }

  get companyId(): string {
    return this._companyId;
  }

  get name(): string {
    return this._name;
  }

  get permissions(): Permission[] {
    return [...this._permissions];
  }

  hasPermission(
    resource: PermissionResource,
    action: PermissionAction,
  ): boolean {
    return this._permissions.some(
      (p) => p.resource === resource && p.action === action,
    );
  }

  addPermission(
    resource: PermissionResource,
    action: PermissionAction,
  ): Profile {
    const permission = new Permission(resource, action);
    if (!this._permissions.some((p) => p.equals(permission))) {
      return new Profile(
        this.id,
        this._companyId,
        this._name,
        [...this._permissions, permission],
        this.createdAt,
      );
    }
    return this;
  }

  removePermission(
    resource: PermissionResource,
    action: PermissionAction,
  ): { profile: Profile; hadPermission: boolean } {
    const index = this._permissions.findIndex(
      (p) => p.resource === resource && p.action === action,
    );
    if (index >= 0) {
      return {
        profile: new Profile(
          this.id,
          this._companyId,
          this._name,
          [
            ...this._permissions.slice(0, index),
            ...this._permissions.slice(index + 1),
          ],
          this.createdAt,
        ),
        hadPermission: true,
      };
    }
    return { profile: this, hadPermission: false };
  }

  updatePermissions(permissions: Permission[]): Profile {
    return new Profile(
      this.id,
      this._companyId,
      this._name,
      permissions,
      this.createdAt,
    );
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this.companyId,
      name: this.name,
      permissions: this.permissions.map((p) => p.toJSON()),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
