import { randomUUID } from "node:crypto";
import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEvent } from "../../shared/domain/domain-event.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import { isSupportedCurrency } from "../domain/currency.js";
import { ExchangeRateRegistered } from "../domain/exchange-rate-events.js";
import type { ExchangeRateRepository } from "../infrastructure/exchange-rate-repository.js";
import {
  validateExchangeRateListQuery,
  validateRegisterExchangeRateRequest,
} from "./dtos.js";

/**
 * Exchange rate endpoints. The company scope always comes from the token.
 */
export class ExchangeRateController {
  constructor(
    private readonly repository: ExchangeRateRepository,
    private readonly eventBus: DomainEventBus,
  ) {}

  /**
   * POST /api/v1/exchange-rates
   *
   * Registering a rate for a pair and date that already has one replaces it, so
   * a correction leaves exactly one rate in force for that day.
   */
  async register(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateRegisterExchangeRateRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const input = validation.data;

    if (!isSupportedCurrency(input.sourceCurrency)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Unsupported currency: ${input.sourceCurrency}`,
      );
    }

    if (!isSupportedCurrency(input.targetCurrency)) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        `Unsupported currency: ${input.targetCurrency}`,
      );
    }

    if (input.sourceCurrency === input.targetCurrency) {
      throw DomainError.create(
        "VALIDATION_ERROR",
        "An exchange rate requires two different currencies",
      );
    }

    const record = await this.repository.upsert({
      id: randomUUID(),
      companyId,
      sourceCurrency: input.sourceCurrency,
      targetCurrency: input.targetCurrency,
      rate: input.rate,
      rateDate: input.rateDate,
      source: input.source ?? "MANUAL",
    });

    this.publish([
      new ExchangeRateRegistered(
        record.id,
        companyId,
        record.sourceCurrency,
        record.targetCurrency,
        record.rate,
        record.rateDate,
        record.source,
      ),
    ]);

    return { statusCode: 201, body: record };
  }

  /**
   * GET /api/v1/exchange-rates
   */
  async list(companyId: string, query: unknown): Promise<ControllerResult> {
    const validation = validateExchangeRateListQuery(query);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const { items, total } = await this.repository.findByCompany(
      companyId,
      validation.data,
    );

    return { statusCode: 200, body: { exchangeRates: items, total } };
  }

  private publish(events: readonly DomainEvent<string>[]): void {
    for (const event of events) {
      this.eventBus.publish(event);
    }
  }
}
