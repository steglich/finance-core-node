import type { Knex } from "knex";

/**
 * Adds the columns required by the financial domain aggregates that were not
 * covered by the initial finance/transaction migrations.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("accounts", (table) => {
    table.decimal("blocked_amount", 15, 2).defaultTo(0).notNullable();
    table.boolean("is_deleted").defaultTo(false).notNullable();
  });

  await knex.schema.alterTable("categories", (table) => {
    table.boolean("is_deleted").defaultTo(false).notNullable();
  });

  await knex.schema.alterTable("transactions", (table) => {
    // The exchange rate is a value object; storing it whole keeps the rate that
    // was actually applied immutable alongside the transaction (RN-07).
    table.jsonb("exchange_rate");
  });

  await knex.schema.alterTable("installments", (table) => {
    table
      .uuid("company_id")
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table
      .uuid("category_id")
      .references("id")
      .inTable("categories")
      .onDelete("SET NULL");
    table
      .uuid("payment_transaction_id")
      .references("id")
      .inTable("transactions")
      .onDelete("SET NULL");
    // The account the payment came from may differ from the purchase account.
    table
      .uuid("payment_account_id")
      .references("id")
      .inTable("accounts")
      .onDelete("SET NULL");
  });

  await knex.schema.alterTable("recurrences", (table) => {
    table.string("currency").defaultTo("BRL").notNullable();
    table.string("type").defaultTo("EXPENSE").notNullable();
    table.integer("generated_count").defaultTo(0).notNullable();
  });

  await knex.schema.alterTable("transfers", (table) => {
    table.uuid("source_account_id").references("id").inTable("accounts");
    table.uuid("target_account_id").references("id").inTable("accounts");
    table.decimal("credited_amount", 15, 2);
    table.string("target_currency");
    table.jsonb("exchange_rate");
    table.string("status").defaultTo("COMPLETED").notNullable();
    table.timestamp("reversed_at");
  });

  await knex.schema.alterTable("transaction_attachments", (table) => {
    table.integer("size").defaultTo(0).notNullable();
  });

  // Audit records are queried per company, so they carry the tenant scope too.
  for (const tableName of ["audit_entries", "domain_event_logs"]) {
    await knex.schema.alterTable(tableName, (table) => {
      table
        .uuid("company_id")
        .references("id")
        .inTable("companies")
        .onDelete("CASCADE");
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const tableName of ["audit_entries", "domain_event_logs"]) {
    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn("company_id");
    });
  }

  await knex.schema.alterTable("transaction_attachments", (table) => {
    table.dropColumn("size");
  });

  await knex.schema.alterTable("transfers", (table) => {
    table.dropColumn("source_account_id");
    table.dropColumn("target_account_id");
    table.dropColumn("credited_amount");
    table.dropColumn("target_currency");
    table.dropColumn("exchange_rate");
    table.dropColumn("status");
    table.dropColumn("reversed_at");
  });

  await knex.schema.alterTable("recurrences", (table) => {
    table.dropColumn("currency");
    table.dropColumn("type");
    table.dropColumn("generated_count");
  });

  await knex.schema.alterTable("installments", (table) => {
    table.dropColumn("company_id");
    table.dropColumn("category_id");
    table.dropColumn("payment_transaction_id");
    table.dropColumn("payment_account_id");
  });

  await knex.schema.alterTable("transactions", (table) => {
    table.dropColumn("exchange_rate");
  });

  await knex.schema.alterTable("categories", (table) => {
    table.dropColumn("is_deleted");
  });

  await knex.schema.alterTable("accounts", (table) => {
    table.dropColumn("blocked_amount");
    table.dropColumn("is_deleted");
  });
}
