import type { Installment, InstallmentStatus } from "../domain/installment.js";
import type { QueryExecutor } from "./account-repository.js";

/**
 * Filters accepted when listing installments.
 */
export interface InstallmentFilter {
  status?: InstallmentStatus | undefined;
  accountId?: string | undefined;
  parentTransactionId?: string | undefined;
  dueFrom?: Date | undefined;
  dueTo?: Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * Repository interface for the Installment entity.
 * Every method is scoped by companyId (multi-tenancy invariant).
 */
export interface InstallmentRepository {
  createMany(
    installments: readonly Installment[],
    executor?: QueryExecutor,
  ): Promise<void>;

  findById(companyId: string, id: string): Promise<Installment | null>;

  findMany(
    companyId: string,
    filter?: InstallmentFilter,
  ): Promise<{ items: Installment[]; total: number }>;

  findByParentTransactionId(
    companyId: string,
    parentTransactionId: string,
  ): Promise<Installment[]>;

  /**
   * Pending installments whose due date has already passed, for the scheduler.
   */
  findOverdueCandidates(
    companyId: string,
    referenceDate: Date,
  ): Promise<Installment[]>;

  update(installment: Installment, executor?: QueryExecutor): Promise<void>;
}
