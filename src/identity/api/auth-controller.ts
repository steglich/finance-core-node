import type { IncomingMessage } from "node:http";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { UserRepository } from "../infrastructure/user-repository.js";
import type { CompanyRepository } from "../infrastructure/company-repository.js";
import type { ProfileRepository } from "../infrastructure/profile-repository.js";
import type { PasswordService } from "../domain/password-service.js";
import type { JwtTokenService } from "../infrastructure/jwt-token-service.js";
import type { CategoryRepository } from "../../financeiro/infrastructure/category-repository.js";
import type { DatabaseConnection } from "../../shared/infrastructure/database-connection.js";
import { User } from "../domain/user.js";
import { Email } from "../domain/email.js";
import { UserService, CompanyService } from "../domain/user-service.js";
import {
  validateRegisterUserRequest,
  type RegisterUserRequest,
} from "./dtos.js";

/**
 * Authentication controller handling auth endpoints.
 */
export class AuthController {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly companyRepository: CompanyRepository,
    private readonly profileRepository: ProfileRepository,
    private readonly passwordService: PasswordService,
    private readonly jwtTokenService: JwtTokenService,
    private readonly categoryRepository: CategoryRepository,
    private readonly databaseConnection: DatabaseConnection,
  ) {}

  /**
   * Handles POST /api/v1/auth/register.
   */
  async register(
    req: IncomingMessage,
  ): Promise<{ statusCode: number; body: unknown }> {
    let rawBody: RegisterUserRequest;
    try {
      const parsed = await this.parseBody(req);
      rawBody = parsed as RegisterUserRequest;
    } catch {
      return {
        statusCode: 400,
        body: { error: "Invalid JSON body" },
      };
    }

    const validation = validateRegisterUserRequest(rawBody);
    if (!validation.success) {
      return {
        statusCode: 400,
        body: { error: validation.error.message },
      };
    }

    try {
      const userService = new UserService(
        this.userRepository,
        this.companyRepository,
        this.profileRepository,
        this.passwordService,
      );

      // Create user with personal company (RN-08)
      const result = await this.databaseConnection.transaction(async () => {
        const { user } = await userService.create(validation.data);

        // Create personal company for the user
        const companyService = new CompanyService(
          this.companyRepository,
          this.categoryRepository,
        );

        const companyResult = await companyService.create({
          name: `${validation.data.name}'s Company`,
          type: "INDIVIDUAL" as const,
          defaultCurrency: "BRL",
        });

        // Add user to their own company with admin profile
        await this.companyRepository.addUser(
          companyResult.companyId,
          user.id,
          undefined,
        );

        return { user, companyId: companyResult.companyId };
      });

      // Generate tokens
      const accessToken = this.jwtTokenService.generateAccessToken({
        userId: result.user.id,
        companyId: result.companyId,
      });
      const refreshToken = this.jwtTokenService.generateRefreshToken({
        userId: result.user.id,
        companyId: result.companyId,
      });

      return {
        statusCode: 201,
        body: {
          user: result.user.toJSON(),
          tokens: { accessToken, refreshToken },
          companyId: result.companyId,
        },
      };
    } catch (error) {
      const domainError = error as DomainError;
      if (domainError instanceof DomainError) {
        return {
          statusCode: this.toHttpStatusCode(domainError.code),
          body: { error: domainError.message },
        };
      }
      throw error;
    }
  }

  /**
   * Handles POST /api/v1/auth/login.
   */
  async login(
    req: IncomingMessage,
  ): Promise<{ statusCode: number; body: unknown }> {
    let rawBody: { email: string; password: string };
    try {
      const parsed = await this.parseBody(req);
      rawBody = parsed as { email: string; password: string };
    } catch {
      return {
        statusCode: 400,
        body: { error: "Invalid JSON body" },
      };
    }

    // Validate email format - Email constructor throws if invalid
    let email: Email;
    try {
      email = new Email(rawBody.email);
    } catch (error) {
      return {
        statusCode: 400,
        body: { error: "Valid email is required" },
      };
    }

    try {
      const userService = new UserService(
        this.userRepository,
        this.companyRepository,
        this.profileRepository,
        this.passwordService,
      );

      const result = await userService.authenticate(
        email.value,
        rawBody.password,
      );

      // Get user's companies
      const companyIds = await this.companyRepository.findUserCompanies(
        result.user.id,
      );

      // Generate tokens (use first company or empty string)
      const accessToken = this.jwtTokenService.generateAccessToken({
        userId: result.user.id,
        companyId: companyIds[0] ?? "",
      });
      const refreshToken = this.jwtTokenService.generateRefreshToken({
        userId: result.user.id,
        companyId: companyIds[0] ?? "",
      });

      return {
        statusCode: 200,
        body: {
          user: result.user.toJSON(),
          tokens: { accessToken, refreshToken },
          companies: companyIds.map((id) => ({ id })),
        },
      };
    } catch (error) {
      const domainError = error as DomainError;
      if (domainError instanceof DomainError) {
        return {
          statusCode: this.toHttpStatusCode(domainError.code),
          body: { error: domainError.message },
        };
      }
      throw error;
    }
  }

  /**
   * Handles POST /api/v1/auth/refresh.
   */
  async refresh(
    req: IncomingMessage,
  ): Promise<{ statusCode: number; body: unknown }> {
    let rawBody: { refreshToken: string };
    try {
      const parsed = await this.parseBody(req);
      rawBody = parsed as { refreshToken: string };
    } catch {
      return {
        statusCode: 400,
        body: { error: "Invalid JSON body" },
      };
    }

    try {
      const decoded = this.jwtTokenService.verifyRefreshToken(
        rawBody.refreshToken,
      );

      // Generate new tokens
      const accessToken = this.jwtTokenService.generateAccessToken(decoded);
      const refreshToken = this.jwtTokenService.generateRefreshToken(decoded);

      return {
        statusCode: 200,
        body: { tokens: { accessToken, refreshToken } },
      };
    } catch {
      return {
        statusCode: 401,
        body: { error: "Invalid or expired refresh token" },
      };
    }
  }

  /**
   * Handles POST /api/v1/auth/recover-password.
   */
  async recoverPassword(
    req: IncomingMessage,
  ): Promise<{ statusCode: number; body: unknown }> {
    let rawBody: { email: string };
    try {
      const parsed = await this.parseBody(req);
      rawBody = parsed as { email: string };
    } catch {
      return {
        statusCode: 400,
        body: { error: "Invalid JSON body" },
      };
    }

    // In a real implementation, this would send an email with a reset token
    // For now, we just acknowledge the request without exposing whether the user exists
    return {
      statusCode: 200,
      body: { message: "If the email exists, a reset link has been sent" },
    };
  }

  /**
   * Handles POST /api/v1/auth/reset-password.
   */
  async resetPassword(
    req: IncomingMessage,
  ): Promise<{ statusCode: number; body: unknown }> {
    let rawBody: { token: string; newPassword: string };
    try {
      const parsed = await this.parseBody(req);
      rawBody = parsed as { token: string; newPassword: string };
    } catch {
      return {
        statusCode: 400,
        body: { error: "Invalid JSON body" },
      };
    }

    // In a real implementation, this would verify the token and update the password
    return {
      statusCode: 200,
      body: { message: "Password has been reset successfully" },
    };
  }

  private async parseBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private toHttpStatusCode(code: DomainError["code"]): number {
    switch (code) {
      case "VALIDATION_ERROR":
        return 400;
      case "ENTITY_NOT_FOUND":
        return 404;
      case "DUPLICATE_ENTITY":
        return 409;
      case "UNAUTHORIZED_ACCESS":
      case "UNAUTHORIZED":
        return 401;
      default:
        return 500;
    }
  }
}
