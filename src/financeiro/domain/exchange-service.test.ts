import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { ExchangeService } from "./exchange-service.js";
import { Money } from "./money.js";
import type {
  ExchangeRateFilter,
  ExchangeRateRecord,
  ExchangeRateRepository,
} from "../infrastructure/exchange-rate-repository.js";

const COMPANY = "company-1";

/**
 * In-memory stand-in for the Knex repository, with the same replace-by-date
 * behaviour so the "corrected rate wins" scenario is actually exercised.
 */
class FakeExchangeRateRepository implements ExchangeRateRepository {
  private readonly rows: ExchangeRateRecord[] = [];

  async upsert(record: ExchangeRateRecord): Promise<ExchangeRateRecord> {
    const index = this.rows.findIndex(
      (row) =>
        row.companyId === record.companyId &&
        row.sourceCurrency === record.sourceCurrency &&
        row.targetCurrency === record.targetCurrency &&
        row.rateDate.getTime() === record.rateDate.getTime(),
    );
    if (index >= 0) {
      this.rows[index] = record;
    } else {
      this.rows.push(record);
    }
    return record;
  }

  async findForDate(
    companyId: string,
    sourceCurrency: string,
    targetCurrency: string,
    date: Date,
  ): Promise<ExchangeRateRecord | null> {
    const candidates = this.rows
      .filter(
        (row) =>
          row.companyId === companyId &&
          row.sourceCurrency === sourceCurrency &&
          row.targetCurrency === targetCurrency &&
          row.rateDate.getTime() <= date.getTime(),
      )
      .sort((a, b) => b.rateDate.getTime() - a.rateDate.getTime());

    return candidates[0] ?? null;
  }

  async findByCompany(
    companyId: string,
    filter: ExchangeRateFilter = {},
  ): Promise<{ items: ExchangeRateRecord[]; total: number }> {
    const items = this.rows
      .filter((row) => row.companyId === companyId)
      .filter(
        (row) =>
          !filter.sourceCurrency ||
          row.sourceCurrency === filter.sourceCurrency,
      )
      .sort((a, b) => b.rateDate.getTime() - a.rateDate.getTime());

    return { items, total: items.length };
  }
}

function rate(
  source: string,
  target: string,
  value: number,
  date: string,
): ExchangeRateRecord {
  return {
    id: randomUUID(),
    companyId: COMPANY,
    sourceCurrency: source,
    targetCurrency: target,
    rate: value,
    rateDate: new Date(date),
    source: "MANUAL",
  };
}

async function serviceWith(
  records: readonly ExchangeRateRecord[],
): Promise<ExchangeService> {
  const repository = new FakeExchangeRateRepository();
  for (const record of records) {
    await repository.upsert(record);
  }
  return new ExchangeService(repository);
}

describe("ExchangeService.rateFor", () => {
  it("uses the most recent rate not later than the reference date", async () => {
    const service = await serviceWith([
      rate("USD", "BRL", 5.2, "2026-07-15"),
      rate("USD", "BRL", 5.5, "2026-07-25"),
    ]);

    const result = await service.rateFor(
      COMPANY,
      "USD",
      "BRL",
      new Date("2026-07-20"),
    );

    assert.ok(result.value);
    assert.equal(result.value.rate, 5.2);
    assert.equal(
      result.value.rateDate.toISOString().slice(0, 10),
      "2026-07-15",
    );
  });

  it("falls back to the reciprocal of the inverse pair", async () => {
    const service = await serviceWith([rate("USD", "BRL", 5, "2026-07-15")]);

    const result = await service.rateFor(
      COMPANY,
      "BRL",
      "USD",
      new Date("2026-07-20"),
    );

    assert.ok(result.value);
    assert.equal(result.value.rate, 0.2);
    assert.equal(result.value.inverted, true);
  });

  it("fails explicitly when no rate exists for the pair and date", async () => {
    const service = await serviceWith([rate("USD", "BRL", 5.2, "2026-08-01")]);

    const result = await service.rateFor(
      COMPANY,
      "USD",
      "BRL",
      new Date("2026-07-20"),
    );

    assert.equal(result.isFailure, true);
    assert.match(result.error?.message ?? "", /USD\/BRL/);
    assert.match(result.error?.message ?? "", /2026-07-20/);
  });

  it("returns a factor of 1 for the same currency without any registered rate", async () => {
    const service = await serviceWith([]);

    const result = await service.rateFor(
      COMPANY,
      "BRL",
      "BRL",
      new Date("2026-07-20"),
    );

    assert.ok(result.value);
    assert.equal(result.value.rate, 1);
  });

  it("keeps only the corrected rate of a date", async () => {
    const service = await serviceWith([
      rate("USD", "BRL", 5.2, "2026-07-15"),
      rate("USD", "BRL", 5.35, "2026-07-15"),
    ]);

    const result = await service.rateFor(
      COMPANY,
      "USD",
      "BRL",
      new Date("2026-07-15"),
    );

    assert.ok(result.value);
    assert.equal(result.value.rate, 5.35);
  });

  it("does not see the rates of another company", async () => {
    const service = await serviceWith([rate("USD", "BRL", 5.2, "2026-07-15")]);

    const result = await service.rateFor(
      "company-2",
      "USD",
      "BRL",
      new Date("2026-07-20"),
    );

    assert.equal(result.isFailure, true);
  });
});

describe("ExchangeService.convert", () => {
  it("converts $50.00 to R$ 260,00 at a rate of 5,20 and reports the rate", async () => {
    const service = await serviceWith([rate("USD", "BRL", 5.2, "2026-07-15")]);

    const result = await service.convert(
      COMPANY,
      Money.create(50, "USD"),
      "BRL",
      new Date("2026-07-20"),
    );

    assert.ok(result.value);
    assert.equal(result.value.amount.amount, 260);
    assert.equal(result.value.amount.currency, "BRL");
    assert.equal(result.value.originalAmount.amount, 50);
    assert.equal(result.value.originalCurrency, "USD");
    assert.equal(result.value.rate, 5.2);
    assert.equal(
      result.value.rateDate.toISOString().slice(0, 10),
      "2026-07-15",
    );
  });

  it("rounds the converted value to cents", async () => {
    const service = await serviceWith([
      rate("USD", "BRL", 5.4321, "2026-07-15"),
    ]);

    const result = await service.convert(
      COMPANY,
      Money.create(10.11, "USD"),
      "BRL",
      new Date("2026-07-20"),
    );

    assert.ok(result.value);
    // 10.11 × 5.4321 = 54.9186... → R$ 54,92
    assert.equal(result.value.amount.amount, 54.92);
  });

  it("returns the original amount when source and target match", async () => {
    const service = await serviceWith([]);

    const result = await service.convert(
      COMPANY,
      Money.create(120.5, "BRL"),
      "BRL",
      new Date("2026-07-20"),
    );

    assert.ok(result.value);
    assert.equal(result.value.amount.amount, 120.5);
    assert.equal(result.value.rate, 1);
  });

  it("fails rather than assuming a rate of 1", async () => {
    const service = await serviceWith([]);

    const result = await service.convert(
      COMPANY,
      Money.create(50, "USD"),
      "BRL",
      new Date("2026-07-20"),
    );

    assert.equal(result.isFailure, true);
  });

  it("converts a past fact with the rate of that past date, not the latest one", async () => {
    const service = await serviceWith([
      rate("USD", "BRL", 5.2, "2026-07-15"),
      rate("USD", "BRL", 6.1, "2026-12-01"),
    ]);

    const july = await service.convert(
      COMPANY,
      Money.create(100, "USD"),
      "BRL",
      new Date("2026-07-31"),
    );

    assert.ok(july.value);
    assert.equal(july.value.amount.amount, 520);
  });
});
