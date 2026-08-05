import type { ControllerResult } from "../../shared/api/controller-result.js";
import type { UserRepository } from "../infrastructure/user-repository.js";
import type { CompanyRepository } from "../infrastructure/company-repository.js";
import type { ProfileRepository } from "../infrastructure/profile-repository.js";
import type { PasswordService } from "../domain/password-service.js";
import type { JwtTokenService } from "../infrastructure/jwt-token-service.js";
import type { CategoryRepository } from "../../financeiro/infrastructure/category-repository.js";
import type { DatabaseConnection } from "../../shared/infrastructure/database-connection.js";
import { UserService, CompanyService } from "../domain/user-service.js";
import {
  validateLoginRequest,
  validateRecoverPasswordRequest,
  validateRefreshTokenRequest,
  validateRegisterUserRequest,
  validateResetPasswordRequest,
} from "./dtos.js";

/**
 * Authentication controller handling auth endpoints.
 *
 * Controllers receive already-parsed input and return a `ControllerResult`.
 * Domain errors are thrown and translated to HTTP by the server error handler.
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
  async register(body: unknown): Promise<ControllerResult> {
    const validation = validateRegisterUserRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const userService = new UserService(
      this.userRepository,
      this.companyRepository,
      this.profileRepository,
      this.passwordService,
    );

    // Create user with personal company (RN-08)
    const result = await this.databaseConnection.transaction(async () => {
      const { user } = await userService.create(validation.data);

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

    const tokens = this.issueTokens(result.user.id, result.companyId);

    return {
      statusCode: 201,
      body: {
        user: result.user.toJSON(),
        tokens,
        companyId: result.companyId,
      },
    };
  }

  /**
   * Handles POST /api/v1/auth/login.
   */
  async login(body: unknown): Promise<ControllerResult> {
    const validation = validateLoginRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const userService = new UserService(
      this.userRepository,
      this.companyRepository,
      this.profileRepository,
      this.passwordService,
    );

    const result = await userService.authenticate(
      validation.data.email,
      validation.data.password,
    );

    const companyIds = await this.companyRepository.findUserCompanies(
      result.user.id,
    );

    // The token is scoped to the first company until the user selects another
    const tokens = this.issueTokens(result.user.id, companyIds[0] ?? "");

    return {
      statusCode: 200,
      body: {
        user: result.user.toJSON(),
        tokens,
        companies: companyIds.map((id) => ({ id })),
      },
    };
  }

  /**
   * Handles POST /api/v1/auth/refresh.
   */
  async refresh(body: unknown): Promise<ControllerResult> {
    const validation = validateRefreshTokenRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    let decoded: { userId: string; companyId: string };
    try {
      decoded = this.jwtTokenService.verifyRefreshToken(
        validation.data.refreshToken,
      );
    } catch {
      return {
        statusCode: 401,
        body: { error: "Invalid or expired refresh token" },
      };
    }

    return {
      statusCode: 200,
      body: { tokens: this.issueTokens(decoded.userId, decoded.companyId) },
    };
  }

  /**
   * Handles POST /api/v1/auth/recover-password.
   */
  async recoverPassword(body: unknown): Promise<ControllerResult> {
    const validation = validateRecoverPasswordRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    // In a real implementation, this would send an email with a reset token.
    // The response never reveals whether the email exists.
    return {
      statusCode: 200,
      body: { message: "If the email exists, a reset link has been sent" },
    };
  }

  /**
   * Handles POST /api/v1/auth/reset-password.
   */
  async resetPassword(body: unknown): Promise<ControllerResult> {
    const validation = validateResetPasswordRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    // In a real implementation, this would verify the token and update the password
    return {
      statusCode: 200,
      body: { message: "Password has been reset successfully" },
    };
  }

  private issueTokens(
    userId: string,
    companyId: string,
  ): { accessToken: string; refreshToken: string } {
    const payload = { userId, companyId };
    return {
      accessToken: this.jwtTokenService.generateAccessToken(payload),
      refreshToken: this.jwtTokenService.generateRefreshToken(payload),
    };
  }
}
