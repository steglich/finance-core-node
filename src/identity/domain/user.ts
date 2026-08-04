import { Entity } from "../../shared/domain/entity.js";
import type { DomainEvent } from "../../shared/domain/domain-event.js";

/**
 * User status enumeration.
 */
export type UserStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED";

/**
 * Domain events for User entity.
 * Note: These are plain objects that will be published via the event bus.
 */
export interface UserRegistered {
  eventName: "UserRegistered";
  userId: string;
  email: string;
  name: string;
  companyId: string;
}

/**
 * Factory function to create a UserRegistered event.
 */
export function createUserRegistered(
  userId: string,
  email: string,
  name: string,
  companyId: string,
): UserRegistered {
  return {
    eventName: "UserRegistered",
    userId,
    email,
    name,
    companyId,
  };
}

/**
 * User entity.
 * Represents a user in the system with authentication credentials and profile information.
 */
export class User extends Entity<string> {
  private readonly _email: string;
  private readonly _name: string;
  private readonly _passwordHash: string;
  private _status: UserStatus;

  constructor(
    id: string,
    email: string,
    name: string,
    passwordHash: string,
    status: UserStatus = "ACTIVE",
    createdAt?: Date,
  ) {
    super(id, createdAt);
    this._email = email.toLowerCase().trim();
    this._name = name.trim();
    this._passwordHash = passwordHash;
    this._status = status;
  }

  get email(): string {
    return this._email;
  }

  get name(): string {
    return this._name;
  }

  get passwordHash(): string {
    return this._passwordHash;
  }

  get status(): UserStatus {
    return this._status;
  }

  isActive(): boolean {
    return this._status === "ACTIVE";
  }

  activate(): void {
    this._status = "ACTIVE";
    this.setUpdatedAt();
  }

  deactivate(): void {
    this._status = "INACTIVE";
    this.setUpdatedAt();
  }

  suspend(): void {
    this._status = "SUSPENDED";
    this.setUpdatedAt();
  }

  updateName(name: string): User {
    return new User(
      this.id,
      this._email,
      name.trim(),
      this._passwordHash,
      this._status,
      this.createdAt,
    );
  }

  updatePassword(passwordHash: string): void {
    Object.assign(this, { _passwordHash: passwordHash });
    this.setUpdatedAt();
  }

  toJSON(): unknown {
    return {
      id: this.id,
      email: this.email,
      name: this.name,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
