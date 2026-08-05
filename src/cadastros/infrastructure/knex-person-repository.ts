import type { Knex } from "knex";
import { PersonBankAccount } from "../domain/person-bank-account.js";
import { Person } from "../domain/person.js";
import type {
  PersonAddress,
  PersonRole,
  PersonType,
} from "../domain/person.js";
import type { PersonFilter, PersonRepository } from "./person-repository.js";

/**
 * Maps a `people` row plus its roles into the Person aggregate.
 */
function toPerson(
  row: Record<string, unknown>,
  roles: readonly PersonRole[],
): Person {
  return new Person({
    id: row.id as string,
    companyId: row.company_id as string,
    name: row.name as string,
    personType: row.person_type as PersonType,
    document: row.document as string,
    email: (row.email as string | null) ?? undefined,
    phone: (row.phone as string | null) ?? undefined,
    address: (row.address as PersonAddress | null) ?? undefined,
    roles,
    isActive: Boolean(row.is_active),
    createdAt: new Date(row.created_at as string),
  });
}

/**
 * Maps a `person_bank_accounts` row into the entity.
 */
function toBankAccount(row: Record<string, unknown>): PersonBankAccount {
  return new PersonBankAccount({
    id: row.id as string,
    companyId: row.company_id as string,
    personId: row.person_id as string,
    label: row.label as string,
    pixKey: (row.pix_key as string | null) ?? undefined,
    bank: (row.bank as string | null) ?? undefined,
    branch: (row.branch as string | null) ?? undefined,
    accountNumber: (row.account_number as string | null) ?? undefined,
    isDefault: Boolean(row.is_default),
    createdAt: new Date(row.created_at as string),
  });
}

/**
 * Knex-based implementation of PersonRepository.
 *
 * Roles live in their own table, so every read hydrates them in a second query
 * and every write reconciles the set — the aggregate is the source of truth.
 */
export class KnexPersonRepository implements PersonRepository {
  constructor(private readonly knex: Knex) {}

  async create(person: Person): Promise<void> {
    await this.knex.transaction(async (trx) => {
      await trx("people").insert(this.toRow(person));
      await this.writeRoles(person, trx);
    });
  }

  async findById(companyId: string, id: string): Promise<Person | null> {
    const row = await this.knex("people")
      .where({ id, company_id: companyId })
      .first();

    return row ? this.hydrate(row as Record<string, unknown>) : null;
  }

  async findByDocument(
    companyId: string,
    document: string,
  ): Promise<Person | null> {
    const row = await this.knex("people")
      .where({ company_id: companyId, document })
      .first();

    return row ? this.hydrate(row as Record<string, unknown>) : null;
  }

  async findByCompany(
    companyId: string,
    filter: PersonFilter = {},
  ): Promise<Person[]> {
    const query = this.knex("people as p").where("p.company_id", companyId);

    if (filter.isActive !== undefined) {
      query.andWhere("p.is_active", filter.isActive);
    }

    if (filter.personType) {
      query.andWhere("p.person_type", filter.personType);
    }

    if (filter.role) {
      query.whereExists((builder) =>
        builder
          .select(this.knex.raw("1"))
          .from("person_roles as r")
          .whereRaw("r.person_id = p.id")
          .andWhere("r.role", filter.role!),
      );
    }

    if (filter.search) {
      const term = `%${filter.search.trim().toLowerCase()}%`;
      query.andWhere((builder) =>
        builder
          .whereRaw("lower(p.name) like ?", [term])
          .orWhereRaw("lower(p.document) like ?", [term]),
      );
    }

    const rows = await query.select("p.*").orderBy("p.name", "asc");

    return this.hydrateMany(rows as Record<string, unknown>[]);
  }

  async findByRole(companyId: string, role: PersonRole): Promise<Person[]> {
    return this.findByCompany(companyId, { role, isActive: true });
  }

  async update(person: Person): Promise<void> {
    await this.knex.transaction(async (trx) => {
      await trx("people")
        .where({ id: person.id, company_id: person.companyId })
        .update({
          name: person.name,
          email: person.email ?? null,
          phone: person.phone ?? null,
          address: person.address ? JSON.stringify(person.address) : null,
          is_active: person.isActive,
          updated_at: new Date(),
        });

      await trx("person_roles").where({ person_id: person.id }).delete();
      await this.writeRoles(person, trx);
    });
  }

  async createBankAccount(account: PersonBankAccount): Promise<void> {
    await this.knex("person_bank_accounts").insert({
      id: account.id,
      company_id: account.companyId,
      person_id: account.personId,
      label: account.label,
      pix_key: account.pixKey ?? null,
      pix_key_type: account.pixKeyType ?? null,
      bank: account.bank ?? null,
      branch: account.branch ?? null,
      account_number: account.accountNumber ?? null,
      is_default: account.isDefault,
      created_at: account.createdAt,
      updated_at: new Date(),
    });
  }

  async findBankAccounts(
    companyId: string,
    personId: string,
  ): Promise<PersonBankAccount[]> {
    const rows = await this.knex("person_bank_accounts")
      .where({ company_id: companyId, person_id: personId })
      .orderBy([
        { column: "is_default", order: "desc" },
        { column: "label", order: "asc" },
      ]);

    return rows.map((row) => toBankAccount(row as Record<string, unknown>));
  }

  async findBankAccountById(
    companyId: string,
    id: string,
  ): Promise<PersonBankAccount | null> {
    const row = await this.knex("person_bank_accounts")
      .where({ id, company_id: companyId })
      .first();

    return row ? toBankAccount(row as Record<string, unknown>) : null;
  }

  async updateBankAccounts(
    accounts: readonly PersonBankAccount[],
  ): Promise<void> {
    if (accounts.length === 0) {
      return;
    }

    await this.knex.transaction(async (trx) => {
      for (const account of accounts) {
        await trx("person_bank_accounts")
          .where({ id: account.id, company_id: account.companyId })
          .update({
            label: account.label,
            pix_key: account.pixKey ?? null,
            pix_key_type: account.pixKeyType ?? null,
            bank: account.bank ?? null,
            branch: account.branch ?? null,
            account_number: account.accountNumber ?? null,
            is_default: account.isDefault,
            updated_at: new Date(),
          });
      }
    });
  }

  async deleteBankAccount(companyId: string, id: string): Promise<boolean> {
    const deleted = await this.knex("person_bank_accounts")
      .where({ id, company_id: companyId })
      .delete();

    return deleted > 0;
  }

  private toRow(person: Person): Record<string, unknown> {
    return {
      id: person.id,
      company_id: person.companyId,
      name: person.name,
      person_type: person.personType,
      document: person.document,
      email: person.email ?? null,
      phone: person.phone ?? null,
      address: person.address ? JSON.stringify(person.address) : null,
      is_active: person.isActive,
      created_at: person.createdAt,
      updated_at: new Date(),
    };
  }

  private async writeRoles(person: Person, trx: Knex.Transaction): Promise<void> {
    const roles = person.roles;
    if (roles.length === 0) {
      return;
    }

    await trx("person_roles").insert(
      roles.map((role) => ({
        person_id: person.id,
        role,
        created_at: new Date(),
      })),
    );
  }

  private async hydrate(row: Record<string, unknown>): Promise<Person> {
    const roleRows = await this.knex("person_roles")
      .where({ person_id: row.id as string })
      .select("role");

    return toPerson(
      row,
      roleRows.map((roleRow) => (roleRow as { role: PersonRole }).role),
    );
  }

  /**
   * Hydrates a page of people with a single roles query, so listing does not
   * degrade into one round trip per person.
   */
  private async hydrateMany(
    rows: Record<string, unknown>[],
  ): Promise<Person[]> {
    if (rows.length === 0) {
      return [];
    }

    const ids = rows.map((row) => row.id as string);
    const roleRows = await this.knex("person_roles")
      .whereIn("person_id", ids)
      .select("person_id", "role");

    const rolesByPerson = new Map<string, PersonRole[]>();
    for (const roleRow of roleRows as { person_id: string; role: PersonRole }[]) {
      const current = rolesByPerson.get(roleRow.person_id);
      if (current) {
        current.push(roleRow.role);
      } else {
        rolesByPerson.set(roleRow.person_id, [roleRow.role]);
      }
    }

    return rows.map((row) =>
      toPerson(row, rolesByPerson.get(row.id as string) ?? []),
    );
  }
}
