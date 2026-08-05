import { DomainError } from "../../shared/domain/domain-error.js";
import { Result } from "../../shared/domain/result.js";
import { isSupportedCurrency, normalizeCurrency } from "./currency.js";
import { Money } from "./money.js";
import type { ExchangeRateRepository } from "../infrastructure/exchange-rate-repository.js";

/**
 * A resolved rate: the factor plus where it came from, so any converted figure
 * can be traced back to the rate and the date that produced it.
 */
export interface ResolvedRate {
  sourceCurrency: string;
  targetCurrency: string;
  rate: number;
  rateDate: Date;
  /** True when the factor is the reciprocal of a rate registered the other way. */
  inverted: boolean;
}

/**
 * Outcome of a conversion, carrying the original value alongside the converted
 * one — a report never presents a converted number without its rate.
 */
export interface ConversionResult {
  amount: Money;
  originalAmount: Money;
  originalCurrency: string;
  rate: number;
  rateDate: Date;
}

/**
 * Resolves exchange rates and converts monetary values.
 *
 * Reads rates through the repository, which scopes them to the company: the
 * rate that matters is the one the company actually used, not a global one.
 * When no rate exists the lookup fails explicitly — assuming 1 would produce a
 * wrong figure that looks right, which is the worst outcome for a financial
 * system (design, decision 9).
 */
export class ExchangeService {
  constructor(private readonly repository: ExchangeRateRepository) {}

  /**
   * The rate in force for the pair on `date`: the most recent registered rate
   * whose date is not later than it, falling back to the reciprocal of the
   * inverse pair so a user need not register both directions.
   */
  async rateFor(
    companyId: string,
    sourceCurrency: string,
    targetCurrency: string,
    date: Date,
  ): Promise<Result<ResolvedRate>> {
    const source = normalizeCurrency(sourceCurrency);
    const target = normalizeCurrency(targetCurrency);

    if (!isSupportedCurrency(source) || !isSupportedCurrency(target)) {
      return Result.failed(
        DomainError.create(
          "VALIDATION_ERROR",
          `Unsupported currency pair ${source}/${target}`,
        ),
      );
    }

    // Same currency needs no rate at all — not even a lookup.
    if (source === target) {
      return Result.success({
        sourceCurrency: source,
        targetCurrency: target,
        rate: 1,
        rateDate: date,
        inverted: false,
      });
    }

    const direct = await this.repository.findForDate(
      companyId,
      source,
      target,
      date,
    );
    if (direct) {
      return Result.success({
        sourceCurrency: source,
        targetCurrency: target,
        rate: direct.rate,
        rateDate: direct.rateDate,
        inverted: false,
      });
    }

    const inverse = await this.repository.findForDate(
      companyId,
      target,
      source,
      date,
    );
    if (inverse && inverse.rate !== 0) {
      return Result.success({
        sourceCurrency: source,
        targetCurrency: target,
        rate: 1 / inverse.rate,
        rateDate: inverse.rateDate,
        inverted: true,
      });
    }

    return Result.failed(
      DomainError.create(
        "ENTITY_NOT_FOUND",
        `No exchange rate available for ${source}/${target} on or before ${date.toISOString().slice(0, 10)}`,
        {
          sourceCurrency: source,
          targetCurrency: target,
          date: date.toISOString().slice(0, 10),
        },
      ),
    );
  }

  /**
   * Converts a value into `targetCurrency` using the rate in force on `date`,
   * rounding to cents through Money.
   */
  async convert(
    companyId: string,
    money: Money,
    targetCurrency: string,
    date: Date,
  ): Promise<Result<ConversionResult>> {
    const target = normalizeCurrency(targetCurrency);

    const resolved = await this.rateFor(
      companyId,
      money.currency,
      target,
      date,
    );
    if (resolved.isFailure || !resolved.value) {
      return Result.failed(
        resolved.error ??
          DomainError.create(
            "ENTITY_NOT_FOUND",
            "No exchange rate available for the conversion",
          ),
      );
    }

    const { rate, rateDate } = resolved.value;

    try {
      const converted =
        money.currency === target
          ? money
          : Money.fromCents(money.cents * rate, target);

      return Result.success({
        amount: converted,
        originalAmount: money,
        originalCurrency: money.currency,
        rate,
        rateDate,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return Result.failed(error);
      }
      throw error;
    }
  }
}
