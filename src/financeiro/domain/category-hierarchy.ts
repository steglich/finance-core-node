import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
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
 * Provides the hierarchy queries the entity cannot answer on its own
 * (ancestors, descendants, tree) and guards non-circularity on moves.
 */
export class CategoryHierarchy {
  private readonly byId: Map<string, Category>;
  private readonly childrenByParentId: Map<string | undefined, Category[]>;

  constructor(categories: readonly Category[]) {
    this.byId = new Map();
    this.childrenByParentId = new Map();

    for (const category of categories) {
      this.byId.set(category.id, category);
      const siblings = this.childrenByParentId.get(category.parentId);
      if (siblings) {
        siblings.push(category);
      } else {
        this.childrenByParentId.set(category.parentId, [category]);
      }
    }
  }

  get size(): number {
    return this.byId.size;
  }

  find(categoryId: string): Category | undefined {
    return this.byId.get(categoryId);
  }

  /**
   * Root categories, in insertion order.
   */
  roots(): Category[] {
    return [...(this.childrenByParentId.get(undefined) ?? [])];
  }

  childrenOf(categoryId: string): Category[] {
    return [...(this.childrenByParentId.get(categoryId) ?? [])];
  }

  /**
   * Ancestors from the nearest parent up to the root.
   * Stops safely if the stored data contains a cycle.
   */
  ancestorsOf(categoryId: string): Category[] {
    const ancestors: Category[] = [];
    const visited = new Set<string>([categoryId]);

    let current = this.byId.get(categoryId)?.parentId;
    while (current !== undefined && !visited.has(current)) {
      const parent = this.byId.get(current);
      if (!parent) {
        break;
      }
      ancestors.push(parent);
      visited.add(parent.id);
      current = parent.parentId;
    }

    return ancestors;
  }

  /**
   * All descendants, in breadth-first order.
   */
  descendantsOf(categoryId: string): Category[] {
    const descendants: Category[] = [];
    const queue = this.childrenOf(categoryId);
    const visited = new Set<string>([categoryId]);

    while (queue.length > 0) {
      const category = queue.shift();
      if (!category || visited.has(category.id)) {
        continue;
      }
      visited.add(category.id);
      descendants.push(category);
      queue.push(...this.childrenOf(category.id));
    }

    return descendants;
  }

  /**
   * Depth of a category in the tree (0 for root categories).
   */
  depthOf(categoryId: string): number {
    return this.ancestorsOf(categoryId).length;
  }

  /**
   * Whether `candidateId` is a descendant of `categoryId`.
   */
  isDescendantOf(candidateId: string, categoryId: string): boolean {
    return this.ancestorsOf(candidateId).some(
      (ancestor) => ancestor.id === categoryId,
    );
  }

  /**
   * Builds the nested category tree.
   */
  tree(): CategoryNode[] {
    const buildNodes = (categories: readonly Category[]): CategoryNode[] =>
      categories.map((category) => ({
        category,
        children: buildNodes(this.childrenOf(category.id)),
      }));

    return buildNodes(this.roots());
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
