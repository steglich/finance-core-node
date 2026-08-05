import type { Category } from "../domain/category.js";

/**
 * Repository interface for the Category entity.
 * Every method is scoped by companyId (multi-tenancy invariant).
 */
export interface CategoryRepository {
  /**
   * Creates a new category.
   */
  create(category: Category): Promise<void>;

  /**
   * Finds a category by ID within a company.
   */
  findById(companyId: string, id: string): Promise<Category | null>;

  /**
   * Finds all categories for a company.
   */
  findByCompanyId(companyId: string): Promise<Category[]>;

  /**
   * Finds subcategories by parent ID.
   */
  findByParentId(companyId: string, parentId: string): Promise<Category[]>;

  /**
   * Ancestor chain of a category, from the direct parent up to the root.
   * Used by `Category.moveTo()` to reject circular hierarchies.
   */
  findAncestorIds(companyId: string, id: string): Promise<string[]>;

  /**
   * Every descendant id of a category, at any depth.
   */
  findDescendantIds(companyId: string, id: string): Promise<string[]>;

  /**
   * Number of direct subcategories; blocks deletion.
   */
  countSubcategories(companyId: string, id: string): Promise<number>;

  /**
   * Updates a category.
   */
  update(category: Category): Promise<void>;

  /**
   * Soft-deletes a category (RN-01: nothing is physically removed).
   * Returns false when the category still has dependencies.
   */
  delete(companyId: string, id: string): Promise<boolean>;

  /**
   * Creates default categories for a new company.
   */
  createDefaultCategories(
    companyId: string,
    categories: { name: string; type: Category["type"] }[],
  ): Promise<void>;
}
