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

/**
 * JWT-based implementation of JwtTokenService.
 */
class JsonWebTokenService implements JwtTokenService {
  constructor(private readonly secretKey: string) {}

  generateAccessToken(payload: { userId: string; companyId: string }): string {
    return jwt.sign(payload, this.secretKey, { expiresIn: "15m" });
  }

  generateRefreshToken(payload: { userId: string; companyId: string }): string {
    return jwt.sign(payload, this.secretKey, { expiresIn: "7d" });
  }

  verifyAccessToken(token: string): { userId: string; companyId: string } {
    try {
      const decoded = jwt.verify(token, this.secretKey) as {
        userId: string;
        companyId: string;
      };
      return decoded;
    } catch (error) {
      throw DomainError.create(
        "UNAUTHORIZED",
        error instanceof Error ? error.message : "Invalid token",
      );
    }
  }

  verifyRefreshToken(token: string): { userId: string; companyId: string } {
    try {
      const decoded = jwt.verify(token, this.secretKey) as {
        userId: string;
        companyId: string;
      };
      return decoded;
    } catch (error) {
      throw DomainError.create(
        "UNAUTHORIZED",
        error instanceof Error ? error.message : "Invalid refresh token",
      );
    }
  }

  decodeToken(token: string): unknown {
    return jwt.decode(token);
  }
}

/**
 * Creates a JwtTokenService instance.
 */
export function createJwtTokenService(): JwtTokenService {
  const secretKey = process.env.JWT_SECRET;
  if (!secretKey) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return new JsonWebTokenService(secretKey);
}
