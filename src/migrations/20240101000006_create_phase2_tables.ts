import type { Knex } from "knex";

/**
 * Phase 2 schema: cards, invoices, budgets and goals, plus the card/invoice
 * link on transactions and the indexes that sustain the dashboard and report
 * aggregations (RNF-PERF-002/003).
 *
 * Purely additive — new tables and nullable columns only, so the rollback loses
 * nothing that Phase 1 wrote.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("cards", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table
      .uuid("account_id")
      .notNullable()
      .references("id")
      .inTable("accounts");
    table.string("name").notNullable();
    table.string("type").notNullable(); // CREDIT, DEBIT, PREPAID
    table.string("brand").notNullable();
    table.string("bank");
    table.decimal("credit_limit", 15, 2);
    table.integer("closing_day");
    table.integer("due_day");
    table.boolean("is_active").defaultTo(true).notNullable();
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();

    table.index(["company_id", "is_active"], "cards_company_active_idx");
    table.index(["account_id"], "cards_account_idx");
  });

  await knex.schema.createTable("invoices", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.uuid("card_id").notNullable().references("id").inTable("cards");
    table.date("cycle_start").notNullable();
    table.date("closing_date").notNullable();
    table.date("due_date").notNullable();
    table.string("status").defaultTo("OPEN").notNullable(); // OPEN, CLOSED, PARTIALLY_PAID, PAID, OVERDUE
    table.decimal("total_amount", 15, 2).defaultTo(0).notNullable();
    table.decimal("paid_amount", 15, 2).defaultTo(0).notNullable();
    table.string("currency").defaultTo("BRL").notNullable();
    table.timestamp("closed_at");
    table.uuid("closed_by");
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();

    // Exactly one invoice per card cycle — the guard that makes the scheduler's
    // closing pass idempotent even under concurrent purchases.
    table.unique(["card_id", "closing_date"], {
      indexName: "invoices_card_closing_unique",
    });
    table.index(
      ["company_id", "status", "due_date"],
      "invoices_company_status_due_idx",
    );
  });

  await knex.schema.createTable("invoice_payments", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("invoice_id")
      .notNullable()
      .references("id")
      .inTable("invoices")
      .onDelete("CASCADE");
    table
      .uuid("transaction_id")
      .references("id")
      .inTable("transactions")
      .onDelete("SET NULL");
    table.uuid("account_id").notNullable().references("id").inTable("accounts");
    table.decimal("amount", 15, 2).notNullable();
    table.timestamp("paid_at").defaultTo(knex.fn.now()).notNullable();

    table.index(["invoice_id"], "invoice_payments_invoice_idx");
  });

  await knex.schema.createTable("budgets", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table
      .uuid("category_id")
      .notNullable()
      .references("id")
      .inTable("categories");
    table.date("period_start").notNullable();
    table.date("period_end").notNullable();
    table.decimal("planned_amount", 15, 2).notNullable();
    // Set only when the period closes: until then the actual amount is derived
    // from the transactions themselves and never stored.
    table.decimal("actual_amount", 15, 2);
    table.string("currency").defaultTo("BRL").notNullable();
    table.string("status").defaultTo("ACTIVE").notNullable(); // ACTIVE, CLOSED, INACTIVE
    table.boolean("exceeded_notified").defaultTo(false).notNullable();
    table.timestamp("closed_at");
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();

    table.index(
      ["company_id", "period_start", "period_end"],
      "budgets_company_period_idx",
    );
    table.index(["category_id", "status"], "budgets_category_status_idx");
  });

  await knex.schema.createTable("goals", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.uuid("account_id").notNullable().references("id").inTable("accounts");
    table.string("name").notNullable();
    table.decimal("target_amount", 15, 2).notNullable();
    table.decimal("current_amount", 15, 2).defaultTo(0).notNullable();
    table.string("currency").defaultTo("BRL").notNullable();
    table.date("deadline").notNullable();
    table.string("status").defaultTo("CREATED").notNullable(); // CREATED, IN_PROGRESS, ACHIEVED, CANCELLED
    table.timestamp("achieved_at");
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();

    table.index(["company_id", "status"], "goals_company_status_idx");
  });

  await knex.schema.createTable("goal_contributions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("goal_id")
      .notNullable()
      .references("id")
      .inTable("goals")
      .onDelete("CASCADE");
    table
      .uuid("transaction_id")
      .references("id")
      .inTable("transactions")
      .onDelete("SET NULL");
    table.decimal("amount", 15, 2).notNullable();
    table.timestamp("contributed_at").defaultTo(knex.fn.now()).notNullable();

    table.index(["goal_id"], "goal_contributions_goal_idx");
  });

  await knex.schema.alterTable("transactions", (table) => {
    table.uuid("card_id").references("id").inTable("cards").onDelete("SET NULL");
    table
      .uuid("invoice_id")
      .references("id")
      .inTable("invoices")
      .onDelete("SET NULL");
  });

  // Without these the dashboard scans the whole transactions table.
  await knex.schema.alterTable("transactions", (table) => {
    table.index(["company_id", "status", "date"], "transactions_company_status_date_idx");
    table.index(
      ["company_id", "category_id", "status", "date"],
      "transactions_company_category_status_date_idx",
    );
    table.index(["card_id", "invoice_id"], "transactions_card_invoice_idx");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("transactions", (table) => {
    table.dropIndex([], "transactions_card_invoice_idx");
    table.dropIndex([], "transactions_company_category_status_date_idx");
    table.dropIndex([], "transactions_company_status_date_idx");
    table.dropColumn("invoice_id");
    table.dropColumn("card_id");
  });

  await knex.schema.dropTable("goal_contributions");
  await knex.schema.dropTable("goals");
  await knex.schema.dropTable("budgets");
  await knex.schema.dropTable("invoice_payments");
  await knex.schema.dropTable("invoices");
  await knex.schema.dropTable("cards");
}
