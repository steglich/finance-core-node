import type { ControllerResult } from "../../shared/api/controller-result.js";
import type { ProfileRepository } from "../infrastructure/profile-repository.js";
import { Profile } from "../domain/profile.js";
import {
  validateCreateProfileRequest,
  validateUpdateProfileRequest,
} from "./dtos.js";

/**
 * Profile controller handling profile-related endpoints.
 */
export class ProfileController {
  constructor(private readonly profileRepository: ProfileRepository) {}

  /**
   * Handles GET /api/v1/profiles.
   */
  async list(companyId: string): Promise<ControllerResult> {
    const profiles = await this.profileRepository.findByCompanyId(companyId);

    return {
      statusCode: 200,
      body: { profiles: profiles.map((p) => p.toJSON()) },
    };
  }

  /**
   * Handles POST /api/v1/profiles.
   */
  async create(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateCreateProfileRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    // Note: permissions are created empty until the Permission repository exists;
    // validation.data.permissionIds is not resolved yet.
    const profile = new Profile(
      crypto.randomUUID(),
      companyId,
      validation.data.name,
      [],
    );

    await this.profileRepository.create(profile);

    return { statusCode: 201, body: profile.toJSON() };
  }

  /**
   * Handles PUT /api/v1/profiles/:profileId.
   */
  async update(profileId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateUpdateProfileRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const existingProfile = await this.profileRepository.findById(profileId);
    if (!existingProfile) {
      return { statusCode: 404, body: { error: "Profile not found" } };
    }

    // Note: renaming and permission resolution are not implemented yet —
    // Profile has no updateName and permissionIds are not resolved to entities.
    const updatedProfile = existingProfile.updatePermissions(
      validation.data.permissionIds ? [] : existingProfile.permissions,
    );

    await this.profileRepository.update(updatedProfile);

    return { statusCode: 200, body: updatedProfile.toJSON() };
  }

  /**
   * Handles DELETE /api/v1/profiles/:profileId.
   */
  async delete(profileId: string): Promise<ControllerResult> {
    const deleted = await this.profileRepository.delete(profileId);

    if (!deleted) {
      return { statusCode: 404, body: { error: "Profile not found" } };
    }

    return { statusCode: 200, body: { message: "Profile deleted successfully" } };
  }
}
