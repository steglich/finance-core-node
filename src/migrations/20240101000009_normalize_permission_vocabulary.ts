import type { Knex } from "knex";

/**
 * Realigns the seeded `permissions` rows with the vocabulary the domain
 * actually checks.
 *
 * The rows provisioned by the original seed use `create`/`read`/`update`, while
 * `PermissionAction` is `READ`/`WRITE`/`DELETE`/`MANAGE`. Nothing in
 * `requirePermission` can ever match a lowercase action, so every default
 * profile silently fails every check — and the `audit` resource was never
 * seeded at all, which is why the audit endpoints are unreachable today.
 *
 * Fixing `seeds/01_default_data.ts` only helps a fresh install; this migration
 * is what repairs a database that has already been seeded.
 *
 * `create` and `update` both map to `WRITE`, so the translation can collide
 * with the `unique(resource, action)` constraint. Colliding rows are merged:
 * the surviving row keeps the profile links of the ones removed.
 */

/** Legacy action -> domain action. */
const ACTION_MAP: Record<string, string> = {
  create: "WRITE",
  update: "WRITE",
  write: "WRITE",
  read: "READ",
  delete: "DELETE",
  manage: "MANAGE",
};

/** Reverse mapping used by `down`. `WRITE` cannot restore the lost create/update split. */
const REVERSE_ACTION_MAP: Record<string, string> = {
  WRITE: "create",
  READ: "read",
  DELETE: "delete",
  MANAGE: "manage",
};

interface PermissionRow {
  id: string;
  resource: string;
  action: string;
}

/**
 * Rewrites `action` on every row it recognizes, merging rows that collide on
 * `(resource, action)` after the translation.
 */
async function retranslate(
  knex: Knex,
  translate: (action: string) => string | undefined,
): Promise<void> {
  const rows: PermissionRow[] = await knex("permissions").select(
    "id",
    "resource",
    "action",
  );

  // resource + translated action -> id of the row that survives the merge.
  const survivors = new Map<string, string>();

  for (const row of rows) {
    const target = translate(row.action);
    if (target === undefined) {
      continue;
    }

    const key = `${row.resource}:${target}`;
    const survivor = survivors.get(key);

    if (survivor === undefined) {
      survivors.set(key, row.id);
      if (target !== row.action) {
        await knex("permissions").where("id", row.id).update({ action: target });
      }
      continue;
    }

    // Duplicate: move its profile links onto the survivor, then drop it.
    const links: { profile_id: string }[] = await knex("profile_permissions")
      .where("permission_id", row.id)
      .select("profile_id");

    for (const link of links) {
      await knex("profile_permissions")
        .insert({
          id: knex.raw("gen_random_uuid()"),
          profile_id: link.profile_id,
          permission_id: survivor,
        })
        .onConflict(["profile_id", "permission_id"])
        .ignore();
    }

    await knex("profile_permissions").where("permission_id", row.id).delete();
    await knex("permissions").where("id", row.id).delete();
  }
}

export async function up(knex: Knex): Promise<void> {
  await retranslate(knex, (action) => ACTION_MAP[action.toLowerCase()]);

  // The audit resource was never seeded. Add it and grant it to the profiles
  // that already hold every other permission — the default administrator.
  const [inserted]: { id: string }[] = await knex("permissions")
    .insert({
      id: knex.raw("gen_random_uuid()"),
      resource: "audit",
      action: "MANAGE",
    })
    .onConflict(["resource", "action"])
    .ignore()
    .returning("id");

  const auditPermissionId =
    inserted?.id ??
    (
      await knex("permissions")
        .where({ resource: "audit", action: "MANAGE" })
        .first("id")
    )?.id;

  if (!auditPermissionId) {
    return;
  }

  const totalOtherPermissions = Number(
    (
      await knex("permissions")
        .whereNot("id", auditPermissionId)
        .count<{ count: string }[]>("id as count")
    )[0]?.count ?? 0,
  );

  if (totalOtherPermissions === 0) {
    return;
  }

  const fullyPermissionedProfiles: { profile_id: string }[] = await knex(
    "profile_permissions",
  )
    .whereNot("permission_id", auditPermissionId)
    .groupBy("profile_id")
    .havingRaw("count(distinct permission_id) = ?", [totalOtherPermissions])
    .select("profile_id");

  for (const profile of fullyPermissionedProfiles) {
    await knex("profile_permissions")
      .insert({
        id: knex.raw("gen_random_uuid()"),
        profile_id: profile.profile_id,
        permission_id: auditPermissionId,
      })
      .onConflict(["profile_id", "permission_id"])
      .ignore();
  }
}

export async function down(knex: Knex): Promise<void> {
  const auditPermission = await knex("permissions")
    .where({ resource: "audit", action: "MANAGE" })
    .first("id");

  if (auditPermission) {
    await knex("profile_permissions")
      .where("permission_id", auditPermission.id)
      .delete();
    await knex("permissions").where("id", auditPermission.id).delete();
  }

  await retranslate(knex, (action) => REVERSE_ACTION_MAP[action]);
}
