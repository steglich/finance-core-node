import { DomainEvent } from "../../shared/domain/domain-event.js";

/**
 * Raised when a rate is registered for a currency pair and date, including when
 * it replaces the rate previously registered for that same date.
 */
export class ExchangeRateRegistered extends DomainEvent<string> {
  constructor(
    aggregateId: string,
    readonly companyId: string,
    readonly sourceCurrency: string,
    readonly targetCurrency: string,
    readonly rate: number,
    readonly rateDate: Date,
    readonly source: string,
  ) {
    super(aggregateId);
  }

  getEventType(): string {
    return "ExchangeRateRegistered";
  }
}
