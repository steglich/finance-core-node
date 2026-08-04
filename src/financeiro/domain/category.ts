import { Entity } from "../../shared/domain/entity.js";

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

/**
 * Category entity.
 * Represents a classification for financial transactions with hierarchical support.
 */
export class Category extends Entity<string> {
  private readonly _companyId: string;
  private readonly _name: string;
  private readonly _type: CategoryType;
  private readonly _parentId: string | undefined;

  constructor(
    id: string,
    companyId: string,
    name: string,
    type: CategoryType,
    parentId?: string,
    createdAt?: Date,
  ) {
    super(id, createdAt);
    this._companyId = companyId;
    this._name = name.trim();
    this._type = type;
    this._parentId = parentId;
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

  isRoot(): boolean {
    return !this._parentId;
  }

  moveTo(newParentId: string | undefined): Category {
    // RN-06: Categories don't change financial behavior, so we just update the hierarchy
    return new Category(
      this.id,
      this._companyId,
      this._name,
      this._type,
      newParentId,
      this.createdAt,
    );
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this.companyId,
      name: this.name,
      type: this.type,
      parentId: this.parentId,
      isRoot: this.isRoot(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
