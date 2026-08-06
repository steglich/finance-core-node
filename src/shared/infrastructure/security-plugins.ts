import type { FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { SecurityConfig } from "./security-config.js";

/**
 * Registers the edge defenses at the root of the instance, before any route
 * exists, so they cover the whole tree.
 *
 * These are the only external Fastify plugins the project uses — all from the
 * official `@fastify` scope — and they replace the hand-rolled CORS hook that
 * answered every origin with `*`.
 */
export async function registerSecurityPlugins(
  app: FastifyInstance,
  config: SecurityConfig,
): Promise<void> {
  await app.register(helmet, {
    // HSTS only takes effect over HTTPS; declaring it here means the proxy does
    // not have to remember to add it.
    hsts: { maxAge: 15552000, includeSubDomains: true },
    xContentTypeOptions: true,
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
    // The API serves JSON and CSV downloads, never HTML of its own.
    contentSecurityPolicy: false,
  });

  // An empty allowlist denies every cross-origin browser call. Server-to-server
  // clients are unaffected — CORS is a browser restriction.
  const allowed = config.corsOrigins;
  await app.register(cors, {
    origin: allowed.length > 0 ? [...allowed] : false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  await app.register(rateLimit, {
    max: config.globalRateLimit.max,
    timeWindow: config.globalRateLimit.timeWindow,
  });
}
