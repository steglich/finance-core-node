export async function up(knex) {
    // Transactions table (Aggregate Root)
    await knex.schema.createTable("transactions", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table
            .uuid("company_id")
            .references("id")
            .inTable("companies")
            .onDelete("CASCADE");
        table.uuid("account_id").references("id").inTable("accounts").notNullable();
        table
            .uuid("category_id")
            .references("id")
            .inTable("categories")
            .onDelete("SET NULL");
        table.string("type").notNullable(); // INCOME, EXPENSE, TRANSFER
        table.string("status").defaultTo("PENDING").notNullable(); // PENDING, CONFIRMED, CANCELLED, REFUNDED
        table.decimal("gross_amount", 15, 2).notNullable();
        table.decimal("discount", 15, 2).defaultTo(0);
        table.decimal("interest", 15, 2).defaultTo(0);
        table.decimal("penalty", 15, 2).defaultTo(0);
        table.decimal("net_amount", 15, 2).notNullable();
        table.string("currency").defaultTo("BRL").notNullable();
        table.string("exchange_rate_id"); // Reference to exchange rates if multi-currency
        table.date("date").notNullable();
        table.date("competence").notNullable();
        table.text("description");
        table
            .uuid("parent_transaction_id")
            .references("id")
            .inTable("transactions")
            .onDelete("SET NULL"); // For installments
        table
            .uuid("transfer_id")
            .references("id")
            .inTable("transfers")
            .onDelete("SET NULL"); // For transfers
        table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
        table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();
    });
    // Installments table
    await knex.schema.createTable("installments", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table
            .uuid("transaction_id")
            .references("id")
            .inTable("transactions")
            .onDelete("CASCADE");
        table.integer("number").notNullable();
        table.decimal("amount", 15, 2).notNullable();
        table.date("due_date").notNullable();
        table.string("status").defaultTo("PENDING").notNullable(); // PENDING, PAID, OVERDUE
        table.date("payment_date");
        table
            .uuid("account_id")
            .references("id")
            .inTable("accounts")
            .onDelete("SET NULL");
        table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
        table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();
    });
    // Transaction tags (many-to-many)
    await knex.schema.createTable("transaction_tags", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table
            .uuid("transaction_id")
            .references("id")
            .inTable("transactions")
            .onDelete("CASCADE");
        table.string("name").notNullable();
        table.unique(["transaction_id", "name"]);
    });
    // Transaction attachments
    await knex.schema.createTable("transaction_attachments", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table
            .uuid("transaction_id")
            .references("id")
            .inTable("transactions")
            .onDelete("CASCADE");
        table.string("filename").notNullable();
        table.string("mime_type").notNullable();
        table.string("url").notNullable(); // Path or S3 URL
        table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    });
    // Recurrences table
    await knex.schema.createTable("recurrences", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table
            .uuid("company_id")
            .references("id")
            .inTable("companies")
            .onDelete("CASCADE");
        table.string("description").notNullable();
        table.decimal("amount", 15, 2).notNullable();
        table.uuid("account_id").references("id").inTable("accounts").notNullable();
        table
            .uuid("category_id")
            .references("id")
            .inTable("categories")
            .onDelete("SET NULL");
        table.string("periodicity").notNullable(); // DAILY, WEEKLY, MONTHLY, YEARLY
        table.date("start_date").notNullable();
        table.date("end_date");
        table.integer("max_occurrences");
        table.string("status").defaultTo("ACTIVE").notNullable(); // ACTIVE, PAUSED, CANCELLED
        table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
        table.timestamp("updated_at").defaultTo(knex.fn.now()).notNullable();
    });
    // Transfers table (for atomic transfers)
    await knex.schema.createTable("transfers", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table
            .uuid("company_id")
            .references("id")
            .inTable("companies")
            .onDelete("CASCADE");
        table.decimal("amount", 15, 2).notNullable();
        table.string("currency").defaultTo("BRL").notNullable();
        table.string("exchange_rate_id"); // If multi-currency
        table
            .uuid("debit_transaction_id")
            .references("id")
            .inTable("transactions")
            .onDelete("SET NULL");
        table
            .uuid("credit_transaction_id")
            .references("id")
            .inTable("transactions")
            .onDelete("SET NULL");
        table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    });
}
export async function down(knex) {
    await knex.schema.dropTable("transfers");
    await knex.schema.dropTable("recurrences");
    await knex.schema.dropTable("transaction_attachments");
    await knex.schema.dropTable("transaction_tags");
    await knex.schema.dropTable("installments");
    await knex.schema.dropTable("transactions");
}
//# sourceMappingURL=20240101000003_create_transaction_tables.js.map