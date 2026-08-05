import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import { TreeHierarchy } from "../../shared/domain/tree-hierarchy.js";
import type { CostCenter } from "./cost-center.js";

/**
 * A cost center with its children nested underneath.
 */
export interface CostCenterNode {
  costCenter: CostCenter;
  children: CostCenterNode[];
}

/**
 * Maximum number of levels in the tree: root, child and grandchild.
 */
export const MAX_COST_CENTER_DEPTH = 3;

/**
 * Active-budget counts per cost center, supplied by the caller — budgets live
 * in the finance context, so the domain receives the fact instead of fetching it.
 */
export type ActiveBudgetCounts = ReadonlyMap<string, number>;

/**
 * Domain service over a flat set of cost centers of a single company.
 *
 * Inherits the generic traversal from `TreeHierarchy` and adds only what is
 * specific: the three-level limit, the reparenting guard and the cascade that
 * deactivation carries down the subtree.
 */
export class CostCenterHierarchy extends TreeHierarchy<
  CostCenter,
  CostCenterNode
> {
  constructor(costCenters: readonly CostCenter[]) {
    super(costCenters);
  }

  protected override wrapNode(
    costCenter: CostCenter,
    children: CostCenterNode[],
  ): CostCenterNode {
    return { costCenter, children };
  }

  /**
   * Validates that a new cost center fits under `parentId`: the parent exists
   * and is active, the resulting depth stays within the limit and no sibling
   * already carries the name.
   */
  canPlace(
    parentId: string | undefined,
    name: string,
    exceptId?: string,
  ): Result<true> {
    if (parentId !== undefined) {
      const parent = this.byId.get(parentId);
      if (!parent) {
        return Result.failed(
          DomainError.create(
            "ENTITY_NOT_FOUND",
            `Parent cost center ${parentId} was not found`,
          ),
        );
      }

      if (!parent.isActive) {
        return Result.failed(
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            "A cost center cannot be placed under an inactive parent",
          ),
        );
      }

      if (this.depthOf(parentId) + 1 >= MAX_COST_CENTER_DEPTH) {
        return Result.failed(
          DomainError.create(
            "VALIDATION_ERROR",
            `Cost centers are limited to ${MAX_COST_CENTER_DEPTH} levels`,
          ),
        );
      }
    }

    if (this.siblingsOf(parentId).some(
      (sibling) =>
        sibling.id !== exceptId &&
        sibling.name.trim().toLowerCase() === name.trim().toLowerCase(),
    )) {
      return Result.failed(
        DomainError.create(
          "DUPLICATE_ENTITY",
          `A cost center named "${name.trim()}" already exists under the same parent`,
        ),
      );
    }

    return Result.success(true);
  }

  /**
   * The nodes sharing `parentId` — the roots when it is undefined.
   */
  siblingsOf(parentId: string | undefined): CostCenter[] {
    return parentId === undefined ? this.roots() : this.childrenOf(parentId);
  }

  /**
   * Moves a cost center under a new parent, rejecting cycles, cross-company
   * moves, duplicate sibling names and moves that would push the subtree past
   * the depth limit.
   */
  move(
    costCenterId: string,
    newParentId: string | undefined,
  ): Result<CostCenter> {
    const costCenter = this.byId.get(costCenterId);
    if (!costCenter) {
      return Result.failed(
        DomainError.create(
          "ENTITY_NOT_FOUND",
          `Cost center ${costCenterId} was not found`,
        ),
      );
    }

    if (newParentId === undefined) {
      const placeable = this.canPlace(undefined, costCenter.name, costCenterId);
      if (placeable.isFailure) {
        return Result.failed(placeable.error!);
      }
      return costCenter.moveTo(undefined);
    }

    const newParent = this.byId.get(newParentId);
    if (!newParent) {
      return Result.failed(
        DomainError.create(
          "ENTITY_NOT_FOUND",
          `Parent cost center ${newParentId} was not found`,
        ),
      );
    }

    if (newParent.companyId !== costCenter.companyId) {
      return Result.failed(
        DomainError.create(
          "UNAUTHORIZED_ACCESS",
          "Cost centers can only be moved within the same company",
        ),
      );
    }

    // Moving under a descendant would detach the subtree from the tree; the
    // ancestor walk below is what makes the check cheap and cycle-safe.
    if (this.isDescendantOf(newParentId, costCenterId)) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          "A cost center cannot be moved under one of its own descendants",
        ),
      );
    }

    const placeable = this.canPlace(newParentId, costCenter.name, costCenterId);
    if (placeable.isFailure) {
      return Result.failed(placeable.error!);
    }

    // The whole subtree travels with the node, so the deepest descendant is
    // what decides whether the move still fits within the limit.
    const newDepth = this.depthOf(newParentId) + 1;
    const subtreeHeight = this.descendantsOf(costCenterId).reduce(
      (height, descendant) =>
        Math.max(
          height,
          this.depthOf(descendant.id) - this.depthOf(costCenterId),
        ),
      0,
    );

    if (newDepth + subtreeHeight >= MAX_COST_CENTER_DEPTH) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          `Moving the cost center would exceed the ${MAX_COST_CENTER_DEPTH} level limit`,
        ),
      );
    }

    const ancestorIds = this.ancestorsOf(newParentId).map(
      (ancestor) => ancestor.id,
    );

    return costCenter.moveTo(newParentId, ancestorIds);
  }

  /**
   * Deactivates a cost center together with its descendants. Rejected as a
   * whole when any node in the subtree is still referenced by an active budget,
   * so the operation never leaves the tree half deactivated.
   */
  deactivate(
    costCenterId: string,
    activeBudgetCounts: ActiveBudgetCounts = new Map(),
  ): Result<CostCenter[]> {
    const costCenter = this.byId.get(costCenterId);
    if (!costCenter) {
      return Result.failed(
        DomainError.create(
          "ENTITY_NOT_FOUND",
          `Cost center ${costCenterId} was not found`,
        ),
      );
    }

    if (!costCenter.isActive) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "Cost center is already inactive",
        ),
      );
    }

    const subtree = [
      costCenter,
      ...this.descendantsOf(costCenterId).filter((node) => node.isActive),
    ];

    for (const node of subtree) {
      const budgets = activeBudgetCounts.get(node.id) ?? 0;
      if (budgets > 0) {
        return Result.failed(
          DomainError.create(
            "BUSINESS_RULE_VIOLATION",
            `Cost center "${node.name}" is referenced by ${budgets} active budget(s) and cannot be deactivated`,
          ),
        );
      }
    }

    for (const node of subtree) {
      const result = node.deactivate();
      if (result.isFailure) {
        return Result.failed(result.error!);
      }
    }

    return Result.success(subtree);
  }
}
