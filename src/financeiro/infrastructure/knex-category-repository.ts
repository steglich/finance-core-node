import type { Knex } from "knex";
import type { CategoryRepository } from "./category-repository.js";
import { Category, type CategoryType } from "../domain/category.js";

/**
 * Knex-based implementation of CategoryRepository.
 */
export class KnexCategoryRepository implements CategoryRepository {
  constructor(private readonly knex: Knex) {}

  async create(category: Category): Promise<void> {
    await this.knex("categories").insert({
      id: category.id,
      company_id: category.companyId,
      name: category.name,
      type: category.type,
      parent_id: category.parentId || null,
      created_at: category.createdAt,
      updated_at: new Date(),
    });
  }

  async findById(id: string): Promise<Category | null> {
    const row = await this.knex("categories").where("id", id).first();

    if (!row) return null;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return new Category(
      row.id as string,
      row.company_id as string,
      row.name as string,
      (row.type as CategoryType) || "EXPENSE",
      row.parent_id as string | undefined,
      new Date(row.created_at as string),
    );
  }

  async findByCompanyId(companyId: string): Promise<Category[]> {
    const rows = await this.knex("categories")
      .where("company_id", companyId)
      .orderBy("created_at", "desc");

    return rows.map((row) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return new Category(
        row.id as string,
        row.company_id as string,
        row.name as string,
        (row.type as CategoryType) || "EXPENSE",
        row.parent_id as string | undefined,
        new Date(row.created_at as string),
      );
    });
  }

  async findByParentId(
    companyId: string,
    parentId: string,
  ): Promise<Category[]> {
    const rows = await this.knex("categories")
      .where({ company_id: companyId, parent_id: parentId })
      .orderBy("created_at", "desc");

    return rows.map((row) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return new Category(
        row.id as string,
        row.company_id as string,
        row.name as string,
        (row.type as CategoryType) || "EXPENSE",
        row.parent_id as string | undefined,
        new Date(row.created_at as string),
      );
    });
  }

  async update(category: Category): Promise<void> {
    await this.knex("categories")
      .where("id", category.id)
      .update({
        name: category.name,
        parent_id: category.parentId || null,
        updated_at: new Date(),
      });
  }

  async delete(id: string): Promise<boolean> {
    // Check if there are transactions or subcategories using this category (RN-07)
    const hasTransactions = await this.knex("transactions")
      .where("category_id", id)
      .first();

    const hasSubcategories = await this.knex("categories")
      .where("parent_id", id)
      .first();

    if (hasTransactions || hasSubcategories) {
      return false; // Cannot delete - RN-07: categories don't change financial behavior but have dependencies
    }

    const result = await this.knex("categories").where("id", id).del();
    return result > 0;
  }

  async createDefaultCategories(
    companyId: string,
    categories: { name: string; type: CategoryType }[],
  ): Promise<void> {
    const now = new Date();
    for (const cat of categories) {
      await this.knex("categories").insert({
        id: crypto.randomUUID(),
        company_id: companyId,
        name: cat.name,
        type: cat.type,
        parent_id: null,
        is_default: true,
        created_at: now,
        updated_at: now,
      });
    }
  }
}
