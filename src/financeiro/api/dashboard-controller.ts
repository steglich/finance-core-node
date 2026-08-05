import type { ControllerResult } from "../../shared/api/controller-result.js";
import type { NetWorthService } from "../domain/net-worth-service.js";
import type {
  ReportingRepository,
  ReportingScope,
} from "../infrastructure/reporting-repository.js";
import { validateDashboardQuery } from "./dtos.js";

/**
 * Dashboard endpoint: period indicators, spending by category, the twelve-month
 * evolution and the Phase 2 to 4 summaries.
 *
 * The company always comes from the authenticated context; anything the client
 * sends about tenancy is ignored.
 */
export class DashboardController {
  constructor(
    private readonly reporting: ReportingRepository,
    /**
     * Supplies the net worth as assets minus liabilities. Without it the
     * dashboard falls back to the reporting repository's own figure rather than
     * failing — but the wired application always provides it.
     */
    private readonly netWorthService?: NetWorthService,
  ) {}

  /**
   * GET /api/v1/dashboard
   */
  async overview(companyId: string, query: unknown): Promise<ControllerResult> {
    const validation = validateDashboardQuery(query);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const scope: ReportingScope = {
      companyId,
      start: validation.data.start,
      end: validation.data.end,
      accountIds: validation.data.accountIds,
      costCenterIds: validation.data.costCenterIds,
    };

    // Net worth, the investments summary and the debt summary ignore the cost
    // center filter: a balance, a position and a debt are not attributable to a
    // cost center.
    const unfiltered: ReportingScope = {
      companyId,
      start: scope.start,
      end: scope.end,
      accountIds: scope.accountIds,
    };

    // Several independent aggregations — running them in parallel is what keeps
    // the dashboard inside its response budget (RNF-PERF-002).
    const [
      indicators,
      spendingByCategory,
      monthlySeries,
      budgets,
      goals,
      cards,
      receivables,
      payables,
      investments,
      debt,
    ] = await Promise.all([
      // Income, expense and result narrow with the cost center filter; net
      // worth does not, because it sums balances and positions rather than the
      // period's transactions.
      this.reporting.periodIndicators(scope),
      this.reporting.spendingByCategory(scope),
      this.reporting.monthlySeries(scope),
      this.reporting.budgetSummary(scope),
      this.reporting.goalSummary(companyId),
      this.reporting.cardSummary(companyId),
      this.reporting.receivablesSummary(scope),
      this.reporting.payablesSummary(scope),
      this.reporting.investmentsSummary(unfiltered),
      this.reporting.debtSummary(unfiltered),
    ]);

    const displayCurrency = this.netWorthService
      ? await this.netWorthService.resolveDisplayCurrency(
          companyId,
          validation.data.displayCurrency,
        )
      : (validation.data.displayCurrency ?? indicators.currency);

    // Assets minus liabilities at the end of the period, converted component by
    // component with the rate in force on that date. A component with no rate
    // fails the reading rather than producing a partial total (Phase 4).
    let netWorth = indicators.netWorth;

    if (this.netWorthService) {
      const result = await this.netWorthService.netWorthAt(
        companyId,
        scope.end,
        displayCurrency,
        scope.accountIds,
      );

      if (result.isFailure || !result.value) {
        return {
          statusCode: 422,
          body: {
            error: result.error?.message ?? "Could not compute the net worth",
          },
        };
      }

      netWorth = result.value.netWorth;
    }

    return {
      statusCode: 200,
      body: {
        period: { start: scope.start, end: scope.end },
        accountIds: scope.accountIds ?? null,
        costCenterIds: scope.costCenterIds ?? null,
        displayCurrency,
        indicators: { ...indicators, netWorth, currency: displayCurrency },
        spendingByCategory,
        monthlySeries,
        summaries: {
          budgets,
          goals,
          cards,
          receivables,
          payables,
          investments,
          debt,
        },
      },
    };
  }
}
