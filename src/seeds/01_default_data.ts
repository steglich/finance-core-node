import type { Knex } from "knex";
import type {
  PermissionAction,
  PermissionResource,
} from "../identity/domain/profile.js";

/**
 * Default profiles and permissions.
 *
 * The permission rows are typed against `PermissionResource` and
 * `PermissionAction`, so a value outside the domain vocabulary is a compile
 * error rather than a row that no permission check can ever match — which is
 * exactly what the original lowercase `create`/`read` values were.
 *
 * Profile ids are fixed rather than random so the seed can link permissions to
 * them and stay idempotent across runs.
 */

export const ADMIN_PROFILE_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_PROFILE_ID = "00000000-0000-0000-0000-000000000002";

export interface SeedPermission {
  resource: PermissionResource;
  action: PermissionAction;
}

/**
 * Exported so a test can assert that the defaults resolve against the domain
 * vocabulary without needing a database.
 */
export const defaultPermissions: readonly SeedPermission[] = [
  // Identity
  { resource: "users", action: "READ" },
  { resource: "users", action: "WRITE" },
  { resource: "companies", action: "READ" },
  { resource: "companies", action: "WRITE" },
  { resource: "profiles", action: "READ" },
  { resource: "profiles", action: "WRITE" },
  // Finance
  { resource: "accounts", action: "READ" },
  { resource: "accounts", action: "WRITE" },
  { resource: "categories", action: "READ" },
  { resource: "categories", action: "WRITE" },
  { resource: "transactions", action: "READ" },
  { resource: "transactions", action: "WRITE" },
  // Audit — never seeded before, which left the audit endpoints unreachable
  // for every default profile.
  { resource: "audit", action: "MANAGE" },
];

export async function seed(knex: Knex): Promise<void> {
  await knex("profiles")
    .insert([
      { id: ADMIN_PROFILE_ID, name: "Administrador", company_id: null },
      { id: DEFAULT_PROFILE_ID, name: "Usuário Padrão", company_id: null },
    ])
    .onConflict("id")
    .ignore();

  for (const permission of defaultPermissions) {
    await knex("permissions")
      .insert({
        id: knex.raw("gen_random_uuid()"),
        resource: permission.resource,
        action: permission.action,
      })
      .onConflict(["resource", "action"])
      .ignore();
  }

  // The administrator profile holds every permission, audit included.
  const permissionIds: { id: string }[] = await knex("permissions").select("id");

  for (const p of permissionIds) {
    await knex("profile_permissions")
      .insert({
        id: knex.raw("gen_random_uuid()"),
        profile_id: ADMIN_PROFILE_ID,
        permission_id: p.id,
      })
      .onConflict(["profile_id", "permission_id"])
      .ignore();
  }
}
