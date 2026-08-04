import type { Knex } from "knex";

export async function seed(knex: Knex): Promise<void> {
  // Seed profiles
  await knex("profiles").insert([
    { id: crypto.randomUUID(), name: "Administrador", company_id: null },
    { id: crypto.randomUUID(), name: "Usuário Padrão", company_id: null },
  ]);

  // Seed permissions
  const permissions = [
    // Identity permissions
    { resource: "users", action: "create" },
    { resource: "users", action: "read" },
    { resource: "users", action: "update" },
    { resource: "companies", action: "create" },
    { resource: "companies", action: "read" },
    { resource: "profiles", action: "create" },
    { resource: "profiles", action: "read" },
    { resource: "profiles", action: "update" },
    // Finance permissions
    { resource: "accounts", action: "create" },
    { resource: "accounts", action: "read" },
    { resource: "transactions", action: "create" },
    { resource: "transactions", action: "read" },
  ];

  for (const perm of permissions) {
    await knex("permissions").insert({
      id: crypto.randomUUID(),
      ...perm,
    });
  }

  // Link default profile to all permissions
  const permissionIds = await knex("permissions").select("id");
  for (const p of permissionIds) {
    await knex("profile_permissions").insert({
      profile_id: "00000000-0000-0000-0000-000000000001", // Administrador
      permission_id: p.id,
    });
  }
}
