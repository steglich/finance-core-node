import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Create enum types first
  await knex.raw(`
    CREATE TYPE user_status AS ENUM ('ACTIVE', 'INACTIVE');
    CREATE TYPE company_type AS ENUM ('INDIVIDUAL', 'CORPORATE');
  `);

  // Users table
  await knex.schema.createTable("users", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name").notNullable();
    table.string("email").notNullable().unique();
    table.string("password_hash").notNullable();
    table.string("cpf");
    table.string("cnpj");
    table
      .enum("status", ["ACTIVE", "INACTIVE"])
      .defaultTo("ACTIVE")
      .notNullable();
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();
  });

  // Companies table
  await knex.schema.createTable("companies", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name").notNullable();
    table.enum("type", ["INDIVIDUAL", "CORPORATE"]).notNullable();
    table.string("default_currency").defaultTo("BRL").notNullable();
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();
  });

  // Company users (many-to-many)
  await knex.schema.createTable("company_users", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("user_id").references("id").inTable("users").onDelete("CASCADE");
    table
      .uuid("company_id")
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table
      .uuid("profile_id")
      .references("id")
      .inTable("profiles")
      .onDelete("SET NULL");
    table.timestamp("joined_at").defaultTo(knex.fn.now()).notNullable();
    table.unique(["user_id", "company_id"]);
  });

  // Profiles table
  await knex.schema.createTable("profiles", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name").notNullable();
    table
      .uuid("company_id")
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();
  });

  // Permissions table
  await knex.schema.createTable("permissions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("resource").notNullable();
    table.string("action").notNullable();
    table.unique(["resource", "action"]);
  });

  // Profile permissions (many-to-many)
  await knex.schema.createTable("profile_permissions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("profile_id")
      .references("id")
      .inTable("profiles")
      .onDelete("CASCADE");
    table
      .uuid("permission_id")
      .references("id")
      .inTable("permissions")
      .onDelete("CASCADE");
    table.unique(["profile_id", "permission_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("profile_permissions");
  await knex.schema.dropTable("permissions");
  await knex.schema.dropTable("profiles");
  await knex.schema.dropTable("company_users");
  await knex.schema.dropTable("companies");
  await knex.schema.dropTable("users");

  // Drop enum types
  await knex.raw("DROP TYPE IF EXISTS user_status");
  await knex.raw("DROP TYPE IF EXISTS company_type");
}
