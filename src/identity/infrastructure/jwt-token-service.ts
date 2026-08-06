import jwt from "jsonwebtoken";
import { DomainError } from "../../shared/domain/domain-error.js";

/**
 * JWT Token Service interface for generating and verifying tokens.
 */
export interface JwtTokenService {
  /**
   * Generates an access token with short expiration (15 minutes).
   */
  generateAccessToken(payload: { userId: string; companyId: string }): string;

  /**
   * Generates a refresh token with longer expiration (7 days).
   */
  generateRefreshToken(payload: { userId: string; companyId: string }): string;

  /**
   * Verifies and decodes an access token.
   */
  verifyAccessToken(token: string): { userId: string; companyId: string };

  /**
   * Verifies and decodes a refresh token.
   */
  verifyRefreshToken(token: string): { userId: string; companyId: string };

  /**
   * Decodes a token without verification (for introspection).
   */
  decodeToken(token: string): unknown;
}

/** Distinguishes the two token kinds. Carried in the `typ` claim. */
type TokenType = "access" | "refresh";

interface TokenPayload {
  userId: string;
  companyId: string;
}

interface DecodedToken extends TokenPayload {
  typ?: string;
}

/**
 * JWT-based implementation of JwtTokenService.
 *
 * Access and refresh tokens are signed with the same secret but are not
 * interchangeable: each carries a `typ` claim, an issuer and an audience, all
 * three verified on the way back in. Without them a 7-day refresh token passes
 * as a 15-minute access token, which defeats the whole point of the short
 * access lifetime.
 */
class JsonWebTokenService implements JwtTokenService {
  constructor(
    private readonly secretKey: string,
    private readonly issuer: string,
    private readonly audience: string,
  ) {}

  generateAccessToken(payload: TokenPayload): string {
    return this.sign(payload, "access", "15m");
  }

  generateRefreshToken(payload: TokenPayload): string {
    return this.sign(payload, "refresh", "7d");
  }

  verifyAccessToken(token: string): TokenPayload {
    return this.verify(token, "access", "Invalid token");
  }

  verifyRefreshToken(token: string): TokenPayload {
    return this.verify(token, "refresh", "Invalid refresh token");
  }

  decodeToken(token: string): unknown {
    return jwt.decode(token);
  }

  private sign(
    payload: TokenPayload,
    typ: TokenType,
    expiresIn: "15m" | "7d",
  ): string {
    return jwt.sign({ ...payload, typ }, this.secretKey, {
      expiresIn,
      issuer: this.issuer,
      audience: this.audience,
    });
  }

  /**
   * Verifies signature, expiry, issuer and audience through `jsonwebtoken`, and
   * the token type explicitly — a token used in the wrong role is rejected the
   * same way an invalid one is, with no hint of which check failed.
   */
  private verify(
    token: string,
    expected: TokenType,
    fallbackMessage: string,
  ): TokenPayload {
    try {
      const decoded = jwt.verify(token, this.secretKey, {
        issuer: this.issuer,
        audience: this.audience,
      }) as DecodedToken;

      if (decoded.typ !== expected) {
        throw DomainError.create(
          "UNAUTHORIZED",
          `Expected ${expected} token`,
        );
      }

      return { userId: decoded.userId, companyId: decoded.companyId };
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw DomainError.create(
        "UNAUTHORIZED",
        error instanceof Error ? error.message : fallbackMessage,
      );
    }
  }
}

/**
 * Minimum length of the signing secret, in bytes. A shorter secret is within
 * brute-force reach of an offline attacker holding a single issued token.
 */
export const MIN_JWT_SECRET_BYTES = 32;

/**
 * Issuer and audience bind a token to this deployment. Without them a token
 * signed by another environment sharing the secret would be accepted here.
 */
export const DEFAULT_JWT_ISSUER = "finance-core";
export const DEFAULT_JWT_AUDIENCE = "finance-core-api";

/**
 * Creates a JwtTokenService instance.
 *
 * The secret is validated here, at startup, so a weak or missing one fails the
 * process instead of being accepted silently and signing tokens for months.
 */
export function createJwtTokenService(): JwtTokenService {
  const secretKey = process.env.JWT_SECRET;
  if (!secretKey) {
    throw new Error("JWT_SECRET environment variable is required");
  }

  const secretBytes = Buffer.byteLength(secretKey, "utf8");
  if (secretBytes < MIN_JWT_SECRET_BYTES) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_JWT_SECRET_BYTES} bytes long; got ${secretBytes}`,
    );
  }

  return new JsonWebTokenService(
    secretKey,
    process.env.JWT_ISSUER ?? DEFAULT_JWT_ISSUER,
    process.env.JWT_AUDIENCE ?? DEFAULT_JWT_AUDIENCE,
  );
}
