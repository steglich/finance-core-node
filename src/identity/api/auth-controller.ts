import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { UserRepository } from "../infrastructure/user-repository.js";
import type { CompanyRepository } from "../infrastructure/company-repository.js";
import type { ProfileRepository } from "../infrastructure/profile-repository.js";
import type { PasswordService } from "../domain/password-service.js";
import type { JwtTokenService } from "../infrastructure/jwt-token-service.js";
import type { CategoryRepository } from "../../financeiro/infrastructure/category-repository.js";
import {
  AccessLog,
  type AccessEventType,
} from "../../auditoria/domain/access-log.js";
import type { AccessLogRepository } from "../../auditoria/infrastructure/audit-repository.js";
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
    private readonly accessLogRepository?: AccessLogRepository,
  ) {}

  /**
   * Records an authentication event. Writing the trail must never break the
   * request, so failures are swallowed after being surfaced by the repository.
   */
  private logAccess(
    eventType: AccessEventType,
    email: string,
    userId?: string,
    ipAddress?: string,
  ): void {
    if (!this.accessLogRepository) {
      return;
    }

    const log = new AccessLog({ eventType, email, userId, ipAddress });
    void this.accessLogRepository.append(log).catch(() => undefined);
  }

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
  async login(body: unknown, ipAddress?: string): Promise<ControllerResult> {
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

    let result;
    try {
      result = await userService.authenticate(
        validation.data.email,
        validation.data.password,
      );
    } catch (error) {
      // Failed attempts are part of the access trail, not just an error path
      this.logAccess("LOGIN_FAILED", validation.data.email, undefined, ipAddress);
      throw error;
    }

    this.logAccess(
      "LOGIN_SUCCESS",
      validation.data.email,
      result.user.id,
      ipAddress,
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

    // A refresh token lives for 7 days; the access it stands for may not.
    // Re-check the subject before minting anything, so a user deactivated or
    // removed from the company cannot keep operating until the token expires.
    const user = await this.userRepository.findById(decoded.userId);
    if (!user || !user.isActive()) {
      return {
        statusCode: 401,
        body: { error: "Invalid or expired refresh token" },
      };
    }

    const companyIds = await this.companyRepository.findUserCompanies(
      decoded.userId,
    );
    if (!companyIds.includes(decoded.companyId)) {
      return {
        statusCode: 401,
        body: { error: "Invalid or expired refresh token" },
      };
    }

    // Both tokens are reissued: the refresh token rotates on every renewal.
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

    // The reset flow — recovery token issued, persisted and verified — does not
    // exist yet. Answering 200 would tell the client a password changed when
    // none did; saying so plainly is the only honest response until it exists.
    throw DomainError.create(
      "NOT_IMPLEMENTED",
      "Password reset is not implemented yet",
    );
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
