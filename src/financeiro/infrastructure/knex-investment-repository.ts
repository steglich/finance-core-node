import type { Knex } from "knex";
import { Investment } from "../domain/investment.js";
import type { InvestmentStatus, InvestmentType } from "../domain/investment.js";
import { InvestmentOperation } from "../domain/investment-operation.js";
import type { OperationType } from "../domain/investment-operation.js";
import { Money } from "../domain/money.js";
import type { QueryExecutor } from "./account-repository.js";
import type {
  InvestmentFilter,
  InvestmentOperationFilter,
  InvestmentPositionSummary,
  InvestmentRepository,
  PortfolioEntry,
} from "./investment-repository.js";

function toInvestment(row: Record<string, unknown>): Investment {
  return new Investment({
    id: row.id as string,
    companyId: row.company_id as string,
    accountId: row.account_id as string,
    name: row.name as string,
    investmentType: row.investment_type as InvestmentType,
    symbol: (row.symbol as string | null) ?? undefined,
    currency: row.currency as string,
    expenseCategoryId: row.expense_category_id as string,
    incomeCategoryId: row.income_category_id as string,
    status: row.status as InvestmentStatus,
    closedAt: row.closed_at ? new Date(row.closed_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
  });
}

function toOperation(row: Record<string, unknown>): InvestmentOperation {
  const currency = row.currency as string;

  return new InvestmentOperation({
    id: row.id as string,
    companyId: row.company_id as string,
    investmentId: row.investment_id as string,
    transactionId: (row.transaction_id as string | null) ?? undefined,
    operationType: row.operation_type as OperationType,
    quantity: Number(row.quantity ?? 0),
    unitPrice: Number(row.unit_price ?? 0),
    fees: Money.fromDecimalString(String(row.fees ?? "0"), currency),
    amount: Money.fromDecimalString(String(row.amount ?? "0"), currency),
    currency,
    operatedAt: new Date(row.operated_at as string),
    notes: (row.notes as string | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
  });
}

/**
 * The aggregation shared by `positionSummary` and `portfolio`: the whole
 * position of an investment in one row, without hydrating any operation.
 */
const POSITION_AGGREGATES = `
  coalesce(sum(case when o.operation_type = 'BUY' then o.quantity
                    when o.operation_type = 'SELL' then -o.quantity
                    else 0 end), 0) as quantity,
  coalesce(sum(case when o.operation_type = 'BUY' then o.amount else 0 end), 0) as bought_amount,
  coalesce(sum(case when o.operation_type = 'BUY' then o.quantity else 0 end), 0) as bought_quantity,
  coalesce(sum(case when o.operation_type = 'SELL' then o.quantity else 0 end), 0) as sold_quantity,
  coalesce(sum(case when o.operation_type = 'SELL' then o.amount else 0 end), 0) as sold_amount,
  coalesce(sum(case when o.operation_type in ('DIVIDEND', 'INTEREST', 'AMORTIZATION')
                    then o.amount else 0 end), 0) as income_received
`;

/**
 * Turns the SQL aggregates into the derived figures.
 *
 * Average cost is the cost of everything bought divided by everything bought,
 * which under an average-cost policy is also the cost of what remains — so the
 * invested amount is that average applied to the remaining quantity, and the
 * realized result is the sale proceeds minus the same average applied to the
 * quantity sold.
 */
function summarize(
  investmentId: string,
  row: Record<string, unknown>,
): InvestmentPositionSummary {
  const quantity = Number(row.quantity ?? 0);
  const boughtQuantity = Number(row.bought_quantity ?? 0);
  const boughtAmount = Number(row.bought_amount ?? 0);
  const soldQuantity = Number(row.sold_quantity ?? 0);
  const soldAmount = Number(row.sold_amount ?? 0);
  const incomeReceived = Number(row.income_received ?? 0);

  const averageCost = boughtQuantity > 0 ? boughtAmount / boughtQuantity : 0;
  const investedAmount =
    quantity > 0 ? Math.round(averageCost * quantity * 100) / 100 : 0;
  const realizedResult =
    soldQuantity > 0
      ? Math.round((soldAmount - averageCost * soldQuantity) * 100) / 100
      : 0;

  return {
    investmentId,
    quantity,
    investedAmount,
    realizedResult,
    incomeReceived,
  };
}

/**
 * Knex-based implementation of InvestmentRepository.
 */
export class KnexInvestmentRepository implements InvestmentRepository {
  constructor(private readonly knex: Knex) {}

  private executor(executor?: QueryExecutor): QueryExecutor {
    return executor ?? this.knex;
  }

  async create(investment: Investment, executor?: QueryExecutor): Promise<void> {
    await this.executor(executor)("investments").insert({
      id: investment.id,
      company_id: investment.companyId,
      account_id: investment.accountId,
      name: investment.name,
      investment_type: investment.investmentType,
      symbol: investment.symbol ?? null,
      currency: investment.currency,
      expense_category_id: investment.expenseCategoryId,
      income_category_id: investment.incomeCategoryId,
      status: investment.status,
      closed_at: investment.closedAt ?? null,
      created_at: investment.createdAt,
      updated_at: new Date(),
    });
  }

  async findById(companyId: string, id: string): Promise<Investment | null> {
    const row = await this.knex("investments")
      .where({ id, company_id: companyId })
      .first();

    return row ? toInvestment(row as Record<string, unknown>) : null;
  }

  /**
   * Locks the investment row for the duration of the surrounding database
   * transaction, so two concurrent sales cannot both read a position that only
   * one of them may consume.
   */
  async findByIdForUpdate(
    companyId: string,
    id: string,
    executor: QueryExecutor,
  ): Promise<Investment | null> {
    const row = await executor("investments")
      .where({ id, company_id: companyId })
      .forUpdate()
      .first();

    return row ? toInvestment(row as Record<string, unknown>) : null;
  }

  async findByCompany(
    companyId: string,
    filter: InvestmentFilter = {},
  ): Promise<{ items: Investment[]; total: number }> {
    const base = this.knex("investments").where({ company_id: companyId });

    if (filter.status) {
      base.andWhere("status", filter.status);
    }
    if (filter.investmentType) {
      base.andWhere("investment_type", filter.investmentType);
    }
    if (filter.accountId) {
      base.andWhere("account_id", filter.accountId);
    }

    const countResult = (await base
      .clone()
      .count<{ count: string }[]>("id as count")) as { count: string }[];

    const query = base.clone().orderBy("name", "asc");
    if (filter.limit !== undefined) {
      query.limit(filter.limit);
    }
    if (filter.offset !== undefined) {
      query.offset(filter.offset);
    }

    const rows = await query;

    return {
      items: rows.map((row) => toInvestment(row as Record<string, unknown>)),
      total: Number(countResult[0]?.count ?? 0),
    };
  }

  async update(investment: Investment, executor?: QueryExecutor): Promise<void> {
    await this.executor(executor)("investments")
      .where({ id: investment.id, company_id: investment.companyId })
      .update({
        name: investment.name,
        symbol: investment.symbol ?? null,
        expense_category_id: investment.expenseCategoryId,
        income_category_id: investment.incomeCategoryId,
        status: investment.status,
        closed_at: investment.closedAt ?? null,
        updated_at: new Date(),
      });
  }

  async listOperations(
    companyId: string,
    investmentId: string,
    filter: InvestmentOperationFilter = {},
    executor?: QueryExecutor,
  ): Promise<InvestmentOperation[]> {
    const query = this.executor(executor)("investment_operations")
      .where({ company_id: companyId, investment_id: investmentId });

    if (filter.from) {
      query.andWhere("operated_at", ">=", filter.from);
    }
    if (filter.to) {
      query.andWhere("operated_at", "<=", filter.to);
    }

    // Chronological, then by insertion: the position derivation consumes sales
    // against the buys that preceded them.
    query.orderBy("operated_at", "asc").orderBy("created_at", "asc");

    if (filter.limit !== undefined) {
      query.limit(filter.limit);
    }
    if (filter.offset !== undefined) {
      query.offset(filter.offset);
    }

    const rows = await query;

    return rows.map((row) => toOperation(row as Record<string, unknown>));
  }

  async createOperation(
    operation: InvestmentOperation,
    executor?: QueryExecutor,
  ): Promise<void> {
    await this.executor(executor)("investment_operations").insert({
      id: operation.id,
      company_id: operation.companyId,
      investment_id: operation.investmentId,
      // Deliberately null: the transaction does not exist yet and it is the one
      // holding the foreign key to this row. `linkOperationTransaction` closes
      // the loop in the same database transaction.
      transaction_id: null,
      operation_type: operation.operationType,
      quantity: operation.quantity,
      unit_price: operation.unitPrice,
      fees: operation.fees.toDecimalString(),
      amount: operation.amount.toDecimalString(),
      currency: operation.currency,
      operated_at: operation.operatedAt,
      notes: operation.notes ?? null,
      created_at: operation.createdAt,
      updated_at: new Date(),
    });
  }

  async linkOperationTransaction(
    companyId: string,
    operationId: string,
    transactionId: string,
    executor?: QueryExecutor,
  ): Promise<void> {
    await this.executor(executor)("investment_operations")
      .where({ id: operationId, company_id: companyId })
      .update({ transaction_id: transactionId, updated_at: new Date() });
  }

  async positionSummary(
    companyId: string,
    investmentId: string,
    referenceDate: Date,
  ): Promise<InvestmentPositionSummary> {
    const row = (await this.knex("investment_operations as o")
      .where({ "o.company_id": companyId, "o.investment_id": investmentId })
      .andWhere("o.operated_at", "<=", referenceDate)
      .select(this.knex.raw(POSITION_AGGREGATES))
      .first()) as Record<string, unknown> | undefined;

    return summarize(investmentId, row ?? {});
  }

  async portfolio(
    companyId: string,
    referenceDate: Date,
    filter: InvestmentFilter = {},
  ): Promise<PortfolioEntry[]> {
    // Aggregated in SQL, one row per investment — the operations themselves are
    // never hydrated (design, decision 3).
    const positions = this.knex("investment_operations as o")
      .where("o.company_id", companyId)
      .andWhere("o.operated_at", "<=", referenceDate)
      .groupBy("o.investment_id")
      .select("o.investment_id")
      .select(this.knex.raw(POSITION_AGGREGATES))
      .as("p");

    // The quote in force at the reference date, one row per investment.
    const quotes = this.knex("investment_quotes")
      .distinctOn("investment_id")
      .where("quote_date", "<=", referenceDate)
      .orderBy("investment_id")
      .orderBy("quote_date", "desc")
      .select("investment_id", "unit_price")
      .as("q");

    const base = this.knex("investments as i")
      .leftJoin(positions, "p.investment_id", "i.id")
      .leftJoin(quotes, "q.investment_id", "i.id")
      .where("i.company_id", companyId);

    if (filter.status) {
      base.andWhere("i.status", filter.status);
    }
    if (filter.investmentType) {
      base.andWhere("i.investment_type", filter.investmentType);
    }
    if (filter.accountId) {
      base.andWhere("i.account_id", filter.accountId);
    }

    const rows = (await base
      .select(
        "i.id",
        "i.name",
        "i.investment_type",
        "i.symbol",
        "i.currency",
        "i.status",
        "q.unit_price",
        "p.quantity",
        "p.bought_amount",
        "p.bought_quantity",
        "p.sold_quantity",
        "p.sold_amount",
        "p.income_received",
      )
      .orderBy("i.name", "asc")) as Record<string, unknown>[];

    return rows.map((row) => {
      const summary = summarize(row.id as string, row);
      const unitPrice =
        row.unit_price === null || row.unit_price === undefined
          ? undefined
          : Number(row.unit_price);

      return {
        ...summary,
        name: row.name as string,
        investmentType: row.investment_type as InvestmentType,
        symbol: (row.symbol as string | null) ?? undefined,
        currency: row.currency as string,
        status: row.status as InvestmentStatus,
        unitPrice,
      };
    });
  }
}
