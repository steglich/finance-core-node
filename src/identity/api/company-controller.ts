import type { IncomingMessage } from "node:http";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { CompanyRepository } from "../infrastructure/company-repository.js";
import type { UserRepository } from "../infrastructure/user-repository.js";
import type { ProfileRepository } from "../infrastructure/profile-repository.js";
import {
  validateCreateCompanyRequest,
  type CreateCompanyRequest,
} from "./dtos.js";

/**
 * Company controller handling company-related endpoints.
 */
export class CompanyController {
  constructor(
    private readonly companyRepository: CompanyRepository,
    private readonly userRepository: UserRepository,
    private readonly profileRepository: ProfileRepository,
  ) {}

  /**
   * Handles POST /api/v1/companies.
   */
  async create(
    req: IncomingMessage,
  ): Promise<{ statusCode: number; body: unknown }> {
    let rawBody: CreateCompanyRequest;
    try {
      const parsed = await this.parseBody(req);
      rawBody = parsed as CreateCompanyRequest;
    } catch {
      return {
        statusCode: 400,
        body: { error: "Invalid JSON body" },
      };
    }

    const validation = validateCreateCompanyRequest(rawBody);
    if (!validation.success) {
      return {
        statusCode: 400,
        body: { error: validation.error.message },
      };
    }

    try {
      // Import Company class dynamically to avoid circular dependency issues
      const { Company } = await import("../domain/company.js");

      const company = new Company(
        crypto.randomUUID(),
        validation.data.name,
        validation.data.type,
        validation.data.defaultCurrency,
      );

      // Create default categories would go here (requires CategoryRepository)
      // For now, just create the company
      await this.companyRepository.create(company);

      return {
        statusCode: 201,
        body: company.toJSON(),
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
   * Handles GET /api/v1/companies.
   */
  async list(userId: string): Promise<{ statusCode: number; body: unknown }> {
    try {
      const companyIds = await this.companyRepository.findUserCompanies(userId);
      const companies = [];

      for (const id of companyIds) {
        const company = await this.companyRepository.findById(id);
        if (company) {
          companies.push(company.toJSON());
        }
      }

      return {
        statusCode: 200,
        body: { companies },
      };
    } catch {
      return {
        statusCode: 500,
        body: { error: "Failed to list companies" },
      };
    }
  }

  /**
   * Handles POST /api/v1/companies/:id/users.
   */
  async inviteUser(
    companyId: string,
    req: IncomingMessage,
  ): Promise<{ statusCode: number; body: unknown }> {
    let rawBody: { email: string; profileId?: string };
    try {
      const parsed = await this.parseBody(req);
      rawBody = parsed as { email: string; profileId?: string };
    } catch {
      return {
        statusCode: 400,
        body: { error: "Invalid JSON body" },
      };
    }

    if (typeof rawBody.email !== "string") {
      return {
        statusCode: 400,
        body: { error: "Email is required" },
      };
    }

    try {
      // Find the user by email
      const user = await this.userRepository.findByEmail(rawBody.email);

      if (!user) {
        return {
          statusCode: 404,
          body: { error: "User not found" },
        };
      }

      // Add user to company
      await this.companyRepository.addUser(
        companyId,
        user.id,
        rawBody.profileId,
      );

      return {
        statusCode: 201,
        body: { message: "User invited successfully", userId: user.id },
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
   * Handles DELETE /api/v1/companies/:id/users/:userId.
   */
  async removeUser(
    companyId: string,
    userId: string,
  ): Promise<{ statusCode: number; body: unknown }> {
    try {
      const removed = await this.companyRepository.removeUser(
        companyId,
        userId,
      );

      if (!removed) {
        return {
          statusCode: 404,
          body: { error: "User is not a member of this company" },
        };
      }

      return {
        statusCode: 200,
        body: { message: "User removed successfully" },
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
      default:
        return 500;
    }
  }
}
