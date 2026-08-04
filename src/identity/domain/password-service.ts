import { DomainError } from "../../shared/domain/domain-error.js";

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
  private bcrypt = require("bcrypt");

  async hash(password: string): Promise<string> {
    const saltRounds = 12;
    return this.bcrypt.hash(password, saltRounds);
  }

  async verify(plainText: string, hashed: string): Promise<boolean> {
    return this.bcrypt.compare(plainText, hashed);
  }
}

/**
 * Creates a PasswordService instance.
 */
export function createPasswordService(): PasswordService {
  return new BcryptPasswordService();
}
