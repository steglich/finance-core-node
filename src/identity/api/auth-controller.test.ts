import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DomainError } from "../../shared/domain/domain-error.js";
import { toHttpStatusCode } from "../../shared/api/controller-result.js";
import type { PasswordService } from "../domain/password-service.js";
import { User } from "../domain/user.js";
import type { CompanyRepository } from "../infrastructure/company-repository.js";
import type { ProfileRepository } from "../infrastructure/profile-repository.js";
import type { UserRepository } from "../infrastructure/user-repository.js";
import type { JwtTokenService } from "../infrastructure/jwt-token-service.js";
import type { AccessLogRepository } from "../../auditoria/infrastructure/audit-repository.js";
import type { AccessLog } from "../../auditoria/domain/access-log.js";
import type { DatabaseConnection } from "../../shared/infrastructure/database-connection.js";
import type { CategoryRepository } from "../../financeiro/infrastructure/category-repository.js";
import { AuthController } from "./auth-controller.js";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const COMPANY_ID = "22222222-2222-2222-2222-222222222222";
const EMAIL = "user@example.com";
const PASSWORD = "senha-correta";
const HASH = "hash-of-senha-correta";

/** Counts the work each path performs, which is what the timing claim rests on. */
interface PasswordProbe extends PasswordService {
  verifications: number;
  discardedVerifications: number;
}

function fakePasswordService(): PasswordProbe {
  const probe = {
    verifications: 0,
    discardedVerifications: 0,
    hash: async () => HASH,
    verify: async (plainText: string, hashed: string) => {
      probe.verifications += 1;
      return plainText === PASSWORD && hashed === HASH;
    },
    verifyDiscarded: async () => {
      probe.discardedVerifications += 1;
    },
  };
  return probe as PasswordProbe;
}

interface Harness {
  controller: AuthController;
  password: PasswordProbe;
  accessLogs: AccessLog[];
  issuedRefreshTokens: string[];
}

function buildController(options: {
  user?: User | null;
  companies?: string[];
  refreshTokenValid?: boolean;
} = {}): Harness {
  const user = options.user === undefined ? new User(USER_ID, EMAIL, "User", HASH) : options.user;
  const companies = options.companies ?? [COMPANY_ID];
  const password = fakePasswordService();
  const accessLogs: AccessLog[] = [];
  const issuedRefreshTokens: string[] = [];

  const userRepository = {
    findByEmail: async (email: string) =>
      user && user.email === email ? user : null,
    findById: async (id: string) => (user && user.id === id ? user : null),
  } as unknown as UserRepository;

  const companyRepository = {
    findUserCompanies: async () => companies,
  } as unknown as CompanyRepository;

  let issued = 0;
  const jwtTokenService = {
    generateAccessToken: () => `access-${(issued += 1)}`,
    generateRefreshToken: () => {
      const token = `refresh-${(issued += 1)}`;
      issuedRefreshTokens.push(token);
      return token;
    },
    verifyRefreshToken: () => {
      if (options.refreshTokenValid === false) {
        throw DomainError.create("UNAUTHORIZED", "Invalid refresh token");
      }
      return { userId: USER_ID, companyId: COMPANY_ID };
    },
  } as unknown as JwtTokenService;

  const accessLogRepository = {
    append: async (log: AccessLog) => {
      accessLogs.push(log);
    },
  } as unknown as AccessLogRepository;

  const controller = new AuthController(
    userRepository,
    companyRepository,
    {} as ProfileRepository,
    password,
    jwtTokenService,
    {} as CategoryRepository,
    {} as DatabaseConnection,
    accessLogRepository,
  );

  return { controller, password, accessLogs, issuedRefreshTokens };
}

/** Captures the domain error a login attempt throws, as HTTP status + message. */
async function loginFailure(
  harness: Harness,
  email: string,
  password: string,
  ip = "203.0.113.9",
): Promise<{ status: number; message: string }> {
  try {
    await harness.controller.login({ email, password }, ip);
  } catch (error) {
    assert.ok(error instanceof DomainError);
    return { status: toHttpStatusCode(error.code), message: error.message };
  }
  throw new Error("expected the login to fail");
}

describe("Login failure uniformity", () => {
  it("answers identically for an unknown email and for a wrong password", async () => {
    const unknown = buildController();
    const wrongPassword = buildController();

    const unknownEmail = await loginFailure(unknown, "nobody@example.com", PASSWORD);
    const badPassword = await loginFailure(wrongPassword, EMAIL, "senha-errada");

    assert.deepEqual(unknownEmail, badPassword);
    assert.equal(unknownEmail.status, 401);
    assert.equal(unknownEmail.message, "Email ou senha incorretos");
  });

  it("never echoes the submitted email back", async () => {
    const harness = buildController();
    const failure = await loginFailure(harness, "nobody@example.com", PASSWORD);

    assert.ok(!failure.message.includes("nobody@example.com"));
  });

  it("performs password verification work for an unknown email", async () => {
    const harness = buildController();
    await loginFailure(harness, "nobody@example.com", PASSWORD);

    assert.equal(harness.password.discardedVerifications, 1);
  });

  it("answers identically for a deactivated account", async () => {
    const inactive = new User(USER_ID, EMAIL, "User", HASH, "INACTIVE");
    const harness = buildController({ user: inactive });

    const failure = await loginFailure(harness, EMAIL, PASSWORD);

    assert.equal(failure.status, 401);
    assert.equal(failure.message, "Email ou senha incorretos");
  });

  it("still records the access trail with the resolved IP", async () => {
    const failed = buildController();
    await loginFailure(failed, "nobody@example.com", PASSWORD, "203.0.113.42");

    assert.equal(failed.accessLogs.length, 1);
    assert.equal(failed.accessLogs[0]?.eventType, "LOGIN_FAILED");
    assert.equal(failed.accessLogs[0]?.ipAddress, "203.0.113.42");

    const succeeded = buildController();
    await succeeded.controller.login(
      { email: EMAIL, password: PASSWORD },
      "203.0.113.43",
    );

    assert.equal(succeeded.accessLogs[0]?.eventType, "LOGIN_SUCCESS");
    assert.equal(succeeded.accessLogs[0]?.ipAddress, "203.0.113.43");
  });
});

describe("Refresh revalidation", () => {
  it("issues a new access token and a new refresh token to an intact user", async () => {
    const harness = buildController();

    const result = await harness.controller.refresh({ refreshToken: "r" });
    const tokens = (result.body as { tokens: { accessToken: string; refreshToken: string } })
      .tokens;

    assert.equal(result.statusCode, 200);
    assert.ok(tokens.accessToken);
    // Rotation: the renewal hands back a refresh token of its own.
    assert.ok(harness.issuedRefreshTokens.includes(tokens.refreshToken));
  });

  it("refuses renewal for a deactivated user", async () => {
    const inactive = new User(USER_ID, EMAIL, "User", HASH, "INACTIVE");
    const harness = buildController({ user: inactive });

    const result = await harness.controller.refresh({ refreshToken: "r" });

    assert.equal(result.statusCode, 401);
  });

  it("refuses renewal when the user no longer belongs to the token's company", async () => {
    const harness = buildController({ companies: ["another-company"] });

    const result = await harness.controller.refresh({ refreshToken: "r" });

    assert.equal(result.statusCode, 401);
  });

  it("refuses renewal for a user that no longer exists", async () => {
    const harness = buildController({ user: null });

    const result = await harness.controller.refresh({ refreshToken: "r" });

    assert.equal(result.statusCode, 401);
  });
});

describe("Password reset endpoint", () => {
  it("declares itself unimplemented instead of reporting success", async () => {
    const harness = buildController();

    await assert.rejects(
      harness.controller.resetPassword({
        token: "any-token",
        newPassword: "uma-senha-nova",
      }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, "NOT_IMPLEMENTED");
        assert.equal(toHttpStatusCode(error.code), 501);
        return true;
      },
    );
  });
});
