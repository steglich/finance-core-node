import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import { addMonths, toUtcDate } from "./date-math.js";
import type { ExchangeService } from "./exchange-service.js";
import { Money } from "./money.js";
import type {
  NetWorthComponentRow,
  NetWorthRepository,
} from "../infrastructure/net-worth-repository.js";
import type { CrossCompanyReader } from "../infrastructure/net-worth-repository.js";

/**
 * One component after conversion, carrying the rate that produced it so that
 * every figure can be traced back to where it came from.
 */
export interface ConvertedComponent {
  component: string;
  side: "ASSET" | "LIABILITY";
  currency: string;
  originalAmount: number;
  amount: number;
  rate: number;
  rateDate: Date;
}

/**
 * Net worth for one company at one date, in the display currency.
 */
export interface NetWorth {
  referenceDate: Date;
  displayCurrency: string;
  components: ConvertedComponent[];
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

/**
 * One point of the evolution series.
 */
export interface NetWorthPoint {
  monthEnd: Date;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

/**
 * One line of the multi-company consolidation.
 */
export interface CompanyNetWorthLine {
  companyId: string;
  companyName: string;
  netWorth: number;
}

export interface ConsolidatedNetWorth {
  referenceDate: Date;
  displayCurrency: string;
  companies: CompanyNetWorthLine[];
  total: number;
}

/**
 * The last day of the month a date falls in, at midnight UTC.
 */
function endOfMonth(date: Date): Date {
  const base = toUtcDate(date);
  return new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0),
  );
}

/**
 * Produces net worth from the raw components, converting each one with the rate
 * in force on the reference date.
 *
 * The conversion happens here rather than in SQL because doing it in SQL would
 * reimplement the rate resolution — most recent on or before the date, with the
 * inverse-pair fallback — a second time, and the copy is always the one that
 * drifts (design, decision 11). A component that cannot be converted fails the
 * whole reading: a partial total presented as complete is worse than an error.
 */
export class NetWorthService {
  constructor(
    private readonly repository: NetWorthRepository,
    private readonly exchangeService: ExchangeService,
    private readonly crossCompany?: CrossCompanyReader,
  ) {}

  /**
   * Resolves the display currency, falling back to the company's default.
   */
  async resolveDisplayCurrency(
    companyId: string,
    requested?: string,
  ): Promise<string> {
    return requested ?? (await this.repository.defaultCurrency(companyId));
  }

  private async convert(
    companyId: string,
    rows: readonly NetWorthComponentRow[],
    displayCurrency: string,
    referenceDate: Date,
  ): Promise<Result<ConvertedComponent[]>> {
    const converted: ConvertedComponent[] = [];

    for (const row of rows) {
      const result = await this.exchangeService.convert(
        companyId,
        Money.create(row.amount, row.currency),
        displayCurrency,
        referenceDate,
      );

      if (result.isFailure || !result.value) {
        return Result.failed(
          result.error ??
            DomainError.create(
              "ENTITY_NOT_FOUND",
              `No exchange rate available to express ${row.currency} in ${displayCurrency}`,
            ),
        );
      }

      converted.push({
        component: row.component,
        side: row.side,
        currency: row.currency,
        originalAmount: row.amount,
        amount: result.value.amount.amount,
        rate: result.value.rate,
        rateDate: result.value.rateDate,
      });
    }

    return Result.success(converted);
  }

  private totals(
    components: readonly ConvertedComponent[],
    displayCurrency: string,
  ): { totalAssets: number; totalLiabilities: number; netWorth: number } {
    const assets = Money.sum(
      displayCurrency,
      components
        .filter((component) => component.side === "ASSET")
        .map((component) => Money.create(component.amount, displayCurrency)),
    );

    const liabilities = Money.sum(
      displayCurrency,
      components
        .filter((component) => component.side === "LIABILITY")
        .map((component) => Money.create(component.amount, displayCurrency)),
    );

    return {
      totalAssets: assets.amount,
      totalLiabilities: liabilities.amount,
      netWorth: assets.subtract(liabilities).amount,
    };
  }

  /**
   * Net worth of one company at a reference date.
   */
  async netWorthAt(
    companyId: string,
    referenceDate: Date,
    displayCurrency: string,
    accountIds?: readonly string[],
  ): Promise<Result<NetWorth>> {
    const rows = await this.repository.netWorthAt(
      companyId,
      referenceDate,
      accountIds,
    );

    const converted = await this.convert(
      companyId,
      rows,
      displayCurrency,
      referenceDate,
    );
    if (converted.isFailure || !converted.value) {
      return Result.failed(
        converted.error ??
          DomainError.create(
            "ENTITY_NOT_FOUND",
            "Could not convert the net worth components",
          ),
      );
    }

    return Result.success({
      referenceDate,
      displayCurrency,
      components: converted.value,
      ...this.totals(converted.value, displayCurrency),
    });
  }

  /**
   * One point per month end over the period. A month before the company had any
   * data comes back zeroed rather than missing.
   */
  async evolution(
    companyId: string,
    start: Date,
    end: Date,
    displayCurrency: string,
  ): Promise<Result<NetWorthPoint[]>> {
    const points: NetWorthPoint[] = [];

    let cursor = endOfMonth(start);
    const last = endOfMonth(end);

    while (cursor.getTime() <= last.getTime()) {
      const result = await this.netWorthAt(
        companyId,
        cursor,
        displayCurrency,
      );
      if (result.isFailure || !result.value) {
        return Result.failed(
          result.error ??
            DomainError.create(
              "ENTITY_NOT_FOUND",
              "Could not produce the net worth evolution",
            ),
        );
      }

      points.push({
        monthEnd: cursor,
        totalAssets: result.value.totalAssets,
        totalLiabilities: result.value.totalLiabilities,
        netWorth: result.value.netWorth,
      });

      cursor = endOfMonth(addMonths(cursor, 1));
    }

    return Result.success(points);
  }

  /**
   * Net worth across the companies the user belongs to.
   *
   * The set of companies is resolved from the user's own memberships, never
   * from the request — a company the client names but the user is not a member
   * of simply does not appear.
   */
  async consolidated(
    userId: string,
    referenceDate: Date,
    displayCurrency: string,
  ): Promise<Result<ConsolidatedNetWorth>> {
    if (!this.crossCompany) {
      return Result.failed(
        DomainError.create(
          "INVALID_OPERATION",
          "Multi-company consolidation is not available",
        ),
      );
    }

    const perCompany = await this.crossCompany.netWorthByCompany(
      userId,
      referenceDate,
    );

    const companies: CompanyNetWorthLine[] = [];
    let total = Money.zero(displayCurrency);

    for (const entry of perCompany) {
      const converted = await this.convert(
        entry.companyId,
        entry.components,
        displayCurrency,
        referenceDate,
      );
      if (converted.isFailure || !converted.value) {
        return Result.failed(
          converted.error ??
            DomainError.create(
              "ENTITY_NOT_FOUND",
              `Could not convert the net worth of company ${entry.companyId}`,
            ),
        );
      }

      const totals = this.totals(converted.value, displayCurrency);

      companies.push({
        companyId: entry.companyId,
        companyName: entry.companyName,
        netWorth: totals.netWorth,
      });

      total = total.add(Money.create(totals.netWorth, displayCurrency));
    }

    return Result.success({
      referenceDate,
      displayCurrency,
      companies,
      total: total.amount,
    });
  }
}
