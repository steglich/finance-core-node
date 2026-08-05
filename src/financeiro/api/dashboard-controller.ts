import type { ControllerResult } from "../../shared/api/controller-result.js";
import type {
  ReportingRepository,
  ReportingScope,
} from "../infrastructure/reporting-repository.js";
import { validateDashboardQuery } from "./dtos.js";

/**
 * Dashboard endpoint: period indicators, spending by category, the twelve-month
 * evolution and the Phase 2 summaries.
 *
 * The company always comes from the authenticated context; anything the client
 * sends about tenancy is ignored.
 */
export class DashboardController {
  constructor(private readonly reporting: ReportingRepository) {}

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
    ] = await Promise.all([
      this.reporting.periodIndicators(scope),
      this.reporting.spendingByCategory(scope),
      this.reporting.monthlySeries(scope),
      this.reporting.budgetSummary(scope),
      this.reporting.goalSummary(companyId),
      this.reporting.cardSummary(companyId),
    ]);

    return {
      statusCode: 200,
      body: {
        period: { start: scope.start, end: scope.end },
        accountIds: scope.accountIds ?? null,
        indicators,
        spendingByCategory,
        monthlySeries,
        summaries: { budgets, goals, cards },
      },
    };
  }
}
