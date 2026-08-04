import type { DomainError } from "../../shared/domain/domain-error.js";

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
const bcrypt = require("bcrypt");

/**
 * Password Service interface for hashing and verifying passwords.
 */
export interface PasswordService {
  /**
   * Hashes a plain text password using bcrypt.
   */
  hash(password: string): Promise<string>;

  /**
   * Verifies a plain text password against a hashed version.
   */
  verify(plainText: string, hashed: string): Promise<boolean>;
}

/**
 * Bcrypt-based password service implementation.
 */
class BcryptPasswordService implements PasswordService {
  private readonly saltRounds = 12;

  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  async verify(plainText: string, hashed: string): Promise<boolean> {
    return bcrypt.compare(plainText, hashed);
  }
}

/**
 * Creates a PasswordService instance.
 */
export function createPasswordService(): PasswordService {
  return new BcryptPasswordService();
}
