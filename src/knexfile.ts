import "dotenv/config";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Knex } from "knex";
import { resolveDatabaseSsl } from "./shared/infrastructure/database-connection.js";

// The knex CLI resolves relative directories against the working directory, not
// against this file, so the paths are anchored here instead.
const here = dirname(fileURLToPath(import.meta.url));

const config: Knex.Config = {
  client: "pg",
  // Same explicit transport configuration the server uses, so migrations and
  // seeds do not reach the database over a weaker connection than the app.
  connection: {
    connectionString: process.env.DATABASE_URL ?? "",
    ssl: resolveDatabaseSsl(),
  },
  migrations: {
    directory: join(here, "migrations"),
    tableName: "knex_migrations",
    // src/migrations also holds compiled .js artifacts of the earlier
    // migrations; without this the CLI would list each of them twice.
    loadExtensions: [".ts"],
  },
  seeds: {
    directory: join(here, "seeds"),
    loadExtensions: [".ts"],
  },
};

export default config;
