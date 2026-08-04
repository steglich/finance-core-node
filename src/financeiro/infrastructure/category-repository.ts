import type { Category } from "../domain/category.js";

/**
 * Repository interface for Category entity.
 */
export interface CategoryRepository {
  /**
   * Creates a new category.
   */
  create(category: Category): Promise<void>;

  /**
   * Finds a category by ID.
   */
  findById(id: string): Promise<Category | null>;

  /**
   * Finds all categories for a company.
   */
  findByCompanyId(companyId: string): Promise<Category[]>;

  /**
   * Finds subcategories by parent ID.
   */
  findByParentId(companyId: string, parentId: string): Promise<Category[]>;

  /**
   * Updates a category.
   */
  update(category: Category): Promise<void>;

  /**
   * Deletes a category (soft delete or block if has dependencies).
   */
  delete(id: string): Promise<boolean>;

  /**
   * Creates default categories for a new company.
   */
  createDefaultCategories(
    companyId: string,
    categories: { name: string; type: Category["type"] }[],
  ): Promise<void>;
}
