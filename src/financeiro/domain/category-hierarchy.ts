import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import { TreeHierarchy } from "../../shared/domain/tree-hierarchy.js";
import type { Category } from "./category.js";

/**
 * A category with its subcategories nested underneath.
 */
export interface CategoryNode {
  category: Category;
  children: CategoryNode[];
}

/**
 * Domain service over a flat set of categories of a single company.
 * Inherits the generic traversal (ancestors, descendants, tree, cycle guard)
 * from `TreeHierarchy` and adds the category-specific rules.
 */
export class CategoryHierarchy extends TreeHierarchy<Category, CategoryNode> {
  constructor(categories: readonly Category[]) {
    super(categories);
  }

  protected override wrapNode(
    category: Category,
    children: CategoryNode[],
  ): CategoryNode {
    return { category, children };
  }

  /**
   * Moves a category under a new parent, rejecting circular references and
   * cross-company moves.
   */
  move(categoryId: string, newParentId: string | undefined): Result<Category> {
    const category = this.byId.get(categoryId);
    if (!category) {
      return Result.failed(
        DomainError.create(
          "ENTITY_NOT_FOUND",
          `Category ${categoryId} was not found`,
        ),
      );
    }

    if (newParentId === undefined) {
      return category.moveTo(undefined);
    }

    const newParent = this.byId.get(newParentId);
    if (!newParent) {
      return Result.failed(
        DomainError.create(
          "ENTITY_NOT_FOUND",
          `Parent category ${newParentId} was not found`,
        ),
      );
    }

    if (newParent.companyId !== category.companyId) {
      return Result.failed(
        DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "Categories can only be moved within the same company",
        ),
      );
    }

    const ancestorIds = this.ancestorsOf(newParentId).map(
      (ancestor) => ancestor.id,
    );

    return category.moveTo(newParentId, ancestorIds);
  }

  /**
   * Deletes a category, counting its subcategories from the hierarchy.
   * The transaction count must come from the caller.
   */
  delete(categoryId: string, transactionCount: number): Result<Category> {
    const category = this.byId.get(categoryId);
    if (!category) {
      return Result.failed(
        DomainError.create(
          "ENTITY_NOT_FOUND",
          `Category ${categoryId} was not found`,
        ),
      );
    }

    return category.delete({
      transactionCount,
      subcategoryCount: this.childrenOf(categoryId).length,
    });
  }
}
