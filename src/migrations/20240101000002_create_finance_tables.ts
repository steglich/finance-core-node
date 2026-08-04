import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Wallets table
  await knex.schema.createTable("wallets", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.string("name").notNullable();
    table.string("institution");
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();
  });

  // Accounts table (Aggregate Root)
  await knex.schema.createTable("accounts", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table
      .uuid("wallet_id")
      .references("id")
      .inTable("wallets")
      .onDelete("SET NULL");
    table.string("name").notNullable();
    table.string("number").notNullable();
    table.string("type").notNullable(); // CHECKING, SAVINGS, INVESTMENT, CASH
    table.string("currency").defaultTo("BRL").notNullable();
    table.decimal("balance", 15, 2).defaultTo(0).notNullable();
    table.boolean("is_active").defaultTo(true).notNullable();
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();
  });

  // Categories table (with hierarchy)
  await knex.schema.createTable("categories", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.string("name").notNullable();
    table.string("type").notNullable(); // EXPENSE, INCOME
    table.string("color");
    table.string("icon");
    table
      .uuid("parent_id")
      .references("id")
      .inTable("categories")
      .onDelete("SET NULL");
    table.boolean("is_default").defaultTo(false);
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("categories");
  await knex.schema.dropTable("accounts");
  await knex.schema.dropTable("wallets");
}
