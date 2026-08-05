import type { Investment, InvestmentStatus, InvestmentType } from "../domain/investment.js";
import type { InvestmentOperation } from "../domain/investment-operation.js";
import type { QueryExecutor } from "./account-repository.js";

/**
 * Filters accepted when listing investments.
 */
export interface InvestmentFilter {
  status?: InvestmentStatus | undefined;
  investmentType?: InvestmentType | undefined;
  accountId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * Filters accepted when listing the operations of an investment.
 */
export interface InvestmentOperationFilter {
  from?: Date | undefined;
  to?: Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * The aggregated figures of one investment, summed in SQL rather than by
 * hydrating every operation (design, decision 3).
 *
 * Average cost is remaining cost ÷ remaining quantity, which is well defined
 * precisely because the policy is average cost and not FIFO — it does not
 * depend on the order the operations came in.
 */
export interface InvestmentPositionSummary {
  investmentId: string;
  quantity: number;
  investedAmount: number;
  realizedResult: number;
  incomeReceived: number;
}

/**
 * One line of the portfolio projection: the investment's identity plus its
 * aggregated position and the quote in force at the reference date.
 */
export interface PortfolioEntry extends InvestmentPositionSummary {
  name: string;
  investmentType: InvestmentType;
  symbol?: string | undefined;
  currency: string;
  status: InvestmentStatus;
  /** Undefined when no quote exists on or before the reference date. */
  unitPrice?: number | undefined;
}

/**
 * Repository interface for the Investment aggregate root.
 * Every method is scoped by companyId (multi-tenancy invariant).
 */
export interface InvestmentRepository {
  create(investment: Investment, executor?: QueryExecutor): Promise<void>;

  findById(companyId: string, id: string): Promise<Investment | null>;

  /**
   * Reads the investment with its row locked (`select … for update`).
   *
   * Required by the operation registration: the invariant it protects — sold
   * quantity ≤ position — is a sum over another table, so it does not fit in a
   * WHERE clause the way the charge guard does (design, decision 4).
   */
  findByIdForUpdate(
    companyId: string,
    id: string,
    executor: QueryExecutor,
  ): Promise<Investment | null>;

  findByCompany(
    companyId: string,
    filter?: InvestmentFilter,
  ): Promise<{ items: Investment[]; total: number }>;

  update(investment: Investment, executor?: QueryExecutor): Promise<void>;

  listOperations(
    companyId: string,
    investmentId: string,
    filter?: InvestmentOperationFilter,
    executor?: QueryExecutor,
  ): Promise<InvestmentOperation[]>;

  /**
   * Writes the operation. Its `transaction_id` is left unset, because the
   * transaction carries a foreign key back to the operation — the two tables
   * reference each other, so one of the links has to be closed afterwards by
   * `linkOperationTransaction`, inside the same database transaction.
   */
  createOperation(
    operation: InvestmentOperation,
    executor?: QueryExecutor,
  ): Promise<void>;

  /**
   * Closes the operation → transaction link once the transaction exists.
   */
  linkOperationTransaction(
    companyId: string,
    operationId: string,
    transactionId: string,
    executor?: QueryExecutor,
  ): Promise<void>;

  /**
   * The aggregated position of one investment at a reference date.
   */
  positionSummary(
    companyId: string,
    investmentId: string,
    referenceDate: Date,
  ): Promise<InvestmentPositionSummary>;

  /**
   * The whole portfolio at a reference date, aggregated in SQL.
   */
  portfolio(
    companyId: string,
    referenceDate: Date,
    filter?: InvestmentFilter,
  ): Promise<PortfolioEntry[]>;
}
