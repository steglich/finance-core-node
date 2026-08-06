import type { DomainError } from "../../shared/domain/domain-error.js";
import bcrypt from "bcrypt";

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

  /**
   * Performs a verification against a throwaway hash and discards the result.
   *
   * Used when no account matches the submitted email, so that path spends the
   * same CPU as the real one. An artificial delay would not do: it leaves the
   * cheap request cheap for the server, which is the asymmetry an attacker
   * exploits.
   */
  verifyDiscarded(plainText: string): Promise<void>;
}

/**
 * Bcrypt-based password service implementation.
 */
class BcryptPasswordService implements PasswordService {
  private readonly saltRounds = 12;

  /**
   * Hashed once, when the service is built, so the first unknown-email login is
   * no slower than the ones after it. The plaintext behind it is never a valid
   * credential — nothing authenticates against this hash.
   */
  private readonly discardHash: Promise<string> = bcrypt.hash(
    "discarded-comparison-subject",
    this.saltRounds,
  );

  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  async verify(plainText: string, hashed: string): Promise<boolean> {
    return bcrypt.compare(plainText, hashed);
  }

  async verifyDiscarded(plainText: string): Promise<void> {
    await bcrypt.compare(plainText, await this.discardHash);
  }
}

/**
 * Creates a PasswordService instance.
 */
export function createPasswordService(): PasswordService {
  return new BcryptPasswordService();
}
