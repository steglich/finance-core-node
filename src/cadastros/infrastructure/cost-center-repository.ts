import type { CostCenter } from "../domain/cost-center.js";

/**
 * Repository interface for the CostCenter entity.
 * Every method is scoped by companyId (multi-tenancy invariant).
 */
export interface CostCenterRepository {
  /**
   * Persists a new cost center.
   */
  create(costCenter: CostCenter): Promise<void>;

  /**
   * Finds a cost center by id within a company.
   */
  findById(companyId: string, id: string): Promise<CostCenter | null>;

  /**
   * Every cost center of the company — the whole tree, active and inactive.
   * The caller feeds it to `CostCenterHierarchy`, which needs the complete set
   * to answer depth, ancestry and cascade questions.
   */
  findByCompany(companyId: string): Promise<CostCenter[]>;

  /**
   * Updates a cost center.
   */
  update(costCenter: CostCenter): Promise<void>;

  /**
   * Updates several cost centers at once — the deactivation cascade writes the
   * whole subtree in one transaction.
   */
  updateMany(costCenters: readonly CostCenter[]): Promise<void>;

  /**
   * Number of active budgets referencing each of the given cost centers.
   * Feeds `CostCenterHierarchy.deactivate()`, which refuses to deactivate a
   * subtree while a budget still points at any node of it.
   */
  countActiveBudgets(
    companyId: string,
    costCenterIds: readonly string[],
  ): Promise<Map<string, number>>;
}
