import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Category } from "../domain/category.js";
import { CategoryHierarchy } from "../domain/category-hierarchy.js";
import type { CategoryRepository } from "../infrastructure/category-repository.js";
import type { TransactionRepository } from "../infrastructure/transaction-repository.js";
import {
  validateCreateCategoryRequest,
  validateMoveCategoryRequest,
  validateUpdateCategoryRequest,
} from "./dtos.js";

/**
 * Category endpoints. The company scope always comes from the token.
 */
export class CategoryController {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly transactionRepository: TransactionRepository,
  ) {}

  /**
   * POST /api/v1/categories
   */
  async create(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateCreateCategoryRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    if (validation.data.parentId) {
      const parent = await this.categoryRepository.findById(
        companyId,
        validation.data.parentId,
      );
      if (!parent) {
        return { statusCode: 404, body: { error: "Parent category not found" } };
      }
      if (parent.type !== validation.data.type) {
        return {
          statusCode: 400,
          body: { error: "Subcategory type must match the parent type" },
        };
      }
    }

    const result = Category.create({ companyId, ...validation.data });
    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    await this.categoryRepository.create(result.value);

    return { statusCode: 201, body: result.value.toJSON() };
  }

  /**
   * GET /api/v1/categories — returns the hierarchy as a tree.
   */
  async list(companyId: string): Promise<ControllerResult> {
    const categories = await this.categoryRepository.findByCompanyId(companyId);
    const hierarchy = new CategoryHierarchy(categories);

    return {
      statusCode: 200,
      body: {
        categories: categories.map((category) => category.toJSON()),
        tree: hierarchy.tree(),
      },
    };
  }

  /**
   * PUT /api/v1/categories/:categoryId
   */
  async update(
    companyId: string,
    categoryId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateUpdateCategoryRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const category = await this.categoryRepository.findById(
      companyId,
      categoryId,
    );
    if (!category) {
      return { statusCode: 404, body: { error: "Category not found" } };
    }

    const result = category.edit(validation.data);
    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    await this.categoryRepository.update(result.value);

    return { statusCode: 200, body: result.value.toJSON() };
  }

  /**
   * DELETE /api/v1/categories/:categoryId — soft delete, blocked by dependencies.
   */
  async delete(
    companyId: string,
    categoryId: string,
  ): Promise<ControllerResult> {
    const category = await this.categoryRepository.findById(
      companyId,
      categoryId,
    );
    if (!category) {
      return { statusCode: 404, body: { error: "Category not found" } };
    }

    const [transactionCount, subcategoryCount] = await Promise.all([
      this.transactionRepository.countByCategoryId(companyId, categoryId),
      this.categoryRepository.countSubcategories(companyId, categoryId),
    ]);

    const result = category.delete({ transactionCount, subcategoryCount });
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.categoryRepository.delete(companyId, categoryId);

    return { statusCode: 204, body: null };
  }

  /**
   * POST /api/v1/categories/:categoryId/move
   */
  async move(
    companyId: string,
    categoryId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateMoveCategoryRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const category = await this.categoryRepository.findById(
      companyId,
      categoryId,
    );
    if (!category) {
      return { statusCode: 404, body: { error: "Category not found" } };
    }

    const newParentId = validation.data.parentId;
    let ancestorIds: string[] = [];

    if (newParentId) {
      const parent = await this.categoryRepository.findById(
        companyId,
        newParentId,
      );
      if (!parent) {
        return { statusCode: 404, body: { error: "Parent category not found" } };
      }
      // The domain rejects cycles from the ancestor chain of the target parent.
      ancestorIds = await this.categoryRepository.findAncestorIds(
        companyId,
        newParentId,
      );
    }

    const result = category.moveTo(newParentId, ancestorIds);
    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    await this.categoryRepository.update(result.value);

    return { statusCode: 200, body: result.value.toJSON() };
  }

  private orGeneric(error: DomainError | undefined): DomainError {
    return (
      error ??
      DomainError.create("BUSINESS_RULE_VIOLATION", "Operation not allowed")
    );
  }
}
