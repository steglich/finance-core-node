import knexLib from "knex";
import config from "./knexfile.js";

/**
 * Migration and seed runner for the `db:*` scripts.
 *
 * The knex CLI cannot load an ESM TypeScript knexfile: it requires the file
 * through a CJS interop path and reads back the module namespace instead of the
 * config, and its `--esm` flag relies on the legacy `esm` package, which throws
 * on this Node version. Driving the same knex API directly is a few lines and
 * behaves identically.
 *
 * Usage: `tsx src/db-cli.ts <migrate:latest|migrate:rollback|seed:run>`
 */
type Command = "migrate:latest" | "migrate:rollback" | "seed:run";

const COMMANDS: readonly Command[] = [
  "migrate:latest",
  "migrate:rollback",
  "seed:run",
];

function parseCommand(value: string | undefined): Command {
  if (value && (COMMANDS as readonly string[]).includes(value)) {
    return value as Command;
  }

  throw new Error(
    `Unknown command "${value ?? ""}". Expected one of: ${COMMANDS.join(", ")}`,
  );
}

async function run(command: Command): Promise<void> {
  if (!config.connection) {
    throw new Error("DATABASE_URL is required to run database commands");
  }

  const knex = knexLib(config);

  try {
    switch (command) {
      case "migrate:latest": {
        const [batch, applied] = (await knex.migrate.latest()) as [
          number,
          string[],
        ];
        if (applied.length === 0) {
          console.log("Already up to date");
        } else {
          console.log(`Batch ${batch} ran ${applied.length} migration(s):`);
          for (const name of applied) console.log(`  ${name}`);
        }
        break;
      }
      case "migrate:rollback": {
        const [batch, reverted] = (await knex.migrate.rollback()) as [
          number,
          string[],
        ];
        if (reverted.length === 0) {
          console.log("Nothing to rollback");
        } else {
          console.log(`Batch ${batch} rolled back ${reverted.length}:`);
          for (const name of reverted) console.log(`  ${name}`);
        }
        break;
      }
      case "seed:run": {
        const [seeded] = (await knex.seed.run()) as [string[]];
        console.log(`Ran ${seeded.length} seed file(s)`);
        for (const name of seeded) console.log(`  ${name}`);
        break;
      }
    }
  } finally {
    await knex.destroy();
  }
}

run(parseCommand(process.argv[2])).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
