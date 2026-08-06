/**
 * Edge security configuration, read once from the environment.
 *
 * Every value here has a default that fails closed: an unconfigured deployment
 * trusts no proxy, allows no cross-origin browser call and still rate limits.
 */

/** Rate limit for a single scope: how many requests per time window. */
export interface RateLimitConfig {
  max: number;
  timeWindow: string;
}

export interface SecurityConfig {
  /**
   * Whether forwarding headers may decide `request.ip`. Only enable it behind a
   * proxy that overwrites `X-Forwarded-For`: with no such proxy, a client could
   * pick its own address and slip past the rate limit.
   */
  trustProxy: boolean;
  /** Origins allowed to make cross-origin browser calls. Empty means none. */
  corsOrigins: readonly string[];
  /** Applies to the whole API. */
  globalRateLimit: RateLimitConfig;
  /** Applies to `/auth` only — each attempt costs a bcrypt verification. */
  authRateLimit: RateLimitConfig;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Splits a comma-separated origin list. An unset or empty variable yields an
 * empty list, which denies every cross-origin request — the permissive `*` that
 * used to be hardcoded is exactly the failure mode being removed.
 */
function parseOrigins(value: string | undefined): readonly string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function resolveSecurityConfig(
  env: NodeJS.ProcessEnv = process.env,
): SecurityConfig {
  return {
    trustProxy: parseBoolean(env.TRUST_PROXY, false),
    corsOrigins: parseOrigins(env.CORS_ORIGINS),
    globalRateLimit: {
      max: parsePositiveInt(env.RATE_LIMIT_MAX, 300),
      timeWindow: env.RATE_LIMIT_WINDOW ?? "1 minute",
    },
    authRateLimit: {
      max: parsePositiveInt(env.AUTH_RATE_LIMIT_MAX, 10),
      timeWindow: env.AUTH_RATE_LIMIT_WINDOW ?? "1 minute",
    },
  };
}
