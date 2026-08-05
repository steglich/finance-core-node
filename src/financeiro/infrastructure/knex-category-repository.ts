import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import { Category, type CategoryType } from "../domain/category.js";
import type { CategoryRepository } from "./category-repository.js";

/**
 * Maps a `categories` row into the Category entity.
 */
function toCategory(row: Record<string, unknown>): Category {
  return new Category({
    id: row.id as string,
    companyId: row.company_id as string,
    name: row.name as string,
    type: (row.type as CategoryType) || "EXPENSE",
    parentId: (row.parent_id as string | null) ?? undefined,
    color: (row.color as string | null) ?? undefined,
    icon: (row.icon as string | null) ?? undefined,
    isDefault: Boolean(row.is_default),
    isDeleted: Boolean(row.is_deleted),
    createdAt: new Date(row.created_at as string),
  });
}

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
      color: category.color ?? null,
      icon: category.icon ?? null,
      parent_id: category.parentId ?? null,
      is_default: category.isDefault,
      is_deleted: category.isDeleted,
      created_at: category.createdAt,
      updated_at: new Date(),
    });
  }

  async findById(companyId: string, id: string): Promise<Category | null> {
    const row = await this.knex("categories")
      .where({ id, company_id: companyId, is_deleted: false })
      .first();

    return row ? toCategory(row as Record<string, unknown>) : null;
  }

  async findByCompanyId(companyId: string): Promise<Category[]> {
    const rows = await this.knex("categories")
      .where({ company_id: companyId, is_deleted: false })
      .orderBy("name", "asc");

    return rows.map((row) => toCategory(row as Record<string, unknown>));
  }

  async findByParentId(
    companyId: string,
    parentId: string,
  ): Promise<Category[]> {
    const rows = await this.knex("categories")
      .where({ company_id: companyId, parent_id: parentId, is_deleted: false })
      .orderBy("name", "asc");

    return rows.map((row) => toCategory(row as Record<string, unknown>));
  }

  /**
   * Walks up the tree with a recursive CTE, so an arbitrarily deep hierarchy
   * costs a single round trip.
   */
  async findAncestorIds(companyId: string, id: string): Promise<string[]> {
    const result = await this.knex.raw(
      `WITH RECURSIVE ancestors AS (
         SELECT id, parent_id, 0 AS depth
           FROM categories
          WHERE id = ? AND company_id = ?
         UNION ALL
         SELECT c.id, c.parent_id, a.depth + 1
           FROM categories c
           JOIN ancestors a ON c.id = a.parent_id
          WHERE c.company_id = ?
       )
       SELECT id FROM ancestors WHERE depth > 0 ORDER BY depth ASC`,
      [id, companyId, companyId],
    );

    return this.extractIds(result);
  }

  /**
   * Walks down the tree with a recursive CTE.
   */
  async findDescendantIds(companyId: string, id: string): Promise<string[]> {
    const result = await this.knex.raw(
      `WITH RECURSIVE descendants AS (
         SELECT id, 0 AS depth
           FROM categories
          WHERE id = ? AND company_id = ?
         UNION ALL
         SELECT c.id, d.depth + 1
           FROM categories c
           JOIN descendants d ON c.parent_id = d.id
          WHERE c.company_id = ?
       )
       SELECT id FROM descendants WHERE depth > 0`,
      [id, companyId, companyId],
    );

    return this.extractIds(result);
  }

  async countSubcategories(companyId: string, id: string): Promise<number> {
    const result = (await this.knex("categories")
      .where({ company_id: companyId, parent_id: id, is_deleted: false })
      .count<{ count: string }[]>("id as count")) as { count: string }[];

    return Number(result[0]?.count ?? 0);
  }

  async update(category: Category): Promise<void> {
    await this.knex("categories")
      .where({ id: category.id, company_id: category.companyId })
      .update({
        name: category.name,
        type: category.type,
        color: category.color ?? null,
        icon: category.icon ?? null,
        parent_id: category.parentId ?? null,
        is_deleted: category.isDeleted,
        updated_at: new Date(),
      });
  }

  /**
   * Soft delete: the row is kept so historical transactions keep their
   * classification (RN-01). Blocked while transactions or subcategories exist.
   */
  async delete(companyId: string, id: string): Promise<boolean> {
    const hasTransactions = await this.knex("transactions")
      .where({ company_id: companyId, category_id: id })
      .first();

    if (hasTransactions) {
      return false;
    }

    const subcategories = await this.countSubcategories(companyId, id);
    if (subcategories > 0) {
      return false;
    }

    const updated = await this.knex("categories")
      .where({ id, company_id: companyId, is_deleted: false })
      .update({ is_deleted: true, updated_at: new Date() });

    return updated > 0;
  }

  async createDefaultCategories(
    companyId: string,
    categories: { name: string; type: CategoryType }[],
  ): Promise<void> {
    if (categories.length === 0) {
      return;
    }

    const now = new Date();

    await this.knex("categories").insert(
      categories.map((category) => ({
        id: randomUUID(),
        company_id: companyId,
        name: category.name,
        type: category.type,
        parent_id: null,
        is_default: true,
        is_deleted: false,
        created_at: now,
        updated_at: now,
      })),
    );
  }

  /**
   * Normalizes the shape returned by knex.raw across drivers.
   */
  private extractIds(result: unknown): string[] {
    const rows = (
      Array.isArray(result)
        ? result[0]
        : ((result as { rows?: unknown[] }).rows ?? [])
    ) as { id: string }[];

    return rows.map((row) => row.id);
  }
}
