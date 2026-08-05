import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import { PersonBankAccount } from "../domain/person-bank-account.js";
import { Person } from "../domain/person.js";
import type { OpenRecordCounts, PersonRole } from "../domain/person.js";
import type { OpenRecordsProvider } from "../infrastructure/open-records-provider.js";
import type {
  PersonFilter,
  PersonRepository,
} from "../infrastructure/person-repository.js";
import {
  validateBankAccountRequest,
  validateCreatePersonRequest,
  validatePersonRoleParam,
  validatePersonRoleRequest,
  validateUpdatePersonRequest,
} from "./dtos.js";

/**
 * Query string of the people listing.
 */
export interface ListPeopleQuery {
  role?: string | undefined;
  personType?: string | undefined;
  includeInactive?: string | boolean | undefined;
  search?: string | undefined;
}

/**
 * People endpoints. The company scope always comes from the token.
 */
export class PersonController {
  constructor(
    private readonly personRepository: PersonRepository,
    private readonly openRecords: OpenRecordsProvider,
    private readonly eventBus: DomainEventBus,
  ) {}

  /**
   * POST /api/v1/people
   */
  async create(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateCreatePersonRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const result = Person.create({ companyId, ...validation.data });
    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    const person = result.value;

    // Uniqueness is scoped to the company, so the same document may exist in
    // another one.
    const existing = await this.personRepository.findByDocument(
      companyId,
      person.document,
    );
    if (existing) {
      return {
        statusCode: 409,
        body: { error: "A person with this document already exists" },
      };
    }

    await this.personRepository.create(person);
    this.publish(person);

    return { statusCode: 201, body: person.toJSON() };
  }

  /**
   * GET /api/v1/people
   */
  async list(
    companyId: string,
    query: ListPeopleQuery = {},
  ): Promise<ControllerResult> {
    const filter: PersonFilter = {};

    if (query.role !== undefined) {
      const role = validatePersonRoleParam(query.role);
      if (!role.success) {
        return { statusCode: 400, body: { error: role.error.message } };
      }
      filter.role = role.data;
    }

    if (query.personType !== undefined) {
      if (query.personType !== "INDIVIDUAL" && query.personType !== "LEGAL_ENTITY") {
        return { statusCode: 400, body: { error: "Invalid personType" } };
      }
      filter.personType = query.personType;
    }

    if (query.search) {
      filter.search = query.search;
    }

    // Inactive people are hidden by default, as they can no longer be selected.
    const includeInactive =
      query.includeInactive === true || query.includeInactive === "true";
    if (!includeInactive) {
      filter.isActive = true;
    }

    const people = await this.personRepository.findByCompany(companyId, filter);

    return {
      statusCode: 200,
      body: { people: people.map((person) => person.toJSON()) },
    };
  }

  /**
   * GET /api/v1/customers and GET /api/v1/suppliers
   */
  async listByRole(
    companyId: string,
    role: PersonRole,
  ): Promise<ControllerResult> {
    const people = await this.personRepository.findByRole(companyId, role);

    return {
      statusCode: 200,
      body: { people: people.map((person) => person.toJSON()) },
    };
  }

  /**
   * GET /api/v1/people/:personId
   */
  async get(companyId: string, personId: string): Promise<ControllerResult> {
    const person = await this.personRepository.findById(companyId, personId);
    if (!person) {
      return { statusCode: 404, body: { error: "Person not found" } };
    }

    return { statusCode: 200, body: person.toJSON() };
  }

  /**
   * PUT /api/v1/people/:personId
   */
  async update(
    companyId: string,
    personId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateUpdatePersonRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const person = await this.personRepository.findById(companyId, personId);
    if (!person) {
      return { statusCode: 404, body: { error: "Person not found" } };
    }

    const result = person.edit(validation.data);
    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    await this.personRepository.update(person);
    this.publish(person);

    return { statusCode: 200, body: person.toJSON() };
  }

  /**
   * DELETE /api/v1/people/:personId — deactivates; people are never removed.
   */
  async deactivate(
    companyId: string,
    personId: string,
  ): Promise<ControllerResult> {
    const person = await this.personRepository.findById(companyId, personId);
    if (!person) {
      return { statusCode: 404, body: { error: "Person not found" } };
    }

    const counts = await this.openRecordCounts(companyId, personId);

    const result = person.deactivate(counts);
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.personRepository.update(person);
    this.publish(person);

    return { statusCode: 200, body: person.toJSON() };
  }

  /**
   * POST /api/v1/people/:personId/roles
   */
  async addRole(
    companyId: string,
    personId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validatePersonRoleRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const person = await this.personRepository.findById(companyId, personId);
    if (!person) {
      return { statusCode: 404, body: { error: "Person not found" } };
    }

    const result = person.addRole(validation.data.role);
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.personRepository.update(person);
    this.publish(person);

    return { statusCode: 200, body: person.toJSON() };
  }

  /**
   * DELETE /api/v1/people/:personId/roles/:role
   */
  async removeRole(
    companyId: string,
    personId: string,
    role: string,
  ): Promise<ControllerResult> {
    const validation = validatePersonRoleParam(role);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const person = await this.personRepository.findById(companyId, personId);
    if (!person) {
      return { statusCode: 404, body: { error: "Person not found" } };
    }

    // The domain receives the fact; it never reaches into the payments context.
    const counts = await this.openRecordCounts(companyId, personId);

    const result = person.removeRole(validation.data, counts);
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.personRepository.update(person);
    this.publish(person);

    return { statusCode: 200, body: person.toJSON() };
  }

  /**
   * POST /api/v1/people/:personId/bank-accounts
   */
  async addBankAccount(
    companyId: string,
    personId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateBankAccountRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const person = await this.personRepository.findById(companyId, personId);
    if (!person) {
      return { statusCode: 404, body: { error: "Person not found" } };
    }

    const result = PersonBankAccount.create({
      companyId,
      person,
      ...validation.data,
    });
    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    const account = result.value;
    await this.personRepository.createBankAccount(account);

    if (account.isDefault) {
      await this.applyDefault(companyId, personId, account.id);
    }

    return { statusCode: 201, body: account.toJSON() };
  }

  /**
   * GET /api/v1/people/:personId/bank-accounts
   */
  async listBankAccounts(
    companyId: string,
    personId: string,
  ): Promise<ControllerResult> {
    const person = await this.personRepository.findById(companyId, personId);
    if (!person) {
      return { statusCode: 404, body: { error: "Person not found" } };
    }

    const accounts = await this.personRepository.findBankAccounts(
      companyId,
      personId,
    );

    return {
      statusCode: 200,
      body: { bankAccounts: accounts.map((account) => account.toJSON()) },
    };
  }

  /**
   * PUT /api/v1/people/:personId/bank-accounts/:bankAccountId
   */
  async updateBankAccount(
    companyId: string,
    personId: string,
    bankAccountId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateBankAccountRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const account = await this.personRepository.findBankAccountById(
      companyId,
      bankAccountId,
    );
    if (!account || account.personId !== personId) {
      return { statusCode: 404, body: { error: "Bank account not found" } };
    }

    const result = account.edit({
      label: validation.data.label,
      pixKey: validation.data.pixKey ?? null,
      bank: validation.data.bank ?? null,
      branch: validation.data.branch ?? null,
      accountNumber: validation.data.accountNumber ?? null,
    });
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.personRepository.updateBankAccounts([account]);

    if (validation.data.isDefault) {
      await this.applyDefault(companyId, personId, bankAccountId);
    }

    const refreshed = await this.personRepository.findBankAccountById(
      companyId,
      bankAccountId,
    );

    return { statusCode: 200, body: (refreshed ?? account).toJSON() };
  }

  /**
   * DELETE /api/v1/people/:personId/bank-accounts/:bankAccountId
   */
  async deleteBankAccount(
    companyId: string,
    personId: string,
    bankAccountId: string,
  ): Promise<ControllerResult> {
    const account = await this.personRepository.findBankAccountById(
      companyId,
      bankAccountId,
    );
    if (!account || account.personId !== personId) {
      return { statusCode: 404, body: { error: "Bank account not found" } };
    }

    await this.personRepository.deleteBankAccount(companyId, bankAccountId);

    return { statusCode: 204, body: null };
  }

  /**
   * Makes one account the payee's default, clearing the flag from the others so
   * at most one default ever exists.
   */
  private async applyDefault(
    companyId: string,
    personId: string,
    bankAccountId: string,
  ): Promise<void> {
    const accounts = await this.personRepository.findBankAccounts(
      companyId,
      personId,
    );

    const changed = PersonBankAccount.makeDefault(accounts, bankAccountId);
    if (changed.isSuccess && changed.value) {
      await this.personRepository.updateBankAccounts(changed.value);
    }
  }

  private async openRecordCounts(
    companyId: string,
    personId: string,
  ): Promise<OpenRecordCounts> {
    const [openCharges, openPayables] = await Promise.all([
      this.openRecords.countOpenCharges(companyId, personId),
      this.openRecords.countOpenPayables(companyId, personId),
    ]);

    return { openCharges, openPayables };
  }

  private publish(person: Person): void {
    for (const event of person.events) {
      this.eventBus.publish(event);
    }
    person.clearEvents();
  }

  private orGeneric(error: DomainError | undefined): DomainError {
    return (
      error ??
      DomainError.create("BUSINESS_RULE_VIOLATION", "Operation not allowed")
    );
  }
}
