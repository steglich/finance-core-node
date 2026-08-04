import type { Knex } from "knex";
import type { ProfileRepository } from "./profile-repository.js";
import { Profile, Permission } from "../domain/profile.js";

/**
 * Knex-based implementation of ProfileRepository.
 */
export class KnexProfileRepository implements ProfileRepository {
  constructor(private readonly knex: Knex) {}

  async create(profile: Profile): Promise<void> {
    const trx = await this.knex.transaction(async (trx) => {
      // Insert profile
      await trx("profiles").insert({
        id: profile.id,
        name: profile.name,
        company_id: profile.companyId,
        created_at: profile.createdAt,
        updated_at: new Date(),
      });

      // Insert permissions if any
      for (const permission of profile.permissions) {
        await this.ensurePermission(trx, permission);
        await trx("profile_permissions").insert({
          id: crypto.randomUUID(),
          profile_id: profile.id,
          permission_id: await this.getPermissionId(
            trx,
            permission.resource,
            permission.action,
          ),
        });
      }
    });
  }

  async findById(id: string): Promise<Profile | null> {
    const row = await this.knex("profiles").where("id", id).first();

    if (!row) return null;

    // Get permissions for the profile
    const permissions = await this.getPermissionsForProfile(row.id);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return new Profile(
      row.id as string,
      row.company_id as string,
      row.name as string,
      permissions,
      new Date(row.created_at as string),
    );
  }

  async findByCompanyId(companyId: string): Promise<Profile[]> {
    const rows = await this.knex("profiles")
      .where("company_id", companyId)
      .orderBy("created_at", "desc");

    const profiles: Profile[] = [];
    for (const row of rows) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const permissions = await this.getPermissionsForProfile(row.id as string);
      profiles.push(
        new Profile(
          row.id as string,
          row.company_id as string,
          row.name as string,
          permissions,
          new Date(row.created_at as string),
        ),
      );
    }

    return profiles;
  }

  async update(profile: Profile): Promise<void> {
    const trx = await this.knex.transaction(async (trx) => {
      // Update profile
      await trx("profiles").where("id", profile.id).update({
        name: profile.name,
        updated_at: new Date(),
      });

      // Remove existing permissions
      await trx("profile_permissions").where("profile_id", profile.id).del();

      // Insert new permissions
      for (const permission of profile.permissions) {
        await this.ensurePermission(trx, permission);
        await trx("profile_permissions").insert({
          id: crypto.randomUUID(),
          profile_id: profile.id,
          permission_id: await this.getPermissionId(
            trx,
            permission.resource,
            permission.action,
          ),
        });
      }
    });
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.knex("profiles").where("id", id).del();
    return result > 0;
  }

  private async getPermissionsForProfile(
    profileId: string,
  ): Promise<Permission[]> {
    const rows = await this.knex("profile_permissions as pp")
      .join("permissions as p", "pp.permission_id", "p.id")
      .where("pp.profile_id", profileId)
      .select(["p.resource", "p.action"]);

    return rows
      .map((row) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const resource = row.resource as string;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const action = row.action as string;

        // Validate and cast to proper types
        if (
          this.isValidPermissionResource(resource) &&
          this.isValidPermissionAction(action)
        ) {
          return new Permission(
            resource as import("../domain/profile.js").PermissionResource,
            action as import("../domain/profile.js").PermissionAction,
          );
        }
        return null;
      })
      .filter((p): p is Permission => p !== null);
  }

  private isValidPermissionResource(
    resource: string,
  ): resource is import("../domain/profile.js").PermissionResource {
    const validResources: import("../domain/profile.js").PermissionResource[] =
      [
        "users",
        "companies",
        "profiles",
        "accounts",
        "categories",
        "transactions",
        "installments",
        "transfers",
        "recurrences",
        "audit",
      ];
    return validResources.includes(
      resource as import("../domain/profile.js").PermissionResource,
    );
  }

  private isValidPermissionAction(
    action: string,
  ): action is import("../domain/profile.js").PermissionAction {
    const validActions: import("../domain/profile.js").PermissionAction[] = [
      "READ",
      "WRITE",
      "DELETE",
      "MANAGE",
    ];
    return validActions.includes(
      action as import("../domain/profile.js").PermissionAction,
    );
  }

  private async ensurePermission(
    trx: Knex.Transaction,
    permission: Permission,
  ): Promise<void> {
    const existing = await trx("permissions")
      .where({ resource: permission.resource, action: permission.action })
      .first();

    if (!existing) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      await trx("permissions").insert({
        id: crypto.randomUUID(),
        resource: permission.resource,
        action: permission.action,
      });
    }
  }

  private async getPermissionId(
    trx: Knex.Transaction,
    resource: string,
    action: string,
  ): Promise<string> {
    const row = await trx("permissions").where({ resource, action }).first();

    if (!row) {
      throw new Error(
        `Permission ${resource}:${action} not found after ensure`,
      );
    }

    return row.id as string;
  }
}
