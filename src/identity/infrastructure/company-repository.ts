import type { Company } from "../domain/company.js";

/**
 * Repository interface for Company entity.
 */
export interface CompanyRepository {
  /**
   * Creates a new company.
   */
  create(company: Company): Promise<void>;

  /**
   * Finds a company by ID.
   */
  findById(id: string): Promise<Company | null>;

  /**
   * Finds all companies for a user.
   */
  findUserCompanies(userId: string): Promise<string[]>;

  /**
   * Profile assigned to a user within a company, or null when the user does not
   * belong to it. Used by `requirePermission` to resolve the active profile.
   */
  findUserProfileId(companyId: string, userId: string): Promise<string | null>;

  /**
   * Adds a user to a company.
   */
  addUser(companyId: string, userId: string, profileId?: string): Promise<void>;

  /**
   * Removes a user from a company.
   */
  removeUser(companyId: string, userId: string): Promise<boolean>;
}
