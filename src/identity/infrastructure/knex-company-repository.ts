import type { Knex } from "knex";
import type { CompanyRepository } from "./company-repository.js";
import { Company, type CreateCompanyInput } from "../domain/company.js";

/**
 * Knex-based implementation of CompanyRepository.
 */
export class KnexCompanyRepository implements CompanyRepository {
  constructor(private readonly knex: Knex) {}

  async create(company: Company): Promise<void> {
    await this.knex("companies").insert({
      id: company.id,
      name: company.name,
      type: company.type,
      default_currency: company.defaultCurrency,
      created_at: company.createdAt,
      updated_at: new Date(),
    });
  }

  async findById(id: string): Promise<Company | null> {
    const row = await this.knex("companies").where("id", id).first();

    if (!row) return null;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return this.mapRowToCompany(row);
  }

  async findUserCompanies(userId: string): Promise<string[]> {
    const rows = await this.knex("company_users")
      .where("user_id", userId)
      .select("company_id");

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return rows.map((row) => row.company_id as string);
  }

  async findUserProfileId(
    companyId: string,
    userId: string,
  ): Promise<string | null> {
    const row = await this.knex("company_users")
      .where({ company_id: companyId, user_id: userId })
      .first();

    return ((row as Record<string, unknown> | undefined)?.profile_id as
      | string
      | null) ?? null;
  }

  async addUser(
    companyId: string,
    userId: string,
    profileId?: string,
  ): Promise<void> {
    await this.knex("company_users").insert({
      id: crypto.randomUUID(),
      user_id: userId,
      company_id: companyId,
      profile_id: profileId || null,
      joined_at: new Date(),
    });
  }

  async removeUser(companyId: string, userId: string): Promise<boolean> {
    const result = await this.knex("company_users")
      .where({ company_id: companyId, user_id: userId })
      .del();

    return result > 0;
  }

  private mapRowToCompany(row: Record<string, unknown>): Company {
    // Get associated users for the company
    const userIds = [] as string[];

    return new Company(
      row.id as string,
      row.name as string,
      (row.type as "INDIVIDUAL" | "CORPORATE") || "INDIVIDUAL",
      (row.default_currency as string) || "BRL",
      userIds,
      new Date(row.created_at as string),
    );
  }
}
