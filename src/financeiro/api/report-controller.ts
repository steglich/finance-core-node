import type { ControllerResult } from "../../shared/api/controller-result.js";
import type {
  ReportingRepository,
  ReportingScope,
} from "../infrastructure/reporting-repository.js";
import { attachmentDisposition, toCsv, type CsvTable } from "./csv.js";
import { validateReportQuery, type ReportType } from "./dtos.js";

/**
 * A report ready to be rendered as JSON or serialized as CSV. Both outputs come
 * from the same table, so the export can never drift from what is displayed.
 */
export interface RenderedReport {
  type: ReportType;
  period: { start: Date; end: Date };
  table: CsvTable;
}

/**
 * Report endpoints: one dispatch point per report type, plus CSV export.
 */
export class ReportController {
  constructor(private readonly reporting: ReportingRepository) {}

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
        columns: report.value.table.columns,
        rows: report.value.table.rows,
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

    const table = await this.tableFor(validation.data.type, scope);

    return {
      value: {
        type: validation.data.type,
        period: { start: scope.start, end: scope.end },
        table,
      },
    };
  }

  private async tableFor(
    type: ReportType,
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
}
