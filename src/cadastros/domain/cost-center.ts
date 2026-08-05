import { randomUUID } from "node:crypto";
import { AggregateRoot } from "../../shared/domain/aggregate-root.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import {
  CostCenterCreated,
  CostCenterDeactivated,
  CostCenterEdited,
} from "./cost-center-events.js";

/**
 * Constructor properties for rehydrating a cost center from persistence.
 */
export interface CostCenterProps {
  id: string;
  companyId: string;
  name: string;
  parentId?: string | undefined;
  description?: string | undefined;
  isActive?: boolean;
  createdAt?: Date;
}

/**
 * Input for creating a new cost center.
 */
export interface CreateCostCenterInput {
  id?: string;
  companyId: string;
  name: string;
  description?: string | undefined;
  parent?: CostCenter | undefined;
}

/**
 * Mutable fields of a cost center. The parent is changed through the hierarchy,
 * which is the only place that can tell a cycle or an over-deep move apart.
 */
export interface EditCostCenterInput {
  name?: string | undefined;
  description?: string | null | undefined;
}

/**
 * Organisational unit — department or project — used to classify transactions
 * and budgets alongside, and independently of, the accounting category.
 *
 * Structural rules that need to see the whole tree (sibling name uniqueness,
 * depth limit, cycles, cascade) live in `CostCenterHierarchy`.
 */
export class CostCenter extends AggregateRoot<string> {
  private readonly _companyId: string;
  private _name: string;
  private _parentId: string | undefined;
  private _description: string | undefined;
  private _isActive: boolean;

  constructor(props: CostCenterProps) {
    super(props.id, props.createdAt);

    const name = props.name.trim();

    if (props.companyId.trim().length === 0) {
      throw DomainError.create(
        "COMPANY_CONTEXT_REQUIRED",
        "Cost center requires a company",
      );
    }

    if (name.length === 0) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "Cost center name is required",
      );
    }

    if (props.parentId === props.id) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "A cost center cannot be its own parent",
      );
    }

    this._companyId = props.companyId;
    this._name = name;
    this._parentId = props.parentId;
    this._description = props.description?.trim() || undefined;
    this._isActive = props.isActive ?? true;
  }

  get companyId(): string {
    return this._companyId;
  }

  get name(): string {
    return this._name;
  }

  get parentId(): string | undefined {
    return this._parentId;
  }

  get description(): string | undefined {
    return this._description;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  get isRoot(): boolean {
    return this._parentId === undefined;
  }

  edit(input: EditCostCenterInput): Result<CostCenter> {
    if (!this._isActive) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "An inactive cost center cannot be edited",
        ),
      );
    }

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length === 0) {
        return Result.failed(
          DomainError.create(
            "VALIDATION_ERROR",
            "Cost center name is required",
          ),
        );
      }
      this._name = name;
    }

    if (input.description !== undefined) {
      this._description =
        input.description === null
          ? undefined
          : input.description.trim() || undefined;
    }

    this.setUpdatedAt();
    this.raiseEvent(
      new CostCenterEdited(
        this.id,
        this._companyId,
        this._name,
        this._parentId,
      ),
    );
    return Result.success(this);
  }

  /**
   * Reparents the cost center. `ancestorIds` are the ancestors of the new
   * parent, supplied by the hierarchy so the cycle guard can run here.
   */
  moveTo(
    newParentId: string | undefined,
    ancestorIds: readonly string[] = [],
  ): Result<CostCenter> {
    if (!this._isActive) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "An inactive cost center cannot be moved",
        ),
      );
    }

    if (newParentId === this.id) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "A cost center cannot be its own parent",
        ),
      );
    }

    if (newParentId !== undefined && ancestorIds.includes(this.id)) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "A cost center cannot be moved under one of its own descendants",
        ),
      );
    }

    this._parentId = newParentId;
    this.setUpdatedAt();
    this.raiseEvent(
      new CostCenterEdited(
        this.id,
        this._companyId,
        this._name,
        this._parentId,
      ),
    );
    return Result.success(this);
  }

  /**
   * Deactivates the cost center. Cost centers are never physically deleted, and
   * transactions already classified with it keep the classification.
   *
   * The cascade over the descendants and the active-budget guard are applied by
   * `CostCenterHierarchy.deactivate()`.
   */
  deactivate(activeBudgetCount = 0): Result<CostCenter> {
    if (!this._isActive) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "Cost center is already inactive",
        ),
      );
    }

    if (activeBudgetCount > 0) {
      return Result.failed(
        DomainError.create(
          "BUSINESS_RULE_VIOLATION",
          `Cost center is referenced by ${activeBudgetCount} active budget(s) and cannot be deactivated`,
        ),
      );
    }

    this._isActive = false;
    this.setUpdatedAt();
    this.raiseEvent(
      new CostCenterDeactivated(this.id, this._companyId, this._name),
    );
    return Result.success(this);
  }

  toJSON(): unknown {
    return {
      id: this.id,
      companyId: this._companyId,
      name: this._name,
      parentId: this._parentId,
      description: this._description,
      isActive: this._isActive,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Creates a cost center under an optional parent of the same company.
   * Sibling name uniqueness and the depth limit are enforced by the hierarchy.
   */
  static create(input: CreateCostCenterInput): Result<CostCenter> {
    try {
      const parent = input.parent;

      if (parent) {
        if (parent.companyId !== input.companyId) {
          throw DomainError.create(
            "UNAUTHORIZED_ACCESS",
            "A cost center can only be created under a parent of the same company",
          );
        }

        if (!parent.isActive) {
          throw DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            "A cost center cannot be created under an inactive parent",
          );
        }
      }

      const costCenter = new CostCenter({
        id: input.id ?? randomUUID(),
        companyId: input.companyId,
        name: input.name,
        description: input.description,
        parentId: parent?.id,
      });

      costCenter.raiseEvent(
        new CostCenterCreated(
          costCenter.id,
          costCenter.companyId,
          costCenter.name,
          costCenter.parentId,
        ),
      );

      return Result.success(costCenter);
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }
  }
}
