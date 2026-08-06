import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { resolveSecurityConfig, type SecurityConfig } from "./security-config.js";
import { registerSecurityPlugins } from "./security-plugins.js";

const BASE: SecurityConfig = {
  trustProxy: false,
  corsOrigins: [],
  globalRateLimit: { max: 10_000, timeWindow: "1 minute" },
  authRateLimit: { max: 10_000, timeWindow: "1 minute" },
};

/** A minimal app wired exactly like the composition root wires the real one. */
async function buildApp(
  overrides: Partial<SecurityConfig> = {},
): Promise<FastifyInstance> {
  const config: SecurityConfig = { ...BASE, ...overrides };
  const app = Fastify({ logger: false, trustProxy: config.trustProxy });

  await registerSecurityPlugins(app, config);

  app.get("/ping", async (request) => ({ ip: request.ip }));
  app.get("/download", async (_request, reply) => {
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="report.csv"');
    return "A,B\r\n1,2";
  });
  // Mirrors the /auth plugin: a stricter limit confined by encapsulation.
  await app.register(async (scope) => {
    scope.addHook(
      "onRequest",
      scope.rateLimit({
        max: config.authRateLimit.max,
        timeWindow: config.authRateLimit.timeWindow,
      }),
    );
    scope.post("/login", async () => ({ ok: true }));
  }, { prefix: "/auth" });

  await app.ready();
  return app;
}

describe("Client address resolution", () => {
  it("uses the forwarded address when proxy trust is enabled", async () => {
    const app = await buildApp({ trustProxy: true });

    const response = await app.inject({
      method: "GET",
      url: "/ping",
      headers: { "x-forwarded-for": "203.0.113.7" },
    });

    assert.equal(response.json<{ ip: string }>().ip, "203.0.113.7");
    await app.close();
  });

  it("ignores a forged forwarding header when proxy trust is disabled", async () => {
    const app = await buildApp({ trustProxy: false });

    const response = await app.inject({
      method: "GET",
      url: "/ping",
      headers: { "x-forwarded-for": "203.0.113.7" },
    });

    assert.notEqual(response.json<{ ip: string }>().ip, "203.0.113.7");
    await app.close();
  });
});

describe("Security response headers", () => {
  const expected: Record<string, string> = {
    "strict-transport-security": "max-age=15552000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  };

  it("sets the headers on an API response", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/ping" });

    for (const [header, value] of Object.entries(expected)) {
      assert.equal(response.headers[header], value, header);
    }
    await app.close();
  });

  it("sets the same headers on a CSV download", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/download" });

    assert.match(String(response.headers["content-disposition"]), /^attachment/);
    for (const [header, value] of Object.entries(expected)) {
      assert.equal(response.headers[header], value, header);
    }
    await app.close();
  });
});

describe("Cross-origin access control", () => {
  it("permits an origin on the allowlist", async () => {
    const app = await buildApp({ corsOrigins: ["https://app.example.com"] });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/ping",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "GET",
      },
    });

    assert.equal(
      response.headers["access-control-allow-origin"],
      "https://app.example.com",
    );
    await app.close();
  });

  it("does not permit an origin absent from the allowlist", async () => {
    const app = await buildApp({ corsOrigins: ["https://app.example.com"] });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/ping",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "GET",
      },
    });

    assert.equal(response.headers["access-control-allow-origin"], undefined);
    await app.close();
  });

  it("permits no origin when the allowlist is empty", async () => {
    const app = await buildApp({ corsOrigins: [] });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/ping",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "GET",
      },
    });

    assert.equal(response.headers["access-control-allow-origin"], undefined);
    await app.close();
  });

  it("takes the allowlist from configuration, never from a hardcoded value", () => {
    const configured = resolveSecurityConfig({
      CORS_ORIGINS: "https://a.example.com, https://b.example.com",
    } as NodeJS.ProcessEnv);
    assert.deepEqual(configured.corsOrigins, [
      "https://a.example.com",
      "https://b.example.com",
    ]);

    // Unset means no origin at all — not the `*` that used to be hardcoded.
    assert.deepEqual(
      resolveSecurityConfig({} as NodeJS.ProcessEnv).corsOrigins,
      [],
    );
  });
});

describe("Rate limiting", () => {
  it("rejects authentication attempts beyond the strict limit, before any handler runs", async () => {
    let handlerCalls = 0;
    const config: SecurityConfig = {
      ...BASE,
      authRateLimit: { max: 2, timeWindow: "1 minute" },
    };
    const app = Fastify({ logger: false, trustProxy: false });
    await registerSecurityPlugins(app, config);
    await app.register(async (scope) => {
      scope.addHook(
        "onRequest",
        scope.rateLimit({
          max: config.authRateLimit.max,
          timeWindow: config.authRateLimit.timeWindow,
        }),
      );
      // Stands in for the bcrypt verification a real login performs.
      scope.post("/login", async () => {
        handlerCalls += 1;
        return { ok: true };
      });
    }, { prefix: "/auth" });
    await app.ready();

    const attempt = () => app.inject({ method: "POST", url: "/auth/login" });

    assert.equal((await attempt()).statusCode, 200);
    assert.equal((await attempt()).statusCode, 200);

    const blocked = await attempt();
    assert.equal(blocked.statusCode, 429);
    assert.ok(blocked.headers["retry-after"] !== undefined);
    // The password check never ran for the rejected attempt.
    assert.equal(handlerCalls, 2);

    await app.close();
  });

  it("rejects traffic beyond the global limit on other routes", async () => {
    const app = await buildApp({
      globalRateLimit: { max: 2, timeWindow: "1 minute" },
    });

    assert.equal((await app.inject({ method: "GET", url: "/ping" })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: "/ping" })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: "/ping" })).statusCode, 429);

    await app.close();
  });

  it("lets traffic within the limit through", async () => {
    const app = await buildApp({
      globalRateLimit: { max: 5, timeWindow: "1 minute" },
    });

    for (let i = 0; i < 5; i += 1) {
      assert.equal(
        (await app.inject({ method: "GET", url: "/ping" })).statusCode,
        200,
      );
    }

    await app.close();
  });

  it("counts each client address separately", async () => {
    const app = await buildApp({
      trustProxy: true,
      globalRateLimit: { max: 1, timeWindow: "1 minute" },
    });

    const from = (ip: string) =>
      app.inject({
        method: "GET",
        url: "/ping",
        headers: { "x-forwarded-for": ip },
      });

    assert.equal((await from("203.0.113.1")).statusCode, 200);
    assert.equal((await from("203.0.113.1")).statusCode, 429);
    // A different client is untouched by the first one's limit.
    assert.equal((await from("203.0.113.2")).statusCode, 200);

    await app.close();
  });

  it("does not let a forged forwarding header split the bucket", async () => {
    const app = await buildApp({
      trustProxy: false,
      globalRateLimit: { max: 1, timeWindow: "1 minute" },
    });

    const from = (ip: string) =>
      app.inject({
        method: "GET",
        url: "/ping",
        headers: { "x-forwarded-for": ip },
      });

    assert.equal((await from("203.0.113.1")).statusCode, 200);
    assert.equal((await from("203.0.113.2")).statusCode, 429);

    await app.close();
  });
});
