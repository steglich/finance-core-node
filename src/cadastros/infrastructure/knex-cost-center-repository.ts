import type { Knex } from "knex";
import { CostCenter } from "../domain/cost-center.js";
import type { CostCenterRepository } from "./cost-center-repository.js";

/**
 * Maps a `cost_centers` row into the CostCenter entity.
 */
function toCostCenter(row: Record<string, unknown>): CostCenter {
  return new CostCenter({
    id: row.id as string,
    companyId: row.company_id as string,
    name: row.name as string,
    parentId: (row.parent_id as string | null) ?? undefined,
    description: (row.description as string | null) ?? undefined,
    isActive: Boolean(row.is_active),
    createdAt: new Date(row.created_at as string),
  });
}

/**
 * Knex-based implementation of CostCenterRepository.
 */
export class KnexCostCenterRepository implements CostCenterRepository {
  constructor(private readonly knex: Knex) {}

  async create(costCenter: CostCenter): Promise<void> {
    await this.knex("cost_centers").insert({
      id: costCenter.id,
      company_id: costCenter.companyId,
      parent_id: costCenter.parentId ?? null,
      name: costCenter.name,
      description: costCenter.description ?? null,
      is_active: costCenter.isActive,
      created_at: costCenter.createdAt,
      updated_at: new Date(),
    });
  }

  async findById(companyId: string, id: string): Promise<CostCenter | null> {
    const row = await this.knex("cost_centers")
      .where({ id, company_id: companyId })
      .first();

    return row ? toCostCenter(row as Record<string, unknown>) : null;
  }

  /**
   * Loads the whole tree in one query: `CostCenterHierarchy` needs every node,
   * including the inactive ones, to compute depth and ancestry correctly.
   */
  async findByCompany(companyId: string): Promise<CostCenter[]> {
    const rows = await this.knex("cost_centers")
      .where({ company_id: companyId })
      .orderBy("name", "asc");

    return rows.map((row) => toCostCenter(row as Record<string, unknown>));
  }

  async update(costCenter: CostCenter): Promise<void> {
    await this.knex("cost_centers")
      .where({ id: costCenter.id, company_id: costCenter.companyId })
      .update({
        parent_id: costCenter.parentId ?? null,
        name: costCenter.name,
        description: costCenter.description ?? null,
        is_active: costCenter.isActive,
        updated_at: new Date(),
      });
  }

  async updateMany(costCenters: readonly CostCenter[]): Promise<void> {
    if (costCenters.length === 0) {
      return;
    }

    await this.knex.transaction(async (trx) => {
      for (const costCenter of costCenters) {
        await trx("cost_centers")
          .where({ id: costCenter.id, company_id: costCenter.companyId })
          .update({
            parent_id: costCenter.parentId ?? null,
            name: costCenter.name,
            description: costCenter.description ?? null,
            is_active: costCenter.isActive,
            updated_at: new Date(),
          });
      }
    });
  }

  async countActiveBudgets(
    companyId: string,
    costCenterIds: readonly string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (costCenterIds.length === 0) {
      return counts;
    }

    const rows = await this.knex("budgets")
      .where({ company_id: companyId, status: "ACTIVE" })
      .whereIn("cost_center_id", [...costCenterIds])
      .groupBy("cost_center_id")
      .select("cost_center_id")
      .count<{ cost_center_id: string; count: string }[]>("id as count");

    for (const row of rows as { cost_center_id: string; count: string }[]) {
      counts.set(row.cost_center_id, Number(row.count));
    }

    return counts;
  }
}
