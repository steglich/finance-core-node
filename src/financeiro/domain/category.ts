import { randomUUID } from "node:crypto";
import { Entity } from "../../shared/domain/entity.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";

/**
 * Category type enumeration.
 */
export type CategoryType = "EXPENSE" | "INCOME";

/**
 * Default category names for new companies (RN-08).
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  "Alimentação",
  "Transporte",
  "Moradia",
  "Saúde",
  "Educação",
  "Lazer",
  "Vestuário",
  "Assinaturas",
];

export const DEFAULT_INCOME_CATEGORIES = [
  "Salário",
  "Bônus",
  "Investimentos",
  "Outros",
];

const CATEGORY_TYPES: ReadonlySet<string> = new Set<CategoryType>([
  "EXPENSE",
  "INCOME",
]);

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ICON_PATTERN = /^[a-z0-9][a-z0-9-_]{0,49}$/;

/**
 * Constructor properties for rehydrating a category from persistence.
 */
export interface CategoryProps {
  id: string;
  companyId: string;
  name: string;
  type: CategoryType;
  parentId?: string | undefined;
  color?: string | undefined;
  icon?: string | undefined;
  isDefault?: boolean;
  isDeleted?: boolean;
  createdAt?: Date;
}

/**
 * Input for creating a new category.
 */
export interface CreateCategoryInput {
  id?: string;
  companyId: string;
  name: string;
  type: CategoryType;
  parentId?: string | undefined;
  color?: string | undefined;
  icon?: string | undefined;
  isDefault?: boolean;
}

/**
 * Editable category fields (see spec: Edit Category).
 */
export interface EditCategoryInput {
  name?: string | undefined;
  type?: CategoryType | undefined;
  color?: string | undefined;
  icon?: string | undefined;
}

/**
 * Counts of records that block deletion, supplied by the caller since the
 * domain does not query repositories.
 */
export interface CategoryDependencies {
  transactionCount: number;
  subcategoryCount: number;
}

/**
 * RN-06: a category is pure classification. Anything that can be categorized
 * exposes only its identity and the category it is classified under — the
 * financial fields are never touched by this bounded concept.
 */
export interface CategorizableTransaction {
  readonly id: string;
  readonly categoryId?: string | undefined;
}

/**
 * RN-06 guard: verifies that reclassification changed nothing but `categoryId`.
 * Any other divergence between the two snapshots is a business rule violation.
 */
export function ensureOnlyClassificationChanged<
  T extends CategorizableTransaction,
>(before: T, after: T): Result<T> {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    if (key === "categoryId") {
      continue;
    }
    const previousValue = (before as Record<string, unknown>)[key];
    const nextValue = (after as Record<string, unknown>)[key];
    if (!Object.is(previousValue, nextValue)) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Reclassification must not change "${key}" (RN-06)`,
        ),
      );
    }
  }

  return Result.success(after);
}

/**
 * Category entity.
 * Hierarchical classification for financial transactions. Categories carry no
 * monetary state: they never influence value, balance impact or status (RN-06).
 */
export class Category extends Entity<string> {
  private readonly _companyId: string;
  private readonly _name: string;
  private readonly _type: CategoryType;
  private readonly _parentId: string | undefined;
  private readonly _color: string | undefined;
  private readonly _icon: string | undefined;
  private readonly _isDefault: boolean;
  private readonly _isDeleted: boolean;

  constructor(props: CategoryProps) {
    super(props.id, props.createdAt);

    const name = props.name.trim();

    if (props.companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Category requires a company",
      );
    }

    if (name.length === 0) {
      throw DomainError.create("VALIDATION_ERROR", "Category name is required");
    }

    if (!CATEGORY_TYPES.has(props.type)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid category type: ${props.type}`,
      );
    }

    if (props.parentId !== undefined && props.parentId === props.id) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "A category cannot be its own parent",
      );
    }

    this._companyId = props.companyId;
    this._name = name;
    this._type = props.type;
    this._parentId = props.parentId ?? undefined;
    this._color = Category.normalizeColor(props.color);
    this._icon = Category.normalizeIcon(props.icon);
    this._isDefault = props.isDefault ?? false;
    this._isDeleted = props.isDeleted ?? false;
  }

  private static normalizeColor(color: string | undefined): string | undefined {
    if (color === undefined) {
      return undefined;
    }

    const normalized = color.trim().toUpperCase();
    if (normalized.length === 0) {
      return undefined;
    }

    if (!HEX_COLOR_PATTERN.test(normalized)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid category color: ${color}. Expected a hex color such as #FF5733`,
      );
    }

    return normalized;
  }

  private static normalizeIcon(icon: string | undefined): string | undefined {
    if (icon === undefined) {
      return undefined;
    }

    const normalized = icon.trim().toLowerCase();
    if (normalized.length === 0) {
      return undefined;
    }

    if (!ICON_PATTERN.test(normalized)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Invalid category icon: ${icon}. Expected a slug such as "car"`,
      );
    }

    return normalized;
  }

  get companyId(): string {
    return this._companyId;
  }

  get name(): string {
    return this._name;
  }

  get type(): CategoryType {
    return this._type;
  }

  get parentId(): string | undefined {
    return this._parentId;
  }

  get color(): string | undefined {
    return this._color;
  }

  get icon(): string | undefined {
    return this._icon;
  }

  /**
   * Whether the category came from the default seed of a new company.
   */
  get isDefault(): boolean {
    return this._isDefault;
  }

  get isDeleted(): boolean {
    return this._isDeleted;
  }

  isRoot(): boolean {
    return this._parentId === undefined;
  }

  /**
   * Applies this category to a transaction snapshot, changing nothing but the
   * classification (RN-06).
   */
  applyTo<T extends CategorizableTransaction>(transaction: T): Result<T> {
    const reclassified = { ...transaction, categoryId: this.id };
    return ensureOnlyClassificationChanged(transaction, reclassified);
  }

  /**
   * Edits the mutable descriptive fields. Hierarchy changes go through moveTo().
   */
  edit(changes: EditCategoryInput): Result<Category> {
    if (this._isDeleted) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "A deleted category cannot be edited",
        ),
      );
    }

    return this.rebuild({
      name: changes.name ?? this._name,
      type: changes.type ?? this._type,
      color: "color" in changes ? changes.color : this._color,
      icon: "icon" in changes ? changes.icon : this._icon,
    });
  }

  /**
   * Moves the category under a new parent (or to the root when undefined).
   *
   * `newParentAncestorIds` is the ancestor chain of the target parent, supplied
   * by the caller (see CategoryHierarchy.move) so the aggregate can reject a
   * move onto one of its own descendants without querying the repository.
   */
  moveTo(
    newParentId: string | undefined,
    newParentAncestorIds: readonly string[] = [],
  ): Result<Category> {
    if (this._isDeleted) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "A deleted category cannot be moved",
        ),
      );
    }

    if (newParentId === this.id) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          "A category cannot be its own parent",
        ),
      );
    }

    if (newParentId !== undefined && newParentAncestorIds.includes(this.id)) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Cannot move category ${this.id} under its own descendant ${newParentId}`,
        ),
      );
    }

    // RN-06: only the hierarchy changes; no financial state is touched.
    return this.rebuild({ parentId: newParentId });
  }

  /**
   * Marks the category as deleted. Blocked when transactions or subcategories
   * are still linked to it.
   */
  delete(dependencies: CategoryDependencies): Result<Category> {
    if (this._isDeleted) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "Category is already deleted",
        ),
      );
    }

    if (dependencies.transactionCount > 0) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Category has ${dependencies.transactionCount} linked transaction(s) and cannot be deleted`,
        ),
      );
    }

    if (dependencies.subcategoryCount > 0) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Category has ${dependencies.subcategoryCount} subcategory(ies) and cannot be deleted`,
        ),
      );
    }

    return this.rebuild({ isDeleted: true });
  }

  private rebuild(changes: Partial<Omit<CategoryProps, "id">>): Result<Category> {
    try {
      return Result.success(
        new Category({
          id: this.id,
          companyId: this._companyId,
          name: changes.name ?? this._name,
          type: changes.type ?? this._type,
          parentId: "parentId" in changes ? changes.parentId : this._parentId,
          color: "color" in changes ? changes.color : this._color,
          icon: "icon" in changes ? changes.icon : this._icon,
          isDefault: changes.isDefault ?? this._isDefault,
          isDeleted: changes.isDeleted ?? this._isDeleted,
          createdAt: this.createdAt,
        }),
      );
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this.companyId,
      name: this.name,
      type: this.type,
      parentId: this.parentId,
      color: this.color,
      icon: this.icon,
      isDefault: this.isDefault,
      isRoot: this.isRoot(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Creates a category, returning a failed Result instead of throwing on invalid input.
   */
  static create(input: CreateCategoryInput): Result<Category> {
    try {
      return Result.success(
        new Category({
          id: input.id ?? randomUUID(),
          companyId: input.companyId,
          name: input.name,
          type: input.type,
          parentId: input.parentId,
          color: input.color,
          icon: input.icon,
          isDefault: input.isDefault ?? false,
        }),
      );
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }
  }
}
