import type { Knex } from "knex";

/**
 * Phase 3 schema: people (customers, suppliers and payees), cost centers,
 * receivables (charges), payables and PIX records, plus the new nullable
 * dimensions on transactions and budgets.
 *
 * Purely additive — new tables and nullable columns only, so the rollback loses
 * nothing that Phases 1 and 2 wrote.
 *
 * Penalty and interest are never stored while a charge is open: they are a
 * function of the reference date and are only materialized on the receipt row.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("people", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.string("name").notNullable();
    table.string("person_type").notNullable(); // INDIVIDUAL, LEGAL_ENTITY
    table.string("document").notNullable(); // CPF or CNPJ, unmasked
    table.string("email");
    table.string("phone");
    table.jsonb("address");
    table.boolean("is_active").defaultTo(true).notNullable();
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();

    table.unique(["company_id", "document"], {
      indexName: "people_company_document_unique",
    });
    table.index(["company_id", "is_active"], "people_company_active_idx");
  });

  // Customer, supplier and payee are roles of the same person, not separate
  // entities (design decision 5) — a person may hold any combination.
  await knex.schema.createTable("person_roles", (table) => {
    table
      .uuid("person_id")
      .notNullable()
      .references("id")
      .inTable("people")
      .onDelete("CASCADE");
    table.string("role").notNullable(); // CUSTOMER, SUPPLIER, PAYEE
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();

    table.primary(["person_id", "role"]);
  });

  await knex.schema.createTable("person_bank_accounts", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table
      .uuid("person_id")
      .notNullable()
      .references("id")
      .inTable("people")
      .onDelete("CASCADE");
    table.string("label").notNullable();
    table.string("pix_key");
    table.string("pix_key_type"); // CPF, CNPJ, EMAIL, PHONE, RANDOM
    table.string("bank");
    table.string("branch");
    table.string("account_number");
    table.boolean("is_default").defaultTo(false).notNullable();
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();

    table.index(["person_id"], "person_bank_accounts_person_idx");
  });

  await knex.schema.createTable("cost_centers", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table
      .uuid("parent_id")
      .references("id")
      .inTable("cost_centers")
      .onDelete("RESTRICT");
    table.string("name").notNullable();
    table.string("description");
    table.boolean("is_active").defaultTo(true).notNullable();
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();

    table.unique(["company_id", "parent_id", "name"], {
      indexName: "cost_centers_company_parent_name_unique",
    });
    table.index(["company_id", "is_active"], "cost_centers_company_active_idx");
  });

  await knex.schema.createTable("charges", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.uuid("person_id").notNullable().references("id").inTable("people");
    table.decimal("amount", 15, 2).notNullable();
    table.string("currency").defaultTo("BRL").notNullable();
    table.date("issue_date").notNullable();
    table.date("due_date").notNullable();
    table.string("description");
    table.decimal("penalty_percent", 5, 2).defaultTo(0).notNullable();
    table.decimal("monthly_interest_percent", 5, 2).defaultTo(0).notNullable();
    table.string("status").defaultTo("ISSUED").notNullable(); // ISSUED, OVERDUE, PAID, CANCELLED
    // Reserved for the bank slip identifier once an integration exists.
    table.string("external_reference");
    table.string("cancel_reason");
    table.timestamp("cancelled_at");
    table.timestamp("paid_at");
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();

    table.index(
      ["company_id", "status", "due_date"],
      "charges_company_status_due_idx",
    );
    table.index(
      ["company_id", "person_id", "status"],
      "charges_company_person_status_idx",
    );
  });

  // Immutable historical record of what was actually charged on the day the
  // money came in — penalty and interest frozen at the receipt date.
  await knex.schema.createTable("charge_receipts", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("charge_id")
      .notNullable()
      .references("id")
      .inTable("charges")
      .onDelete("CASCADE");
    table
      .uuid("transaction_id")
      .references("id")
      .inTable("transactions")
      .onDelete("SET NULL");
    table.uuid("account_id").notNullable().references("id").inTable("accounts");
    table.decimal("amount", 15, 2).notNullable();
    table.decimal("penalty_amount", 15, 2).defaultTo(0).notNullable();
    table.decimal("interest_amount", 15, 2).defaultTo(0).notNullable();
    table.timestamp("received_at").defaultTo(knex.fn.now()).notNullable();

    table.index(["charge_id"], "charge_receipts_charge_idx");
  });

  await knex.schema.createTable("payables", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.uuid("person_id").notNullable().references("id").inTable("people");
    table
      .uuid("category_id")
      .notNullable()
      .references("id")
      .inTable("categories");
    table.uuid("cost_center_id").references("id").inTable("cost_centers");
    table.decimal("amount", 15, 2).notNullable();
    table.string("currency").defaultTo("BRL").notNullable();
    table.date("due_date").notNullable();
    table.date("competence_date");
    table.string("description");
    table.string("document_number");
    table.string("status").defaultTo("PENDING").notNullable(); // PENDING, OVERDUE, PAID, CANCELLED
    table.string("cancel_reason");
    table.timestamp("cancelled_at");
    table.timestamp("paid_at");
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();

    table.index(
      ["company_id", "status", "due_date"],
      "payables_company_status_due_idx",
    );
    table.index(
      ["company_id", "person_id", "status"],
      "payables_company_person_status_idx",
    );
  });

  await knex.schema.createTable("payable_payments", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("payable_id")
      .notNullable()
      .references("id")
      .inTable("payables")
      .onDelete("CASCADE");
    table
      .uuid("transaction_id")
      .references("id")
      .inTable("transactions")
      .onDelete("SET NULL");
    table.uuid("account_id").notNullable().references("id").inTable("accounts");
    table.decimal("amount", 15, 2).notNullable();
    table.timestamp("paid_at").defaultTo(knex.fn.now()).notNullable();

    table.index(["payable_id"], "payable_payments_payable_idx");
  });

  // A satellite table instead of payment-method columns on transactions
  // (design decision 12): transactions stays stable, PIX keeps its own record.
  await knex.schema.createTable("pix_payments", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table
      .uuid("transaction_id")
      .notNullable()
      .references("id")
      .inTable("transactions")
      .onDelete("CASCADE");
    table.string("direction").notNullable(); // SENT, RECEIVED
    table.string("pix_key").notNullable();
    table.uuid("person_id").references("id").inTable("people");
    table
      .uuid("bank_account_id")
      .references("id")
      .inTable("person_bank_accounts");
    table.uuid("charge_id").references("id").inTable("charges");
    table.timestamp("occurred_at").defaultTo(knex.fn.now()).notNullable();

    table.index(
      ["company_id", "direction", "occurred_at"],
      "pix_payments_company_direction_idx",
    );
    table.index(["transaction_id"], "pix_payments_transaction_idx");
  });

  await knex.schema.alterTable("transactions", (table) => {
    table
      .uuid("cost_center_id")
      .references("id")
      .inTable("cost_centers")
      .onDelete("SET NULL");
    table
      .uuid("person_id")
      .references("id")
      .inTable("people")
      .onDelete("SET NULL");
  });

  await knex.schema.alterTable("transactions", (table) => {
    table.index(
      ["company_id", "cost_center_id", "status", "date"],
      "transactions_company_cost_center_status_date_idx",
    );
  });

  // Nullable: every budget written by Phase 2 has a category, so the new
  // "at least one dimension" invariant already holds for them.
  //
  // `category_id` is relaxed to nullable in the same step, because a budget may
  // now carry the cost center dimension alone. Widening a column never rejects
  // an existing row, so this stays as safe as the additive changes above.
  await knex.schema.alterTable("budgets", (table) => {
    table
      .uuid("cost_center_id")
      .references("id")
      .inTable("cost_centers")
      .onDelete("SET NULL");
    table.uuid("category_id").nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("budgets", (table) => {
    table.dropColumn("cost_center_id");
  });

  // Restoring NOT NULL would fail on any cost-center-only budget written while
  // Phase 3 was live, so those are dropped first — they are Phase 3 data, which
  // the rollback discards by design.
  await knex("budgets").whereNull("category_id").delete();
  await knex.schema.alterTable("budgets", (table) => {
    table.uuid("category_id").notNullable().alter();
  });

  await knex.schema.alterTable("transactions", (table) => {
    table.dropIndex([], "transactions_company_cost_center_status_date_idx");
    table.dropColumn("person_id");
    table.dropColumn("cost_center_id");
  });

  await knex.schema.dropTable("pix_payments");
  await knex.schema.dropTable("payable_payments");
  await knex.schema.dropTable("payables");
  await knex.schema.dropTable("charge_receipts");
  await knex.schema.dropTable("charges");
  await knex.schema.dropTable("cost_centers");
  await knex.schema.dropTable("person_bank_accounts");
  await knex.schema.dropTable("person_roles");
  await knex.schema.dropTable("people");
}
