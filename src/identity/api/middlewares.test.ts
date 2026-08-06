import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FastifyRequest, preHandlerHookHandler } from "fastify";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Permission, Profile } from "../domain/profile.js";
import type { CompanyRepository } from "../infrastructure/company-repository.js";
import type { ProfileRepository } from "../infrastructure/profile-repository.js";
import { defaultPermissions } from "../../seeds/01_default_data.js";
import { createRequirePermission } from "./middlewares.js";

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const PROFILE_ID = "33333333-3333-3333-3333-333333333333";

/** The administrator profile as the default seed provisions it. */
function seededAdminProfile(): Profile {
  return new Profile(
    PROFILE_ID,
    COMPANY_ID,
    "Administrador",
    defaultPermissions.map((p) => new Permission(p.resource, p.action)),
  );
}

function fakeDeps(profile: Profile): {
  companyRepository: CompanyRepository;
  profileRepository: ProfileRepository;
} {
  return {
    companyRepository: {
      findUserProfileId: async () => profile.id,
    } as unknown as CompanyRepository,
    profileRepository: {
      findById: async () => profile,
    } as unknown as ProfileRepository,
  };
}

/** Invokes a preHandler hook with only the argument it actually reads. */
function runHook(hook: preHandlerHookHandler): Promise<unknown> {
  const run = hook as unknown as (request: FastifyRequest) => Promise<unknown>;
  return run(authenticatedRequest());
}

function authenticatedRequest(): FastifyRequest {
  return {
    authContext: { userId: USER_ID, companyId: COMPANY_ID },
  } as unknown as FastifyRequest;
}

describe("requirePermission against the default seed", () => {
  it("grants audit MANAGE to a profile provisioned with the default permissions", async () => {
    const hook = createRequirePermission(fakeDeps(seededAdminProfile()))(
      "audit",
      "MANAGE",
    );

    await runHook(hook);
  });

  it("still refuses a resource the profile was not granted", async () => {
    const bare = new Profile(PROFILE_ID, COMPANY_ID, "Usuário Padrão", [
      new Permission("transactions", "READ"),
    ]);
    const hook = createRequirePermission(fakeDeps(bare))("audit", "MANAGE");

    await assert.rejects(runHook(hook), DomainError);
  });
});
