import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PersonBankAccount } from "./person-bank-account.js";
import { Person } from "./person.js";
import type { CreatePersonInput } from "./person.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const CPF_A = "52998224725";
const CPF_B = "11144477735";
const CNPJ_A = "11222333000181";

const NO_OPEN_RECORDS = { openCharges: 0, openPayables: 0 };

function register(overrides: Partial<CreatePersonInput> = {}): Person {
  const result = Person.create({
    companyId: COMPANY,
    name: "João Silva",
    personType: "INDIVIDUAL",
    document: CPF_A,
    ...overrides,
  });

  assert.equal(result.isSuccess, true, result.error?.message ?? "");
  return result.value!;
}

describe("Person registration", () => {
  it("registers an individual as active and raises PersonRegistered", () => {
    const person = register();

    assert.equal(person.isActive, true);
    assert.equal(person.personType, "INDIVIDUAL");
    assert.deepEqual(person.roles, []);
    assert.deepEqual(
      person.events.map((event) => event.getEventType()),
      ["PersonRegistered"],
    );
  });

  it("registers a legal entity with a CNPJ", () => {
    const person = register({
      name: "Fornecedor XYZ",
      personType: "LEGAL_ENTITY",
      document: "11.222.333/0001-81",
    });

    assert.equal(person.personType, "LEGAL_ENTITY");
    assert.equal(person.document, CNPJ_A);
  });

  it("stores the document unmasked", () => {
    assert.equal(register({ document: "529.982.247-25" }).document, CPF_A);
  });

  it("rejects a document whose check digits are wrong", () => {
    const result = Person.create({
      companyId: COMPANY,
      name: "João Silva",
      personType: "INDIVIDUAL",
      document: "52998224726",
    });

    assert.equal(result.isFailure, true);
    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });

  it("rejects a document that does not match the person type", () => {
    const individualWithCnpj = Person.create({
      companyId: COMPANY,
      name: "João Silva",
      personType: "INDIVIDUAL",
      document: CNPJ_A,
    });
    assert.equal(individualWithCnpj.isFailure, true);

    const entityWithCpf = Person.create({
      companyId: COMPANY,
      name: "Fornecedor XYZ",
      personType: "LEGAL_ENTITY",
      document: CPF_A,
    });
    assert.equal(entityWithCpf.isFailure, true);
  });

  it("rejects an empty name and an invalid email", () => {
    assert.equal(Person.create({
      companyId: COMPANY,
      name: "   ",
      personType: "INDIVIDUAL",
      document: CPF_A,
    }).isFailure, true);

    assert.equal(Person.create({
      companyId: COMPANY,
      name: "João Silva",
      personType: "INDIVIDUAL",
      document: CPF_A,
      email: "not-an-email@",
    }).isFailure, true);
  });

  it("requires a company", () => {
    const result = Person.create({
      companyId: "",
      name: "João Silva",
      personType: "INDIVIDUAL",
      document: CPF_A,
    });

    assert.equal(result.error?.code, "COMPANY_CONTEXT_REQUIRED");
  });
});

describe("Person classification", () => {
  it("holds several roles at once", () => {
    const person = register();

    assert.equal(person.addRole("CUSTOMER").isSuccess, true);
    assert.equal(person.addRole("SUPPLIER").isSuccess, true);

    assert.equal(person.hasRole("CUSTOMER"), true);
    assert.equal(person.hasRole("SUPPLIER"), true);
    assert.equal(person.hasRole("PAYEE"), false);
  });

  it("treats adding a role twice as a no-op", () => {
    const person = register();
    person.addRole("CUSTOMER");

    assert.equal(person.addRole("CUSTOMER").isSuccess, true);
    assert.deepEqual(person.roles, ["CUSTOMER"]);
  });

  it("removes a role that has no open records", () => {
    const person = register();
    person.addRole("CUSTOMER");

    assert.equal(person.removeRole("CUSTOMER", NO_OPEN_RECORDS).isSuccess, true);
    assert.equal(person.hasRole("CUSTOMER"), false);
  });

  it("refuses to remove CUSTOMER while a charge is open", () => {
    const person = register();
    person.addRole("CUSTOMER");

    const result = person.removeRole("CUSTOMER", {
      openCharges: 1,
      openPayables: 0,
    });

    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
    assert.equal(person.hasRole("CUSTOMER"), true);
  });

  it("refuses to remove SUPPLIER while a payable is open", () => {
    const person = register();
    person.addRole("SUPPLIER");

    const result = person.removeRole("SUPPLIER", {
      openCharges: 0,
      openPayables: 2,
    });

    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
  });

  it("does not let an open charge block the removal of an unrelated role", () => {
    const person = register();
    person.addRole("PAYEE");

    const result = person.removeRole("PAYEE", {
      openCharges: 3,
      openPayables: 3,
    });

    assert.equal(result.isSuccess, true);
  });

  it("rejects removing a role the person does not hold", () => {
    const result = register().removeRole("CUSTOMER", NO_OPEN_RECORDS);
    assert.equal(result.error?.code, "INVALID_OPERATION");
  });
});

describe("Person editing", () => {
  it("edits the mutable fields", () => {
    const person = register();

    const result = person.edit({
      name: "João da Silva",
      phone: "+5511999999999",
      address: { city: "São Paulo", state: "SP" },
      email: "joao@empresa.com",
    });

    assert.equal(result.isSuccess, true);
    assert.equal(person.name, "João da Silva");
    assert.equal(person.phone, "+5511999999999");
    assert.equal(person.email, "joao@empresa.com");
    assert.equal(person.address?.city, "São Paulo");
  });

  it("clears an optional field when null is passed", () => {
    const person = register({ email: "joao@empresa.com", phone: "123" });

    person.edit({ email: null, phone: null });

    assert.equal(person.email, undefined);
    assert.equal(person.phone, undefined);
  });

  it("leaves the document and the person type untouched", () => {
    const person = register();

    // Neither field is part of EditPersonInput, so the compiler already rejects
    // the attempt; this pins the runtime behaviour of an edit next to them.
    person.edit({ name: "Outro Nome" });

    assert.equal(person.document, CPF_A);
    assert.equal(person.personType, "INDIVIDUAL");
  });

  it("rejects an invalid email and keeps the previous one", () => {
    const person = register({ email: "joao@empresa.com" });

    const result = person.edit({ email: "@invalid" });

    assert.equal(result.error?.code, "VALIDATION_ERROR");
    assert.equal(person.email, "joao@empresa.com");
  });

  it("rejects an empty name", () => {
    assert.equal(register().edit({ name: "  " }).error?.code, "VALIDATION_ERROR");
  });
});

describe("Person deactivation", () => {
  it("deactivates a person with no open records", () => {
    const person = register();

    assert.equal(person.deactivate(NO_OPEN_RECORDS).isSuccess, true);
    assert.equal(person.isActive, false);
  });

  it("refuses to deactivate while a charge or a payable is open", () => {
    const withCharge = register();
    assert.equal(
      withCharge.deactivate({ openCharges: 1, openPayables: 0 }).error?.code,
      "BUSINESS_RULE_VIOLATION",
    );
    assert.equal(withCharge.isActive, true);

    const withPayable = register({ document: CPF_B });
    assert.equal(
      withPayable.deactivate({ openCharges: 0, openPayables: 1 }).error?.code,
      "BUSINESS_RULE_VIOLATION",
    );
  });

  it("refuses to deactivate twice, and refuses to edit or classify afterwards", () => {
    const person = register();
    person.deactivate(NO_OPEN_RECORDS);

    assert.equal(person.deactivate(NO_OPEN_RECORDS).error?.code, "INVALID_OPERATION");
    assert.equal(person.edit({ name: "Novo" }).error?.code, "INVALID_OPERATION");
    assert.equal(person.addRole("CUSTOMER").error?.code, "INVALID_OPERATION");
  });
});

describe("PersonBankAccount", () => {
  function payee(): Person {
    const person = register();
    person.addRole("PAYEE");
    return person;
  }

  it("registers a PIX key for a payee", () => {
    const result = PersonBankAccount.create({
      companyId: COMPANY,
      person: payee(),
      label: "Conta principal",
      pixKey: "maria@empresa.com",
    });

    assert.equal(result.isSuccess, true);
    assert.equal(result.value?.pixKey, "maria@empresa.com");
    assert.equal(result.value?.pixKeyType, "EMAIL");
  });

  it("registers a bank/branch/account triple without a PIX key", () => {
    const result = PersonBankAccount.create({
      companyId: COMPANY,
      person: payee(),
      label: "Conta corrente",
      bank: "001",
      branch: "1234",
      accountNumber: "56789-0",
    });

    assert.equal(result.isSuccess, true);
    assert.equal(result.value?.pixKey, undefined);
  });

  it("rejects an invalid PIX key", () => {
    const result = PersonBankAccount.create({
      companyId: COMPANY,
      person: payee(),
      label: "Conta",
      pixKey: "12345",
    });

    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });

  it("rejects bank details with neither a PIX key nor a complete triple", () => {
    const result = PersonBankAccount.create({
      companyId: COMPANY,
      person: payee(),
      label: "Conta",
      bank: "001",
    });

    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });

  it("rejects bank details for a person who is not a payee", () => {
    const result = PersonBankAccount.create({
      companyId: COMPANY,
      person: register(),
      label: "Conta",
      pixKey: "maria@empresa.com",
    });

    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
  });

  it("rejects bank details for a person of another company", () => {
    const result = PersonBankAccount.create({
      companyId: "22222222-2222-2222-2222-222222222222",
      person: payee(),
      label: "Conta",
      pixKey: "maria@empresa.com",
    });

    assert.equal(result.error?.code, "UNAUTHORIZED_ACCESS");
  });

  it("keeps at most one default account", () => {
    const person = payee();
    const first = PersonBankAccount.create({
      companyId: COMPANY,
      person,
      label: "Primeira",
      pixKey: "maria@empresa.com",
      isDefault: true,
    }).value!;
    const second = PersonBankAccount.create({
      companyId: COMPANY,
      person,
      label: "Segunda",
      pixKey: CPF_B,
    }).value!;

    const changed = PersonBankAccount.makeDefault([first, second], second.id);

    assert.equal(changed.isSuccess, true);
    assert.equal(first.isDefault, false);
    assert.equal(second.isDefault, true);
  });

  it("reports an unknown account when making a default", () => {
    const result = PersonBankAccount.makeDefault([], "missing");
    assert.equal(result.error?.code, "ENTITY_NOT_FOUND");
  });
});
