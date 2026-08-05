import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { toHttpStatusCode } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import {
  createCostCenterRoutes,
  createCustomerRoutes,
  createPeopleRoutes,
  createSupplierRoutes,
} from "../../routes/registration-routes.js";
import type { CostCenter } from "../domain/cost-center.js";
import { PersonBankAccount } from "../domain/person-bank-account.js";
import type { Person, PersonRole } from "../domain/person.js";
import type { CostCenterRepository } from "../infrastructure/cost-center-repository.js";
import type { OpenRecordsProvider } from "../infrastructure/open-records-provider.js";
import type {
  PersonFilter,
  PersonRepository,
} from "../infrastructure/person-repository.js";
import { CostCenterController } from "./cost-center-controller.js";
import { PersonController } from "./person-controller.js";

const COMPANY_ID = "company-1";
const OTHER_COMPANY_ID = "company-2";

const CPF_A = "529.982.247-25";
const CPF_B = "111.444.777-35";
const CNPJ_A = "11.222.333/0001-81";

/* -------------------------------------------------------------------------- */
/* In-memory repositories                                                      */
/* -------------------------------------------------------------------------- */

class InMemoryPersonRepository implements PersonRepository {
  readonly items = new Map<string, Person>();
  readonly bankAccounts = new Map<string, PersonBankAccount>();

  async create(person: Person): Promise<void> {
    this.items.set(person.id, person);
  }

  async findById(companyId: string, id: string): Promise<Person | null> {
    const person = this.items.get(id);
    return person && person.companyId === companyId ? person : null;
  }

  async findByDocument(
    companyId: string,
    document: string,
  ): Promise<Person | null> {
    return (
      [...this.items.values()].find(
        (person) =>
          person.companyId === companyId && person.document === document,
      ) ?? null
    );
  }

  async findByCompany(
    companyId: string,
    filter: PersonFilter = {},
  ): Promise<Person[]> {
    return [...this.items.values()].filter((person) => {
      if (person.companyId !== companyId) return false;
      if (filter.isActive !== undefined && person.isActive !== filter.isActive) {
        return false;
      }
      if (filter.role && !person.hasRole(filter.role)) return false;
      if (filter.personType && person.personType !== filter.personType) {
        return false;
      }
      if (filter.search) {
        const term = filter.search.toLowerCase();
        if (
          !person.name.toLowerCase().includes(term) &&
          !person.document.includes(term)
        ) {
          return false;
        }
      }
      return true;
    });
  }

  async findByRole(companyId: string, role: PersonRole): Promise<Person[]> {
    return this.findByCompany(companyId, { role, isActive: true });
  }

  async update(person: Person): Promise<void> {
    this.items.set(person.id, person);
  }

  async createBankAccount(account: PersonBankAccount): Promise<void> {
    this.bankAccounts.set(account.id, account);
  }

  async findBankAccounts(
    companyId: string,
    personId: string,
  ): Promise<PersonBankAccount[]> {
    return [...this.bankAccounts.values()].filter(
      (account) =>
        account.companyId === companyId && account.personId === personId,
    );
  }

  async findBankAccountById(
    companyId: string,
    id: string,
  ): Promise<PersonBankAccount | null> {
    const account = this.bankAccounts.get(id);
    return account && account.companyId === companyId ? account : null;
  }

  async updateBankAccounts(
    accounts: readonly PersonBankAccount[],
  ): Promise<void> {
    for (const account of accounts) {
      this.bankAccounts.set(account.id, account);
    }
  }

  async deleteBankAccount(_companyId: string, id: string): Promise<boolean> {
    return this.bankAccounts.delete(id);
  }
}

class InMemoryCostCenterRepository implements CostCenterRepository {
  readonly items = new Map<string, CostCenter>();
  activeBudgets = new Map<string, number>();

  async create(costCenter: CostCenter): Promise<void> {
    this.items.set(costCenter.id, costCenter);
  }

  async findById(companyId: string, id: string): Promise<CostCenter | null> {
    const costCenter = this.items.get(id);
    return costCenter && costCenter.companyId === companyId ? costCenter : null;
  }

  async findByCompany(companyId: string): Promise<CostCenter[]> {
    return [...this.items.values()].filter(
      (costCenter) => costCenter.companyId === companyId,
    );
  }

  async update(costCenter: CostCenter): Promise<void> {
    this.items.set(costCenter.id, costCenter);
  }

  async updateMany(costCenters: readonly CostCenter[]): Promise<void> {
    for (const costCenter of costCenters) {
      this.items.set(costCenter.id, costCenter);
    }
  }

  async countActiveBudgets(
    _companyId: string,
    costCenterIds: readonly string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const id of costCenterIds) {
      const count = this.activeBudgets.get(id);
      if (count) counts.set(id, count);
    }
    return counts;
  }
}

/**
 * Stands in for the payments context, so the registry can be exercised without
 * importing anything from it.
 */
class StubOpenRecords implements OpenRecordsProvider {
  charges = 0;
  payables = 0;

  async countOpenCharges(): Promise<number> {
    return this.charges;
  }

  async countOpenPayables(): Promise<number> {
    return this.payables;
  }
}

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

interface Harness {
  app: FastifyInstance;
  people: InMemoryPersonRepository;
  costCenters: InMemoryCostCenterRepository;
  openRecords: StubOpenRecords;
}

async function harness(companyId = COMPANY_ID): Promise<Harness> {
  const app = Fastify();

  app.setErrorHandler((error: Error, _request, reply) => {
    if (error instanceof DomainError) {
      return reply
        .code(toHttpStatusCode(error.code))
        .send({ error: error.message });
    }
    return reply.code(500).send({ error: error.message });
  });

  const people = new InMemoryPersonRepository();
  const costCenters = new InMemoryCostCenterRepository();
  const openRecords = new StubOpenRecords();
  const eventBus = new DomainEventBus();

  const authenticate = (async (request: {
    authContext?: { userId: string; companyId: string };
  }) => {
    request.authContext = { userId: "user-1", companyId };
    return undefined;
  }) as never;

  const deps = {
    personController: new PersonController(people, openRecords, eventBus),
    costCenterController: new CostCenterController(costCenters, eventBus),
    ledgerController: undefined as never,
    authenticate,
  };

  await app.register(createPeopleRoutes(deps), { prefix: "/people" });
  await app.register(createCustomerRoutes(deps), { prefix: "/customers" });
  await app.register(createSupplierRoutes(deps), { prefix: "/suppliers" });
  await app.register(createCostCenterRoutes(deps), { prefix: "/cost-centers" });
  await app.ready();

  return { app, people, costCenters, openRecords };
}

async function createPerson(
  context: Harness,
  body: Record<string, unknown> = {},
): Promise<{ id: string; [key: string]: unknown }> {
  const response = await context.app.inject({
    method: "POST",
    url: "/people",
    payload: {
      name: "João Silva",
      personType: "INDIVIDUAL",
      document: CPF_A,
      ...body,
    },
  });

  assert.equal(response.statusCode, 201, response.body);
  return response.json() as { id: string };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe("People API", () => {
  it("registers an individual and stores the document unmasked", async () => {
    const context = await harness();

    const person = await createPerson(context);

    assert.equal(person.document, "52998224725");
    assert.equal(person.isActive, true);
    assert.equal(person.companyId, COMPANY_ID);
  });

  it("registers a legal entity with a CNPJ", async () => {
    const context = await harness();

    const person = await createPerson(context, {
      name: "Fornecedor XYZ",
      personType: "LEGAL_ENTITY",
      document: CNPJ_A,
    });

    assert.equal(person.personType, "LEGAL_ENTITY");
  });

  it("rejects an invalid document and a mismatched type", async () => {
    const context = await harness();

    const invalidDigits = await context.app.inject({
      method: "POST",
      url: "/people",
      payload: {
        name: "João",
        personType: "INDIVIDUAL",
        document: "529.982.247-26",
      },
    });
    assert.equal(invalidDigits.statusCode, 400);

    const wrongType = await context.app.inject({
      method: "POST",
      url: "/people",
      payload: {
        name: "João",
        personType: "INDIVIDUAL",
        document: CNPJ_A,
      },
    });
    assert.equal(wrongType.statusCode, 400);
  });

  it("rejects a duplicate document inside the company and accepts it in another", async () => {
    const context = await harness();
    const theirs = await harness(OTHER_COMPANY_ID);

    await createPerson(context);

    const duplicate = await context.app.inject({
      method: "POST",
      url: "/people",
      payload: {
        name: "Outro João",
        personType: "INDIVIDUAL",
        document: CPF_A,
      },
    });
    assert.equal(duplicate.statusCode, 409);

    // Uniqueness is scoped to the company.
    await createPerson(theirs);
  });

  it("classifies a person and lists it under the matching role", async () => {
    const context = await harness();
    const person = await createPerson(context);

    for (const role of ["CUSTOMER", "SUPPLIER"]) {
      const response = await context.app.inject({
        method: "POST",
        url: `/people/${person.id}/roles`,
        payload: { role },
      });
      assert.equal(response.statusCode, 200);
    }

    const customers = await context.app.inject({
      method: "GET",
      url: "/customers",
    });
    const suppliers = await context.app.inject({
      method: "GET",
      url: "/suppliers",
    });

    assert.equal((customers.json() as { people: unknown[] }).people.length, 1);
    assert.equal((suppliers.json() as { people: unknown[] }).people.length, 1);
  });

  it("refuses to remove a classification that an open record still uses", async () => {
    const context = await harness();
    const person = await createPerson(context, { roles: ["CUSTOMER"] });
    context.openRecords.charges = 1;

    const response = await context.app.inject({
      method: "DELETE",
      url: `/people/${person.id}/roles/CUSTOMER`,
    });

    assert.equal(response.statusCode, 400);
  });

  it("edits the mutable fields and refuses to change the document", async () => {
    const context = await harness();
    const person = await createPerson(context);

    const edited = await context.app.inject({
      method: "PUT",
      url: `/people/${person.id}`,
      payload: { phone: "+5511999999999", address: { city: "São Paulo" } },
    });
    assert.equal(edited.statusCode, 200);
    assert.equal(
      (edited.json() as Record<string, unknown>).phone,
      "+5511999999999",
    );

    const immutable = await context.app.inject({
      method: "PUT",
      url: `/people/${person.id}`,
      payload: { document: CPF_B },
    });
    assert.equal(immutable.statusCode, 400);
  });

  it("deactivates a person only when nothing is open", async () => {
    const context = await harness();
    const person = await createPerson(context);
    context.openRecords.charges = 1;

    const blocked = await context.app.inject({
      method: "DELETE",
      url: `/people/${person.id}`,
    });
    assert.equal(blocked.statusCode, 400);

    context.openRecords.charges = 0;
    const deactivated = await context.app.inject({
      method: "DELETE",
      url: `/people/${person.id}`,
    });
    assert.equal(deactivated.statusCode, 200);
    assert.equal(
      (deactivated.json() as Record<string, unknown>).isActive,
      false,
    );

    // Inactive people drop out of the default listing.
    const listed = await context.app.inject({ method: "GET", url: "/people" });
    assert.equal((listed.json() as { people: unknown[] }).people.length, 0);
  });

  it("returns not found for a person of another company", async () => {
    const mine = await harness();
    const theirs = await harness(OTHER_COMPANY_ID);
    const person = await createPerson(mine);

    const response = await theirs.app.inject({
      method: "GET",
      url: `/people/${person.id}`,
    });

    assert.equal(response.statusCode, 404);
  });
});

describe("Payee bank accounts API", () => {
  it("registers a PIX key for a payee and rejects one for a non-payee", async () => {
    const context = await harness();
    const payee = await createPerson(context, { roles: ["PAYEE"] });
    const other = await createPerson(context, {
      name: "Sem papel",
      document: CPF_B,
    });

    const accepted = await context.app.inject({
      method: "POST",
      url: `/people/${payee.id}/bank-accounts`,
      payload: { label: "Conta principal", pixKey: "maria@empresa.com" },
    });
    assert.equal(accepted.statusCode, 201);
    assert.equal(
      (accepted.json() as Record<string, unknown>).pixKeyType,
      "EMAIL",
    );

    const rejected = await context.app.inject({
      method: "POST",
      url: `/people/${other.id}/bank-accounts`,
      payload: { label: "Conta", pixKey: "maria@empresa.com" },
    });
    assert.equal(rejected.statusCode, 400);
  });

  it("rejects a PIX key matching none of the accepted forms", async () => {
    const context = await harness();
    const payee = await createPerson(context, { roles: ["PAYEE"] });

    const response = await context.app.inject({
      method: "POST",
      url: `/people/${payee.id}/bank-accounts`,
      payload: { label: "Conta", pixKey: "12345" },
    });

    assert.equal(response.statusCode, 400);
  });

  it("keeps at most one default account", async () => {
    const context = await harness();
    const payee = await createPerson(context, { roles: ["PAYEE"] });

    await context.app.inject({
      method: "POST",
      url: `/people/${payee.id}/bank-accounts`,
      payload: {
        label: "Primeira",
        pixKey: "maria@empresa.com",
        isDefault: true,
      },
    });
    const second = (await context.app.inject({
      method: "POST",
      url: `/people/${payee.id}/bank-accounts`,
      payload: {
        label: "Segunda",
        pixKey: "52998224725",
        isDefault: true,
      },
    })).json() as { id: string };

    const listed = (await context.app.inject({
      method: "GET",
      url: `/people/${payee.id}/bank-accounts`,
    })).json() as { bankAccounts: { id: string; isDefault: boolean }[] };

    const defaults = listed.bankAccounts.filter((account) => account.isDefault);
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0]?.id, second.id);
  });
});

describe("Cost centers API", () => {
  async function createCostCenter(
    context: Harness,
    body: Record<string, unknown>,
  ): Promise<{ id: string; [key: string]: unknown }> {
    const response = await context.app.inject({
      method: "POST",
      url: "/cost-centers",
      payload: body,
    });

    assert.equal(response.statusCode, 201, response.body);
    return response.json() as { id: string };
  }

  it("creates a root and a child cost center", async () => {
    const context = await harness();

    const marketing = await createCostCenter(context, { name: "Marketing" });
    const midia = await createCostCenter(context, {
      name: "Mídia Paga",
      parentId: marketing.id,
    });

    assert.equal(marketing.parentId, undefined);
    assert.equal(midia.parentId, marketing.id);
  });

  it("rejects a duplicate name among siblings but accepts it elsewhere", async () => {
    const context = await harness();
    const marketing = await createCostCenter(context, { name: "Marketing" });
    const rh = await createCostCenter(context, { name: "RH" });

    const duplicate = await context.app.inject({
      method: "POST",
      url: "/cost-centers",
      payload: { name: "Marketing" },
    });
    assert.equal(duplicate.statusCode, 409);

    await createCostCenter(context, {
      name: "Eventos",
      parentId: marketing.id,
    });
    await createCostCenter(context, { name: "Eventos", parentId: rh.id });
  });

  it("rejects a fourth level", async () => {
    const context = await harness();
    const level1 = await createCostCenter(context, { name: "Nível 1" });
    const level2 = await createCostCenter(context, {
      name: "Nível 2",
      parentId: level1.id,
    });
    const level3 = await createCostCenter(context, {
      name: "Nível 3",
      parentId: level2.id,
    });

    const level4 = await context.app.inject({
      method: "POST",
      url: "/cost-centers",
      payload: { name: "Nível 4", parentId: level3.id },
    });

    assert.equal(level4.statusCode, 400);
  });

  it("returns the cost centers as a tree", async () => {
    const context = await harness();
    const marketing = await createCostCenter(context, { name: "Marketing" });
    await createCostCenter(context, {
      name: "Mídia Paga",
      parentId: marketing.id,
    });

    const response = await context.app.inject({
      method: "GET",
      url: "/cost-centers",
    });

    const body = response.json() as {
      tree: { costCenter: { id: string }; children: unknown[] }[];
    };
    assert.equal(body.tree.length, 1);
    assert.equal(body.tree[0]?.costCenter.id, marketing.id);
    assert.equal(body.tree[0]?.children.length, 1);
  });

  it("deactivates a cost center together with its descendants", async () => {
    const context = await harness();
    const marketing = await createCostCenter(context, { name: "Marketing" });
    await createCostCenter(context, {
      name: "Mídia Paga",
      parentId: marketing.id,
    });

    const response = await context.app.inject({
      method: "DELETE",
      url: `/cost-centers/${marketing.id}`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(
      (response.json() as { deactivated: unknown[] }).deactivated.length,
      2,
    );

    const listed = (await context.app.inject({
      method: "GET",
      url: "/cost-centers",
    })).json() as { costCenters: unknown[] };
    assert.equal(listed.costCenters.length, 0);
  });

  it("refuses to deactivate while an active budget references the subtree", async () => {
    const context = await harness();
    const marketing = await createCostCenter(context, { name: "Marketing" });
    const midia = await createCostCenter(context, {
      name: "Mídia Paga",
      parentId: marketing.id,
    });
    context.costCenters.activeBudgets.set(midia.id, 1);

    const response = await context.app.inject({
      method: "DELETE",
      url: `/cost-centers/${marketing.id}`,
    });

    assert.equal(response.statusCode, 400);
    // Nothing is left half deactivated.
    const listed = (await context.app.inject({
      method: "GET",
      url: "/cost-centers",
    })).json() as { costCenters: unknown[] };
    assert.equal(listed.costCenters.length, 2);
  });

  it("isolates cost centers by company", async () => {
    const mine = await harness();
    const theirs = await harness(OTHER_COMPANY_ID);
    const marketing = await createCostCenter(mine, { name: "Marketing" });

    const response = await theirs.app.inject({
      method: "GET",
      url: `/cost-centers/${marketing.id}`,
    });

    assert.equal(response.statusCode, 404);
  });
});
