import type { Knex } from "knex";

const config: Knex.Config = {
  client: "pg",
  connection:
    process.env.DATABASE_URL ?? "",
  migrations: {
    directory: "./migrations",
    tableName: "knex_migrations",
  },
  seeds: {
    directory: "./seeds",
  },
};

export default config;
