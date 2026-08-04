export async function up(knex) {
    // Audit entries (append-only)
    await knex.schema.createTable("audit_entries", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table.string("entity_type").notNullable();
        table.uuid("entity_id").notNullable();
        table.string("operation").notNullable(); // CREATE, UPDATE, DELETE
        table.string("field");
        table.text("old_value");
        table.text("new_value");
        table
            .uuid("user_id")
            .references("id")
            .inTable("users")
            .onDelete("SET NULL");
        table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    });
    // Domain event logs (append-only)
    await knex.schema.createTable("domain_event_logs", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table.string("event_type").notNullable();
        table.uuid("entity_id").notNullable();
        table.jsonb("payload").notNullable();
        table
            .uuid("user_id")
            .references("id")
            .inTable("users")
            .onDelete("SET NULL");
        table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    });
    // Access logs
    await knex.schema.createTable("access_logs", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table.string("event_type").notNullable(); // LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, PASSWORD_CHANGE
        table
            .uuid("user_id")
            .references("id")
            .inTable("users")
            .onDelete("SET NULL");
        table.string("email");
        table.string("ip_address");
        table.timestamp("created_at").defaultTo(knex.fn.now()).notNullable();
    });
    // Indexes for performance
    await knex.schema.raw("CREATE INDEX idx_audit_entries_entity ON audit_entries(entity_type, entity_id)");
    await knex.schema.raw("CREATE INDEX idx_domain_event_logs_entity ON domain_event_logs(entity_id)");
    await knex.schema.raw("CREATE INDEX idx_access_logs_user ON access_logs(user_id)");
}
export async function down(knex) {
    await knex.schema.dropTable("access_logs");
    await knex.schema.dropTable("domain_event_logs");
    await knex.schema.dropTable("audit_entries");
}
//# sourceMappingURL=20240101000004_create_audit_tables.js.map