import type { ControllerResult } from "../../shared/api/controller-result.js";
import type {
  ReportingRepository,
  ReportingScope,
} from "../infrastructure/reporting-repository.js";
import type { NetWorthService } from "../domain/net-worth-service.js";
import {
  attachmentDisposition,
  toCsv,
  type CsvSection,
  type CsvTable,
} from "./csv.js";
import { validateReportQuery, type ReportType } from "./dtos.js";

/**
 * A report ready to be rendered as JSON or serialized as CSV. Both outputs come
 * from the same table, so the export can never drift from what is displayed.
 */
export interface RenderedReport {
  type: ReportType;
  period: { start: Date; end: Date };
  displayCurrency?: string | undefined;
  table: CsvTable;
}

/**
 * Report endpoints: one dispatch point per report type, plus CSV export.
 */
export class ReportController {
  constructor(
    private readonly reporting: ReportingRepository,
    /**
     * Only the Phase 4 net worth report needs it; without it that report is
     * unavailable rather than silently wrong.
     */
    private readonly netWorthService?: NetWorthService,
  ) {}

  /**
   * GET /api/v1/reports/:type
   */
  async generate(
    companyId: string,
    type: unknown,
    query: unknown,
  ): Promise<ControllerResult> {
    const report = await this.render(companyId, type, query);
    if ("error" in report) {
      return report.error;
    }

    return {
      statusCode: 200,
      body: {
        type: report.value.type,
        period: report.value.period,
        displayCurrency: report.value.displayCurrency,
        columns: report.value.table.columns,
        rows: report.value.table.rows,
        sections: report.value.table.sections ?? null,
      },
    };
  }

  /**
   * GET /api/v1/reports/:type/export — same rows and columns, as CSV.
   */
  async export(
    companyId: string,
    type: unknown,
    query: unknown,
  ): Promise<ControllerResult> {
    const report = await this.render(companyId, type, query);
    if ("error" in report) {
      return report.error;
    }

    const period = report.value.period.start.toISOString().slice(0, 10);

    return {
      statusCode: 200,
      body: toCsv(report.value.table),
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": attachmentDisposition(
          `${report.value.type}-${period}.csv`,
        ),
      },
    };
  }

  /**
   * Validates the request and dispatches to the query behind the report type.
   */
  private async render(
    companyId: string,
    type: unknown,
    query: unknown,
  ): Promise<{ value: RenderedReport } | { error: ControllerResult }> {
    const validation = validateReportQuery(type, query);
    if (!validation.success) {
      return {
        error: { statusCode: 400, body: { error: validation.error.message } },
      };
    }

    const scope: ReportingScope = {
      companyId,
      start: validation.data.start,
      end: validation.data.end,
      accountIds: validation.data.accountIds,
      costCenterIds: validation.data.costCenterIds,
      personId: validation.data.personId,
      categoryId: validation.data.categoryId,
      status: validation.data.status,
    };

    // The income tax report is defined over a calendar year; anything else is
    // a different question and is rejected rather than answered approximately.
    if (validation.data.type === "income-tax") {
      const year = scope.start.getUTCFullYear();
      const isCalendarYear =
        scope.start.getTime() === Date.UTC(year, 0, 1) &&
        scope.end.getTime() === Date.UTC(year, 11, 31) &&
        scope.end.getUTCFullYear() === year;

      if (!isCalendarYear) {
        return {
          error: {
            statusCode: 400,
            body: {
              error:
                "The income tax report covers a calendar year: inform 01/01 to 31/12 of a single year",
            },
          },
        };
      }
    }

    if (validation.data.type === "net-worth" && !this.netWorthService) {
      return {
        error: {
          statusCode: 501,
          body: { error: "The net worth report is not available" },
        },
      };
    }

    const displayCurrency = this.netWorthService
      ? await this.netWorthService.resolveDisplayCurrency(
          companyId,
          validation.data.displayCurrency,
        )
      : validation.data.displayCurrency;

    const table = await this.tableFor(
      validation.data.type,
      scope,
      validation.data.investmentType,
      displayCurrency,
    );

    if ("error" in table) {
      return table;
    }

    return {
      value: {
        type: validation.data.type,
        period: { start: scope.start, end: scope.end },
        displayCurrency,
        table: table.value,
      },
    };
  }

  private async tableFor(
    type: ReportType,
    scope: ReportingScope,
    investmentType?: string,
    displayCurrency?: string,
  ): Promise<{ value: CsvTable } | { error: ControllerResult }> {
    switch (type) {
      case "net-worth":
        return this.netWorthTable(scope, displayCurrency ?? "BRL");
      case "investments":
        return {
          value: await this.investmentsTable(scope, investmentType),
        };
      case "income-tax":
        return {
          value: await this.incomeTaxTable(scope),
        };
    }

    return { value: await this.legacyTableFor(type, scope) };
  }

  private async legacyTableFor(
    type: Exclude<ReportType, "net-worth" | "investments" | "income-tax">,
    scope: ReportingScope,
  ): Promise<CsvTable> {
    switch (type) {
      case "cash-flow":
        return this.cashFlowTable(scope);
      case "income-statement":
        return this.incomeStatementTable(scope);
      case "by-category":
        return this.categoryTable(scope);
      case "by-card":
        return this.spendingTable(
          "Cartão",
          await this.reporting.spendingByCard(scope),
        );
      case "by-account":
        return this.spendingTable(
          "Conta",
          await this.reporting.spendingByAccount(scope),
        );
      case "by-cost-center":
        return this.costCenterTable(scope);
      case "receivables":
        return this.receivablesTable(scope);
      case "payables":
        return this.payablesTable(scope);
    }
  }

  /**
   * Spending by cost center. Each line already carries its subtree, so the
   * "próprio" column is what distinguishes a parent's own spending from what
   * rolled up into it.
   */
  private async costCenterTable(scope: ReportingScope): Promise<CsvTable> {
    const rows = await this.reporting.spendingByCostCenter(scope);

    return {
      columns: [
        "Centro de custo",
        "Valor próprio",
        "Valor com filhos",
        "% do total",
      ],
      rows: rows.map((row) => [
        row.costCenterName,
        row.ownAmount,
        row.totalAmount,
        row.percent,
      ]),
    };
  }

  private async receivablesTable(scope: ReportingScope): Promise<CsvTable> {
    const rows = await this.reporting.receivables(scope, new Date());

    const totalFor = (statuses: readonly string[]): number =>
      Number(
        rows
          .filter((row) => statuses.includes(row.status))
          .reduce((sum, row) => sum + row.totalDue, 0)
          .toFixed(2),
      );

    const received = Number(
      rows.reduce((sum, row) => sum + row.settledAmount, 0).toFixed(2),
    );

    const blank = ["", "", "", "", "", ""];

    return {
      columns: [
        "Cliente",
        "Descrição",
        "Situação",
        "Vencimento",
        "Valor original",
        "Multa e juros",
        "Total devido",
      ],
      rows: [
        ...rows.map((row) => [
          row.personName,
          row.description ?? "",
          row.status,
          row.dueDate.toISOString().slice(0, 10),
          row.amount,
          row.charges,
          row.totalDue,
        ]),
        ["Total emitido", ...blank.slice(0, 5), totalFor(["ISSUED"])],
        ["Total vencido", ...blank.slice(0, 5), totalFor(["OVERDUE"])],
        ["Total recebido", ...blank.slice(0, 5), received],
      ],
    };
  }

  private async payablesTable(scope: ReportingScope): Promise<CsvTable> {
    const rows = await this.reporting.payables(scope);

    const totalFor = (statuses: readonly string[]): number =>
      Number(
        rows
          .filter((row) => statuses.includes(row.status))
          .reduce((sum, row) => sum + row.amount, 0)
          .toFixed(2),
      );

    const paid = Number(
      rows.reduce((sum, row) => sum + row.settledAmount, 0).toFixed(2),
    );

    const blank = ["", "", "", "", "", ""];

    return {
      columns: [
        "Fornecedor",
        "Descrição",
        "Situação",
        "Vencimento",
        "Categoria",
        "Centro de custo",
        "Valor",
      ],
      rows: [
        ...rows.map((row) => [
          row.personName,
          row.description ?? "",
          row.status,
          row.dueDate.toISOString().slice(0, 10),
          row.categoryId ?? "",
          row.costCenterId ?? "",
          row.amount,
        ]),
        ["Total pendente", ...blank.slice(0, 5), totalFor(["PENDING"])],
        ["Total vencido", ...blank.slice(0, 5), totalFor(["OVERDUE"])],
        ["Total pago", ...blank.slice(0, 5), paid],
      ],
    };
  }

  private async cashFlowTable(scope: ReportingScope): Promise<CsvTable> {
    const rows = await this.reporting.cashFlow(scope);

    const totals = rows.reduce(
      (accumulator, row) => ({
        inflow: accumulator.inflow + row.inflow,
        outflow: accumulator.outflow + row.outflow,
      }),
      { inflow: 0, outflow: 0 },
    );

    return {
      columns: ["Mês", "Entradas", "Saídas", "Resultado", "Saldo acumulado"],
      rows: [
        ...rows.map((row) => [
          row.month,
          row.inflow,
          row.outflow,
          row.result,
          row.accumulated,
        ]),
        // Closing line with the totals for the whole period.
        [
          "Total",
          Number(totals.inflow.toFixed(2)),
          Number(totals.outflow.toFixed(2)),
          Number((totals.inflow - totals.outflow).toFixed(2)),
          rows.at(-1)?.accumulated ?? 0,
        ],
      ],
    };
  }

  private async incomeStatementTable(
    scope: ReportingScope,
  ): Promise<CsvTable> {
    const rows = await this.reporting.incomeStatement(scope);

    const revenue = rows
      .filter((row) => row.group === "INCOME")
      .reduce((sum, row) => sum + row.amount, 0);
    const expenses = rows
      .filter((row) => row.group === "EXPENSE")
      .reduce((sum, row) => sum + row.amount, 0);

    return {
      columns: ["Grupo", "Categoria", "Valor"],
      rows: [
        ...rows.map((row) => [
          row.group === "INCOME" ? "Receita" : "Despesa",
          row.categoryName,
          row.amount,
        ]),
        ["Total", "Receitas", Number(revenue.toFixed(2))],
        ["Total", "Despesas", Number(expenses.toFixed(2))],
        ["Total", "Resultado", Number((revenue - expenses).toFixed(2))],
      ],
    };
  }

  private async categoryTable(scope: ReportingScope): Promise<CsvTable> {
    const rows = await this.reporting.spendingByCategory(scope);

    return {
      columns: ["Categoria", "Valor", "% do total"],
      rows: rows.map((row) => [row.categoryName, row.amount, row.percent]),
    };
  }

  private spendingTable(
    label: string,
    rows: readonly { dimensionName: string; amount: number; percent: number }[],
  ): CsvTable {
    return {
      columns: [label, "Valor", "% do total"],
      rows: rows.map((row) => [row.dimensionName, row.amount, row.percent]),
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Phase 4 reports                                                           */
  /* ------------------------------------------------------------------------ */

  /**
   * Net worth at the end of the period, broken into an asset block and a
   * liability block, plus the month-end evolution when the period spans more
   * than one month. Three sections, each with its own header in the CSV.
   */
  private async netWorthTable(
    scope: ReportingScope,
    displayCurrency: string,
  ): Promise<{ value: CsvTable } | { error: ControllerResult }> {
    const service = this.netWorthService;
    if (!service) {
      return {
        error: {
          statusCode: 501,
          body: { error: "The net worth report is not available" },
        },
      };
    }

    const result = await service.netWorthAt(
      scope.companyId,
      scope.end,
      displayCurrency,
      scope.accountIds,
    );

    if (result.isFailure || !result.value) {
      return {
        error: {
          statusCode: 422,
          body: {
            error:
              result.error?.message ?? "Could not produce the net worth report",
          },
        },
      };
    }

    const netWorth = result.value;

    const lineFor = (side: "ASSET" | "LIABILITY") =>
      netWorth.components
        .filter((component) => component.side === side)
        .map((component) => [
          component.component,
          component.currency,
          component.originalAmount,
          component.rate,
          component.rateDate.toISOString().slice(0, 10),
          component.amount,
        ]);

    const componentColumns = [
      "Componente",
      "Moeda de origem",
      "Valor original",
      "Taxa",
      "Data da taxa",
      `Valor (${displayCurrency})`,
    ];

    const sections: CsvSection[] = [
      {
        title: "Ativos",
        columns: componentColumns,
        rows: [
          ...lineFor("ASSET"),
          ["Total de ativos", "", "", "", "", netWorth.totalAssets],
        ],
      },
      {
        title: "Passivos",
        columns: componentColumns,
        rows: [
          ...lineFor("LIABILITY"),
          ["Total de passivos", "", "", "", "", netWorth.totalLiabilities],
        ],
      },
      {
        title: "Patrimônio líquido",
        columns: ["Data de referência", `Patrimônio líquido (${displayCurrency})`],
        rows: [[scope.end.toISOString().slice(0, 10), netWorth.netWorth]],
      },
    ];

    // A single-month period has nothing to evolve through.
    if (this.spansMoreThanOneMonth(scope)) {
      const evolution = await service.evolution(
        scope.companyId,
        scope.start,
        scope.end,
        displayCurrency,
      );

      if (evolution.isFailure || !evolution.value) {
        return {
          error: {
            statusCode: 422,
            body: {
              error:
                evolution.error?.message ??
                "Could not produce the net worth evolution",
            },
          },
        };
      }

      sections.push({
        title: "Evolução mensal",
        columns: ["Fim do mês", "Ativos", "Passivos", "Patrimônio líquido"],
        rows: evolution.value.map((point) => [
          point.monthEnd.toISOString().slice(0, 10),
          point.totalAssets,
          point.totalLiabilities,
          point.netWorth,
        ]),
      });
    }

    return {
      value: {
        columns: componentColumns,
        rows: sections.flatMap((section) => section.rows),
        sections,
      },
    };
  }

  private spansMoreThanOneMonth(scope: ReportingScope): boolean {
    return (
      scope.start.getUTCFullYear() !== scope.end.getUTCFullYear() ||
      scope.start.getUTCMonth() !== scope.end.getUTCMonth()
    );
  }

  /**
   * One line per investment at the end of the period, plus the totals and the
   * distribution by type. A line with no quote says so, so a flat profitability
   * is never mistaken for a real one.
   */
  private async investmentsTable(
    scope: ReportingScope,
    investmentType?: string,
  ): Promise<CsvTable> {
    const rows = await this.reporting.investmentsReport(scope, investmentType);

    const total = rows.reduce(
      (accumulator, row) => ({
        invested: accumulator.invested + row.investedAmount,
        current: accumulator.current + row.currentValue,
        unrealized: accumulator.unrealized + row.unrealizedResult,
        realized: accumulator.realized + row.realizedResultInPeriod,
        income: accumulator.income + row.incomeReceivedInPeriod,
      }),
      { invested: 0, current: 0, unrealized: 0, realized: 0, income: 0 },
    );

    const round = (value: number): number => Number(value.toFixed(2));

    // Recomputed over the filtered subset, not carried over from the whole
    // portfolio.
    const profitability =
      total.invested === 0
        ? 0
        : round(
            ((total.current + total.realized + total.income - total.invested) /
              total.invested) *
              100,
          );

    const byType = new Map<string, number>();
    for (const row of rows) {
      byType.set(
        row.investmentType,
        round((byType.get(row.investmentType) ?? 0) + row.currentValue),
      );
    }

    const positionColumns = [
      "Investimento",
      "Tipo",
      "Símbolo",
      "Quantidade",
      "Custo médio",
      "Valor investido",
      "Valor atual",
      "Resultado não realizado",
      "Resultado realizado no período",
      "Proventos no período",
      "Rentabilidade %",
      "Com cotação",
    ];

    const sections: CsvSection[] = [
      {
        title: "Posições",
        columns: positionColumns,
        rows: [
          ...rows.map((row) => [
            row.name,
            row.investmentType,
            row.symbol ?? "",
            row.quantity,
            row.averageCost,
            row.investedAmount,
            row.currentValue,
            row.unrealizedResult,
            row.realizedResultInPeriod,
            row.incomeReceivedInPeriod,
            row.profitabilityPercent,
            row.quoted ? "sim" : "não",
          ]),
          [
            "Total",
            "",
            "",
            "",
            "",
            round(total.invested),
            round(total.current),
            round(total.unrealized),
            round(total.realized),
            round(total.income),
            profitability,
            rows.every((row) => row.quoted) ? "sim" : "não",
          ],
        ],
      },
      {
        title: "Distribuição por tipo",
        columns: ["Tipo", "Valor atual", "% da carteira"],
        rows: [...byType.entries()].map(([type, value]) => [
          type,
          value,
          total.current === 0 ? 0 : round((value / total.current) * 100),
        ]),
      },
    ];

    return {
      columns: positionColumns,
      rows: sections.flatMap((section) => section.rows),
      sections,
    };
  }

  /**
   * Raw consolidated data for the annual filing.
   *
   * It computes no tax and produces no official layout — declared as such in
   * its own section, so the report cannot be mistaken for an assessment.
   */
  private async incomeTaxTable(scope: ReportingScope): Promise<CsvTable> {
    const year = scope.start.getUTCFullYear();
    const data = await this.reporting.incomeTaxData(scope.companyId, year);

    const sections: CsvSection[] = [
      {
        title: `Posições em 31/12/${year} e em 31/12/${year - 1}`,
        columns: [
          "Investimento",
          "Tipo",
          "Símbolo",
          "Moeda",
          `Quantidade em 31/12/${year}`,
          `Custo em 31/12/${year}`,
          `Quantidade em 31/12/${year - 1}`,
          `Custo em 31/12/${year - 1}`,
        ],
        rows: data.positions.map((position) => [
          position.name,
          position.investmentType,
          position.symbol ?? "",
          position.currency,
          position.quantityAtYearEnd,
          position.costAtYearEnd,
          position.quantityAtPreviousYearEnd,
          position.costAtPreviousYearEnd,
        ]),
      },
      {
        title: "Proventos recebidos no ano",
        columns: ["Investimento", "Tipo de provento", "Valor"],
        rows: data.incomeByInvestment.map((income) => [
          income.name,
          income.operationType,
          income.amount,
        ]),
      },
      {
        title: "Resultados realizados no ano",
        columns: ["Investimento", "Resultado"],
        rows: data.realizedResults.map((result) => [result.name, result.amount]),
      },
      {
        title: `Saldos de contas em 31/12/${year}`,
        columns: ["Conta", "Moeda", "Saldo"],
        rows: data.accountBalances.map((account) => [
          account.name,
          account.currency,
          account.balance,
        ]),
      },
      {
        title: `Saldo devedor de empréstimos em 31/12/${year}`,
        columns: ["Empréstimo", "Moeda", "Saldo devedor"],
        rows: data.loanBalances.map((loan) => [
          loan.description,
          loan.currency,
          loan.outstandingBalance,
        ]),
      },
      {
        title: "Observação",
        columns: ["Aviso"],
        rows: [
          [
            "Este relatório apresenta dados brutos para a declaração e não apura imposto devido.",
          ],
        ],
      },
    ];

    return {
      columns: sections[0]?.columns ?? [],
      rows: sections.flatMap((section) => section.rows),
      sections,
    };
  }
}
