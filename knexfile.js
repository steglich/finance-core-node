const config = {
    client: "pg",
    connection: process.env.DATABASE_URL ?? "",
    migrations: {
        directory: "./migrations",
        tableName: "knex_migrations",
    },
    seeds: {
        directory: "./seeds",
    },
};
export default config;
//# sourceMappingURL=knexfile.js.map