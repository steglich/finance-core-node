import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import { CostCenterHierarchy } from "../domain/cost-center-hierarchy.js";
import { CostCenter } from "../domain/cost-center.js";
import type { CostCenterRepository } from "../infrastructure/cost-center-repository.js";
import {
  validateCreateCostCenterRequest,
  validateUpdateCostCenterRequest,
} from "./dtos.js";

/**
 * Cost center endpoints. The company scope always comes from the token.
 *
 * Every structural operation loads the whole tree first: depth, ancestry and
 * the deactivation cascade cannot be decided from a single row.
 */
export class CostCenterController {
  constructor(
    private readonly costCenterRepository: CostCenterRepository,
    private readonly eventBus: DomainEventBus,
  ) {}

  /**
   * POST /api/v1/cost-centers
   */
  async create(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateCreateCostCenterRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const hierarchy = await this.loadHierarchy(companyId);
    const { name, description, parentId } = validation.data;

    const placeable = hierarchy.canPlace(parentId, name);
    if (placeable.isFailure) {
      throw this.orGeneric(placeable.error);
    }

    const result = CostCenter.create({
      companyId,
      name,
      description,
      parent: parentId ? hierarchy.find(parentId) : undefined,
    });
    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    await this.costCenterRepository.create(result.value);
    this.publish([result.value]);

    return { statusCode: 201, body: result.value.toJSON() };
  }

  /**
   * GET /api/v1/cost-centers — the company's cost centers as a tree.
   */
  async list(
    companyId: string,
    query: { includeInactive?: string | boolean | undefined } = {},
  ): Promise<ControllerResult> {
    const all = await this.costCenterRepository.findByCompany(companyId);

    const includeInactive =
      query.includeInactive === true || query.includeInactive === "true";
    const visible = includeInactive
      ? all
      : all.filter((costCenter) => costCenter.isActive);

    const hierarchy = new CostCenterHierarchy(visible);

    return {
      statusCode: 200,
      body: {
        costCenters: visible.map((costCenter) => costCenter.toJSON()),
        tree: this.serializeTree(hierarchy),
      },
    };
  }

  /**
   * GET /api/v1/cost-centers/:costCenterId — with its descendants.
   */
  async get(
    companyId: string,
    costCenterId: string,
  ): Promise<ControllerResult> {
    const hierarchy = await this.loadHierarchy(companyId);
    const costCenter = hierarchy.find(costCenterId);
    if (!costCenter) {
      return { statusCode: 404, body: { error: "Cost center not found" } };
    }

    return {
      statusCode: 200,
      body: {
        ...(costCenter.toJSON() as Record<string, unknown>),
        depth: hierarchy.depthOf(costCenterId),
        descendants: hierarchy
          .descendantsOf(costCenterId)
          .map((node) => node.toJSON()),
      },
    };
  }

  /**
   * PUT /api/v1/cost-centers/:costCenterId
   */
  async update(
    companyId: string,
    costCenterId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateUpdateCostCenterRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const hierarchy = await this.loadHierarchy(companyId);
    const costCenter = hierarchy.find(costCenterId);
    if (!costCenter) {
      return { statusCode: 404, body: { error: "Cost center not found" } };
    }

    const { name, description, parentId, parentProvided } = validation.data;

    // A rename must not collide with a sibling, under the current parent or
    // under the one the same request is moving it to.
    if (name !== undefined) {
      const targetParent = parentProvided
        ? (parentId ?? undefined)
        : costCenter.parentId;
      const placeable = hierarchy.canPlace(targetParent, name, costCenterId);
      if (placeable.isFailure) {
        throw this.orGeneric(placeable.error);
      }
    }

    if (name !== undefined || description !== undefined) {
      const edited = costCenter.edit({ name, description });
      if (edited.isFailure) {
        throw this.orGeneric(edited.error);
      }
    }

    if (parentProvided) {
      const moved = hierarchy.move(costCenterId, parentId ?? undefined);
      if (moved.isFailure) {
        throw this.orGeneric(moved.error);
      }
    }

    await this.costCenterRepository.update(costCenter);
    this.publish([costCenter]);

    return { statusCode: 200, body: costCenter.toJSON() };
  }

  /**
   * DELETE /api/v1/cost-centers/:costCenterId — deactivates the subtree.
   * Cost centers are never physically deleted, and transactions already
   * classified with them keep the classification.
   */
  async deactivate(
    companyId: string,
    costCenterId: string,
  ): Promise<ControllerResult> {
    const hierarchy = await this.loadHierarchy(companyId);
    const costCenter = hierarchy.find(costCenterId);
    if (!costCenter) {
      return { statusCode: 404, body: { error: "Cost center not found" } };
    }

    const subtreeIds = [
      costCenterId,
      ...hierarchy.descendantsOf(costCenterId).map((node) => node.id),
    ];
    const activeBudgets = await this.costCenterRepository.countActiveBudgets(
      companyId,
      subtreeIds,
    );

    const result = hierarchy.deactivate(costCenterId, activeBudgets);
    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    await this.costCenterRepository.updateMany(result.value);
    // Every node of the cascade publishes its own event, so the audit trail
    // shows the whole reach of the deactivation.
    this.publish(result.value);

    return {
      statusCode: 200,
      body: { deactivated: result.value.map((node) => node.toJSON()) },
    };
  }

  private async loadHierarchy(
    companyId: string,
  ): Promise<CostCenterHierarchy> {
    return new CostCenterHierarchy(
      await this.costCenterRepository.findByCompany(companyId),
    );
  }

  /**
   * Turns the domain tree into plain JSON, so the entities are serialized by
   * their own `toJSON()` rather than leaking their private fields.
   */
  private serializeTree(hierarchy: CostCenterHierarchy): unknown[] {
    const serialize = (nodes: ReturnType<CostCenterHierarchy["tree"]>): unknown[] =>
      nodes.map((node) => ({
        costCenter: node.costCenter.toJSON(),
        children: serialize(node.children),
      }));

    return serialize(hierarchy.tree());
  }

  private publish(costCenters: readonly CostCenter[]): void {
    for (const costCenter of costCenters) {
      for (const event of costCenter.events) {
        this.eventBus.publish(event);
      }
      costCenter.clearEvents();
    }
  }

  private orGeneric(error: DomainError | undefined): DomainError {
    return (
      error ??
      DomainError.create("BUSINESS_RULE_VIOLATION", "Operation not allowed")
    );
  }
}
