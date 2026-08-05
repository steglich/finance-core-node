import dotenv from "dotenv";
import { AppServer } from "./app.server.js";

dotenv.config();

const PORT = Number(process.env.PORT ?? "3000");

const app = new AppServer();

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down...`);
  try {
    await app.stop();
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.start(PORT);
} catch (error) {
  console.error("Failed to start server", error);
  process.exit(1);
}
