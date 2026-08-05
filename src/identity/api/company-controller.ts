import type { ControllerResult } from "../../shared/api/controller-result.js";
import type { CompanyRepository } from "../infrastructure/company-repository.js";
import type { UserRepository } from "../infrastructure/user-repository.js";
import type { ProfileRepository } from "../infrastructure/profile-repository.js";
import { Company } from "../domain/company.js";
import { validateCreateCompanyRequest, validateInviteUserRequest } from "./dtos.js";

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
  async create(body: unknown): Promise<ControllerResult> {
    const validation = validateCreateCompanyRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const company = new Company(
      crypto.randomUUID(),
      validation.data.name,
      validation.data.type,
      validation.data.defaultCurrency,
    );

    await this.companyRepository.create(company);

    return { statusCode: 201, body: company.toJSON() };
  }

  /**
   * Handles GET /api/v1/companies.
   */
  async list(userId: string): Promise<ControllerResult> {
    const companyIds = await this.companyRepository.findUserCompanies(userId);
    const companies = [];

    for (const id of companyIds) {
      const company = await this.companyRepository.findById(id);
      if (company) {
        companies.push(company.toJSON());
      }
    }

    return { statusCode: 200, body: { companies } };
  }

  /**
   * Handles POST /api/v1/companies/:companyId/users.
   */
  async inviteUser(
    companyId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateInviteUserRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const user = await this.userRepository.findByEmail(validation.data.email);
    if (!user) {
      return { statusCode: 404, body: { error: "User not found" } };
    }

    await this.companyRepository.addUser(
      companyId,
      user.id,
      validation.data.profileId,
    );

    return {
      statusCode: 201,
      body: { message: "User invited successfully", userId: user.id },
    };
  }

  /**
   * Handles DELETE /api/v1/companies/:companyId/users/:userId.
   */
  async removeUser(
    companyId: string,
    userId: string,
  ): Promise<ControllerResult> {
    const removed = await this.companyRepository.removeUser(companyId, userId);

    if (!removed) {
      return {
        statusCode: 404,
        body: { error: "User is not a member of this company" },
      };
    }

    return { statusCode: 200, body: { message: "User removed successfully" } };
  }
}
