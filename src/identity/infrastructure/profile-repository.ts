import type { Profile, Permission } from "../domain/profile.js";

/**
 * Repository interface for Profile entity.
 */
export interface ProfileRepository {
  /**
   * Creates a new profile.
   */
  create(profile: Profile): Promise<void>;

  /**
   * Finds a profile by ID.
   */
  findById(id: string): Promise<Profile | null>;

  /**
   * Finds all profiles for a company.
   */
  findByCompanyId(companyId: string): Promise<Profile[]>;

  /**
   * Updates a profile.
   */
  update(profile: Profile): Promise<void>;

  /**
   * Deletes a profile (soft delete).
   */
  delete(id: string): Promise<boolean>;
}
