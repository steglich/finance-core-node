import assert from "node:assert/strict";
import { describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { DomainError } from "../../shared/domain/domain-error.js";
import {
  createJwtTokenService,
  DEFAULT_JWT_AUDIENCE,
  DEFAULT_JWT_ISSUER,
  MIN_JWT_SECRET_BYTES,
  type JwtTokenService,
} from "./jwt-token-service.js";

const SECRET = "a".repeat(MIN_JWT_SECRET_BYTES);
const PAYLOAD = { userId: "user-1", companyId: "company-1" };

/** Builds a service with a scoped environment, restoring it afterwards. */
function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const previous = { ...process.env };
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    process.env = previous;
  }
}

function buildService(
  env: Record<string, string | undefined> = {},
): JwtTokenService {
  return withEnv({ JWT_SECRET: SECRET, ...env }, () => createJwtTokenService());
}

describe("Signing secret strength", () => {
  it("refuses a secret shorter than the minimum", () => {
    assert.throws(
      () => buildService({ JWT_SECRET: "a".repeat(MIN_JWT_SECRET_BYTES - 1) }),
      /at least 32 bytes/,
    );
  });

  it("refuses an absent secret", () => {
    assert.throws(() => buildService({ JWT_SECRET: undefined }), /required/);
  });

  it("accepts a secret at the minimum length", () => {
    assert.doesNotThrow(() => buildService());
  });
});

describe("Token type separation", () => {
  it("accepts each token in its own role", () => {
    const service = buildService();

    assert.deepEqual(
      service.verifyAccessToken(service.generateAccessToken(PAYLOAD)),
      PAYLOAD,
    );
    assert.deepEqual(
      service.verifyRefreshToken(service.generateRefreshToken(PAYLOAD)),
      PAYLOAD,
    );
  });

  it("rejects a refresh token presented as a bearer credential", () => {
    const service = buildService();
    const refreshToken = service.generateRefreshToken(PAYLOAD);

    assert.throws(() => service.verifyAccessToken(refreshToken), DomainError);
  });

  it("rejects an access token presented for renewal", () => {
    const service = buildService();
    const accessToken = service.generateAccessToken(PAYLOAD);

    assert.throws(() => service.verifyRefreshToken(accessToken), DomainError);
  });

  it("rejects a correctly signed token from another issuer", () => {
    const service = buildService();
    const foreign = jwt.sign({ ...PAYLOAD, typ: "access" }, SECRET, {
      expiresIn: "15m",
      issuer: "someone-else",
      audience: DEFAULT_JWT_AUDIENCE,
    });

    assert.throws(() => service.verifyAccessToken(foreign), DomainError);
  });

  it("rejects a correctly signed token for another audience", () => {
    const service = buildService();
    const foreign = jwt.sign({ ...PAYLOAD, typ: "access" }, SECRET, {
      expiresIn: "15m",
      issuer: DEFAULT_JWT_ISSUER,
      audience: "another-api",
    });

    assert.throws(() => service.verifyAccessToken(foreign), DomainError);
  });

  it("rejects a legacy token carrying no type claim", () => {
    const service = buildService();
    const legacy = jwt.sign(PAYLOAD, SECRET, {
      expiresIn: "15m",
      issuer: DEFAULT_JWT_ISSUER,
      audience: DEFAULT_JWT_AUDIENCE,
    });

    assert.throws(() => service.verifyAccessToken(legacy), DomainError);
  });

  it("reads issuer and audience from the environment", () => {
    const service = buildService({
      JWT_ISSUER: "staging",
      JWT_AUDIENCE: "staging-api",
    });
    const decoded = service.decodeToken(
      service.generateAccessToken(PAYLOAD),
    ) as { iss: string; aud: string; typ: string };

    assert.equal(decoded.iss, "staging");
    assert.equal(decoded.aud, "staging-api");
    assert.equal(decoded.typ, "access");
  });
});
