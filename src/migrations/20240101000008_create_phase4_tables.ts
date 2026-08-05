import type { Knex } from "knex";

/**
 * Phase 4 schema: investments (with their operations and manually registered
 * quotes), loans (with the installment schedule materialized at contract time
 * and the payments that amortize it), exchange rates per company, and the two
 * nullable origin columns that bind a transaction to the record that created it.
 *
 * Purely additive — new tables and nullable columns only, so the rollback loses
 * nothing that Phases 1 to 3 wrote.
 *
 * Quantities and unit prices use `decimal(20, 8)` because crypto has eight
 * decimal places and a fractional share does not fit in two; money keeps the
 * `decimal(15, 2)` of the existing tables. Positions, average cost and the loan
 * outstanding balance are never stored: they are derived from these rows.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("investments", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.uuid("account_id").notNullable().references("id").inTable("accounts");
    table.string("name").notNullable();
    // STOCK, REIT, TREASURY, CD, CRYPTO, ETF, FUND, PENSION
    table.string("investment_type").notNullable();
    // Ticker, ISIN or contract number — free text, optional.
    table.string("symbol");
    table.string("currency").defaultTo("BRL").notNullable();
    table
      .uuid("expense_category_id")
      .notNullable()
      .references("id")
      .inTable("categories");
    table
      .uuid("income_category_id")
      .notNullable()
      .references("id")
      .inTable("categories");
    table.string("status").defaultTo("ACTIVE").notNullable(); // ACTIVE, CLOSED
    table.timestamp("closed_at");
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();

    table.index(["company_id", "status"], "investments_company_status_idx");
  });

  await knex.schema.createTable("investment_operations", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table
      .uuid("investment_id")
      .notNullable()
      .references("id")
      .inTable("investments")
      .onDelete("CASCADE");
    table
      .uuid("transaction_id")
      .references("id")
      .inTable("transactions")
      .onDelete("SET NULL");
    // BUY, SELL, DIVIDEND, INTEREST, AMORTIZATION
    table.string("operation_type").notNullable();
    table.decimal("quantity", 20, 8).defaultTo(0).notNullable();
    table.decimal("unit_price", 20, 8).defaultTo(0).notNullable();
    table.decimal("fees", 15, 2).defaultTo(0).notNullable();
    table.decimal("amount", 15, 2).notNullable();
    table.string("currency").defaultTo("BRL").notNullable();
    table.date("operated_at").notNullable();
    table.string("notes");
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();

    table.index(
      ["investment_id", "operated_at"],
      "investment_operations_investment_date_idx",
    );
  });

  // The same shape a market-data integration would fill in; `source` is what
  // distinguishes MANUAL from an automated feed.
  await knex.schema.createTable("investment_quotes", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("investment_id")
      .notNullable()
      .references("id")
      .inTable("investments")
      .onDelete("CASCADE");
    table.date("quote_date").notNullable();
    table.decimal("unit_price", 20, 8).notNullable();
    table.string("source").defaultTo("MANUAL").notNullable();
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();

    table.unique(["investment_id", "quote_date"], {
      indexName: "investment_quotes_investment_date_unique",
    });
  });

  await knex.schema.createTable("loans", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.uuid("account_id").notNullable().references("id").inTable("accounts");
    // Creditor, optional: not every loan comes from a registered person.
    table.uuid("person_id").references("id").inTable("people");
    table.string("description").notNullable();
    table.decimal("principal_amount", 15, 2).notNullable();
    table.decimal("monthly_interest_percent", 7, 4).defaultTo(0).notNullable();
    table.integer("installment_count").notNullable();
    table.decimal("installment_amount", 15, 2).notNullable();
    table.string("currency").defaultTo("BRL").notNullable();
    table.date("first_due_date").notNullable();
    // CONTRACTED, IN_PROGRESS, DELINQUENT, SETTLED
    table.string("status").defaultTo("CONTRACTED").notNullable();
    table.timestamp("settled_at");
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();

    table.index(["company_id", "status"], "loans_company_status_idx");
  });

  await knex.schema.createTable("loan_installments", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table
      .uuid("loan_id")
      .notNullable()
      .references("id")
      .inTable("loans")
      .onDelete("CASCADE");
    table.integer("number").notNullable();
    table.date("due_date").notNullable();
    table.decimal("amount", 15, 2).notNullable();
    table.decimal("interest_amount", 15, 2).defaultTo(0).notNullable();
    table.decimal("principal_amount", 15, 2).notNullable();
    table.string("status").defaultTo("PENDING").notNullable(); // PENDING, OVERDUE, PAID
    table.timestamp("paid_at");
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();

    table.unique(["loan_id", "number"], {
      indexName: "loan_installments_loan_number_unique",
    });
    table.index(
      ["company_id", "status", "due_date"],
      "loan_installments_company_status_due_idx",
    );
  });

  await knex.schema.createTable("loan_payments", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table
      .uuid("loan_id")
      .notNullable()
      .references("id")
      .inTable("loans")
      .onDelete("CASCADE");
    // Null for an extra amortization, which pays no single installment.
    table
      .uuid("loan_installment_id")
      .references("id")
      .inTable("loan_installments")
      .onDelete("SET NULL");
    table
      .uuid("transaction_id")
      .references("id")
      .inTable("transactions")
      .onDelete("SET NULL");
    table.uuid("account_id").notNullable().references("id").inTable("accounts");
    // INSTALLMENT, EXTRA_AMORTIZATION
    table.string("payment_type").notNullable();
    table.decimal("amount", 15, 2).notNullable();
    table.decimal("principal_amount", 15, 2).defaultTo(0).notNullable();
    table.timestamp("paid_at").defaultTo(knex.fn.now()).notNullable();

    table.index(["loan_id"], "loan_payments_loan_idx");
  });

  // Rates are per company: what matters is the rate the company actually used
  // (its exchange contract, its bank's quote), not a global reference.
  await knex.schema.createTable("exchange_rates", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("company_id")
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.string("source_currency").notNullable();
    table.string("target_currency").notNullable();
    table.decimal("rate", 18, 8).notNullable();
    table.date("rate_date").notNullable();
    table.string("source").defaultTo("MANUAL").notNullable();
    table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();

    table.unique(
      ["company_id", "source_currency", "target_currency", "rate_date"],
      { indexName: "exchange_rates_company_pair_date_unique" },
    );
    table.index(
      ["company_id", "source_currency", "target_currency", "rate_date"],
      "exchange_rates_lookup_idx",
    );
  });

  await knex.schema.alterTable("transactions", (table) => {
    table
      .uuid("investment_operation_id")
      .references("id")
      .inTable("investment_operations")
      .onDelete("SET NULL");
    table
      .uuid("loan_installment_id")
      .references("id")
      .inTable("loan_installments")
      .onDelete("SET NULL");
  });

  // Required by the net worth reading, which rebuilds an account balance at a
  // past date from the confirmed entries instead of the cached balance column.
  await knex.schema.alterTable("transactions", (table) => {
    table.index(
      ["company_id", "account_id", "status", "date"],
      "transactions_company_account_status_date_idx",
    );
    table.index(
      ["investment_operation_id"],
      "transactions_investment_operation_idx",
    );
    table.index(["loan_installment_id"], "transactions_loan_installment_idx");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("transactions", (table) => {
    table.dropIndex([], "transactions_loan_installment_idx");
    table.dropIndex([], "transactions_investment_operation_idx");
    table.dropIndex([], "transactions_company_account_status_date_idx");
    table.dropColumn("loan_installment_id");
    table.dropColumn("investment_operation_id");
  });

  await knex.schema.dropTable("exchange_rates");
  await knex.schema.dropTable("loan_payments");
  await knex.schema.dropTable("loan_installments");
  await knex.schema.dropTable("loans");
  await knex.schema.dropTable("investment_quotes");
  await knex.schema.dropTable("investment_operations");
  await knex.schema.dropTable("investments");
}
