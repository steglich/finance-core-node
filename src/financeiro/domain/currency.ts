/**
 * Supported ISO 4217 currency codes.
 * The system must support at least 30 currencies (see spec: Multi-Currency Foundation).
 */
export const SUPPORTED_CURRENCIES = [
  "AED",
  "ARS",
  "AUD",
  "BOB",
  "BRL",
  "CAD",
  "CHF",
  "CLP",
  "CNY",
  "COP",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "JPY",
  "KRW",
  "MXN",
  "MYR",
  "NOK",
  "NZD",
  "PEN",
  "PHP",
  "PLN",
  "PYG",
  "RUB",
  "SAR",
  "SEK",
  "SGD",
  "THB",
  "TRY",
  "USD",
  "UYU",
  "ZAR",
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

const SUPPORTED_CURRENCY_SET: ReadonlySet<string> = new Set(
  SUPPORTED_CURRENCIES,
);

/**
 * Normalizes a currency code to its canonical (upper case, trimmed) form.
 */
export function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

/**
 * Checks whether a currency code is a supported ISO 4217 code.
 */
export function isSupportedCurrency(currency: string): currency is CurrencyCode {
  return SUPPORTED_CURRENCY_SET.has(normalizeCurrency(currency));
}
