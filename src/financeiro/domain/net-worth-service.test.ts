import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { ExchangeService } from "./exchange-service.js";
import { NetWorthService } from "./net-worth-service.js";
import type {
  ExchangeRateFilter,
  ExchangeRateRecord,
  ExchangeRateRepository,
} from "../infrastructure/exchange-rate-repository.js";
import type {
  CompanyNetWorth,
  CrossCompanyReader,
  NetWorthComponentRow,
  NetWorthRepository,
} from "../infrastructure/net-worth-repository.js";

const COMPANY = "company-1";
const REFERENCE = new Date("2026-07-31T00:00:00Z");

class FakeExchangeRateRepository implements ExchangeRateRepository {
  constructor(private readonly rows: ExchangeRateRecord[] = []) {}

  async upsert(record: ExchangeRateRecord): Promise<ExchangeRateRecord> {
    this.rows.push(record);
    return record;
  }

  async findForDate(
    companyId: string,
    sourceCurrency: string,
    targetCurrency: string,
    date: Date,
  ): Promise<ExchangeRateRecord | null> {
    return (
      this.rows
        .filter(
          (row) =>
            row.companyId === companyId &&
            row.sourceCurrency === sourceCurrency &&
            row.targetCurrency === targetCurrency &&
            row.rateDate.getTime() <= date.getTime(),
        )
        .sort((a, b) => b.rateDate.getTime() - a.rateDate.getTime())[0] ?? null
    );
  }

  async findByCompany(
    companyId: string,
    _filter?: ExchangeRateFilter,
  ): Promise<{ items: ExchangeRateRecord[]; total: number }> {
    const items = this.rows.filter((row) => row.companyId === companyId);
    return { items, total: items.length };
  }
}

class FakeNetWorthRepository implements NetWorthRepository {
  constructor(
    private readonly byCompany: Record<string, NetWorthComponentRow[]>,
    private readonly currencies: Record<string, string> = {},
  ) {}

  async netWorthAt(
    companyId: string,
    _referenceDate: Date,
    _accountIds?: readonly string[],
  ): Promise<NetWorthComponentRow[]> {
    return this.byCompany[companyId] ?? [];
  }

  async defaultCurrency(companyId: string): Promise<string> {
    return this.currencies[companyId] ?? "BRL";
  }
}

class FakeCrossCompanyReader implements CrossCompanyReader {
  constructor(
    private readonly memberships: Record<string, CompanyNetWorth[]>,
  ) {}

  async netWorthByCompany(userId: string): Promise<CompanyNetWorth[]> {
    return this.memberships[userId] ?? [];
  }
}

function component(
  overrides: Partial<NetWorthComponentRow>,
): NetWorthComponentRow {
  return {
    component: "ACCOUNT_BALANCES",
    side: "ASSET",
    currency: "BRL",
    amount: 0,
    ...overrides,
  };
}

function usdToBrl(rate: number, companyId = COMPANY): ExchangeRateRecord {
  return {
    id: randomUUID(),
    companyId,
    sourceCurrency: "USD",
    targetCurrency: "BRL",
    rate,
    rateDate: new Date("2026-07-01T00:00:00Z"),
    source: "MANUAL",
  };
}

function serviceWith(
  components: Record<string, NetWorthComponentRow[]>,
  options: {
    rates?: ExchangeRateRecord[];
    currencies?: Record<string, string>;
    memberships?: Record<string, CompanyNetWorth[]>;
  } = {},
): NetWorthService {
  const exchange = new ExchangeService(
    new FakeExchangeRateRepository(options.rates ?? []),
  );
  const repository = new FakeNetWorthRepository(
    components,
    options.currencies ?? {},
  );
  const crossCompany = options.memberships
    ? new FakeCrossCompanyReader(options.memberships)
    : undefined;

  return new NetWorthService(repository, exchange, crossCompany);
}

describe("NetWorthService.netWorthAt", () => {
  it("breaks the figure down into assets, liabilities and net worth", async () => {
    const service = serviceWith({
      [COMPANY]: [
        component({ component: "ACCOUNT_BALANCES", amount: 20000 }),
        component({ component: "INVESTMENT_PORTFOLIO", amount: 30000 }),
        component({ component: "OPEN_RECEIVABLES", amount: 5000 }),
        component({
          component: "LOAN_BALANCES",
          side: "LIABILITY",
          amount: 10000,
        }),
        component({
          component: "OPEN_PAYABLES",
          side: "LIABILITY",
          amount: 3000,
        }),
      ],
    });

    const result = await service.netWorthAt(COMPANY, REFERENCE, "BRL");

    assert.ok(result.value, result.error?.message ?? "");
    assert.equal(result.value.totalAssets, 55000);
    assert.equal(result.value.totalLiabilities, 13000);
    assert.equal(result.value.netWorth, 42000);
    assert.equal(result.value.components.length, 5);
  });

  it("returns zeroed values for a company with no data", async () => {
    const service = serviceWith({ [COMPANY]: [] });

    const result = await service.netWorthAt(COMPANY, REFERENCE, "BRL");

    assert.ok(result.value);
    assert.equal(result.value.totalAssets, 0);
    assert.equal(result.value.totalLiabilities, 0);
    assert.equal(result.value.netWorth, 0);
  });

  it("converts a USD component at the rate of the reference date", async () => {
    const service = serviceWith(
      {
        [COMPANY]: [
          component({ amount: 10000, currency: "BRL" }),
          component({ amount: 1000, currency: "USD" }),
        ],
      },
      { rates: [usdToBrl(5.2)] },
    );

    const result = await service.netWorthAt(COMPANY, REFERENCE, "BRL");

    assert.ok(result.value, result.error?.message ?? "");
    assert.equal(result.value.totalAssets, 15200);
    assert.equal(result.value.netWorth, 15200);
  });

  it("reports the missing pair and date instead of a partial total", async () => {
    const service = serviceWith({
      [COMPANY]: [
        component({ amount: 10000, currency: "BRL" }),
        component({ amount: 1000, currency: "USD" }),
      ],
    });

    const result = await service.netWorthAt(COMPANY, REFERENCE, "BRL");

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /USD\/BRL/);
    assert.match(result.error?.message ?? "", /2026-07-31/);
  });

  it("reports every converted component with the rate that produced it", async () => {
    const service = serviceWith(
      { [COMPANY]: [component({ amount: 1000, currency: "USD" })] },
      { rates: [usdToBrl(5.2)] },
    );

    const result = await service.netWorthAt(COMPANY, REFERENCE, "BRL");

    assert.ok(result.value);
    const [line] = result.value.components;
    assert.ok(line);
    assert.equal(line.originalAmount, 1000);
    assert.equal(line.currency, "USD");
    assert.equal(line.amount, 5200);
    assert.equal(line.rate, 5.2);
    assert.equal(line.rateDate.toISOString().slice(0, 10), "2026-07-01");
  });
});

describe("NetWorthService.resolveDisplayCurrency", () => {
  it("falls back to the company's default currency", async () => {
    const service = serviceWith(
      { [COMPANY]: [] },
      { currencies: { [COMPANY]: "USD" } },
    );

    assert.equal(await service.resolveDisplayCurrency(COMPANY), "USD");
  });

  it("honours an explicitly requested currency", async () => {
    const service = serviceWith(
      { [COMPANY]: [] },
      { currencies: { [COMPANY]: "USD" } },
    );

    assert.equal(await service.resolveDisplayCurrency(COMPANY, "BRL"), "BRL");
  });
});

describe("NetWorthService.evolution", () => {
  it("returns one point per month end", async () => {
    const service = serviceWith({
      [COMPANY]: [component({ amount: 1000 })],
    });

    const result = await service.evolution(
      COMPANY,
      new Date("2026-01-15T00:00:00Z"),
      new Date("2026-12-20T00:00:00Z"),
      "BRL",
    );

    assert.ok(result.value, result.error?.message ?? "");
    assert.equal(result.value.length, 12);

    const first = result.value[0];
    const last = result.value[11];
    assert.ok(first);
    assert.ok(last);
    assert.equal(first.monthEnd.toISOString().slice(0, 10), "2026-01-31");
    assert.equal(last.monthEnd.toISOString().slice(0, 10), "2026-12-31");
    assert.equal(first.netWorth, 1000);
  });

  it("returns zeroed points for months with no data", async () => {
    const service = serviceWith({ [COMPANY]: [] });

    const result = await service.evolution(
      COMPANY,
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-03-31T00:00:00Z"),
      "BRL",
    );

    assert.ok(result.value);
    assert.equal(result.value.length, 3);
    assert.ok(result.value.every((point) => point.netWorth === 0));
  });
});

describe("NetWorthService.consolidated", () => {
  const memberships: Record<string, CompanyNetWorth[]> = {
    "user-1": [
      {
        companyId: "company-a",
        companyName: "Empresa A",
        components: [component({ amount: 50000 })],
      },
      {
        companyId: "company-b",
        companyName: "Empresa B",
        components: [component({ amount: 30000 })],
      },
      {
        companyId: "company-c",
        companyName: "Empresa C",
        components: [component({ amount: 20000 })],
      },
    ],
    "user-2": [
      {
        companyId: "company-a",
        companyName: "Empresa A",
        components: [component({ amount: 50000 })],
      },
    ],
  };

  it("consolidates three companies into R$ 100.000,00", async () => {
    const service = serviceWith({}, { memberships });

    const result = await service.consolidated("user-1", REFERENCE, "BRL");

    assert.ok(result.value, result.error?.message ?? "");
    assert.equal(result.value.companies.length, 3);
    assert.equal(result.value.total, 100000);
    assert.deepEqual(
      result.value.companies.map((line) => line.netWorth),
      [50000, 30000, 20000],
    );
  });

  it("returns a single line whose total equals it", async () => {
    const service = serviceWith({}, { memberships });

    const result = await service.consolidated("user-2", REFERENCE, "BRL");

    assert.ok(result.value);
    assert.equal(result.value.companies.length, 1);
    assert.equal(result.value.total, 50000);
  });

  it("includes only the companies the user belongs to", async () => {
    const service = serviceWith({}, { memberships });

    const result = await service.consolidated("user-2", REFERENCE, "BRL");

    assert.ok(result.value);
    assert.deepEqual(
      result.value.companies.map((line) => line.companyId),
      ["company-a"],
    );
  });

  it("converts each company's net worth before adding it", async () => {
    const service = serviceWith(
      {},
      {
        memberships: {
          "user-3": [
            {
              companyId: "company-a",
              companyName: "Empresa A",
              components: [component({ amount: 10000, currency: "BRL" })],
            },
            {
              companyId: "company-usd",
              companyName: "Empresa USD",
              components: [component({ amount: 1000, currency: "USD" })],
            },
          ],
        },
        rates: [usdToBrl(5.2, "company-usd")],
      },
    );

    const result = await service.consolidated("user-3", REFERENCE, "BRL");

    assert.ok(result.value, result.error?.message ?? "");
    assert.equal(result.value.total, 15200);
  });

  it("returns an empty consolidation for a user with no memberships", async () => {
    const service = serviceWith({}, { memberships });

    const result = await service.consolidated("user-unknown", REFERENCE, "BRL");

    assert.ok(result.value);
    assert.equal(result.value.companies.length, 0);
    assert.equal(result.value.total, 0);
  });
});
