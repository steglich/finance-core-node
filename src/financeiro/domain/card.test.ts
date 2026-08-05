import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Card, type CardAccount, type CreateCardInput } from "./card.js";
import { Money } from "./money.js";

const account: CardAccount = {
  id: "account-1",
  companyId: "company-1",
  currency: "BRL",
  isActive: true,
};

function createCard(overrides: Partial<CreateCardInput> = {}): Card {
  const result = Card.create({
    companyId: "company-1",
    account,
    name: "Nubank",
    type: "CREDIT",
    brand: "Visa",
    limit: 5000,
    closingDay: 3,
    dueDay: 10,
    ...overrides,
  });

  assert.ok(result.value);
  return result.value;
}

describe("Card creation", () => {
  it("creates a credit card with the full available limit", () => {
    const card = createCard();

    assert.equal(card.type, "CREDIT");
    assert.equal(card.limit?.amount, 5000);
    assert.equal(card.currency, "BRL");

    const available = card.availableLimit(Money.zero("BRL"));
    assert.equal(available.value?.amount, 5000);
    assert.ok(
      card.events.some((event) => event.getEventType() === "CardCreated"),
    );
  });

  it("rejects a card without a linked account", () => {
    const result = Card.create({
      companyId: "company-1",
      account: undefined as unknown as CardAccount,
      name: "Nubank",
      type: "CREDIT",
      brand: "Visa",
      limit: 5000,
      closingDay: 3,
      dueDay: 10,
    });

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });

  it("rejects an account of another company", () => {
    const result = Card.create({
      companyId: "company-1",
      account: { ...account, companyId: "company-2" },
      name: "Nubank",
      type: "CREDIT",
      brand: "Visa",
      limit: 5000,
      closingDay: 3,
      dueDay: 10,
    });

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "UNAUTHORIZED_ACCESS");
  });

  it("rejects a closing day outside 1..31", () => {
    for (const closingDay of [0, 32]) {
      const result = Card.create({
        companyId: "company-1",
        account,
        name: "Nubank",
        type: "CREDIT",
        brand: "Visa",
        limit: 5000,
        closingDay,
        dueDay: 10,
      });

      assert.ok(result.isFailure, `closingDay ${closingDay} should be rejected`);
      assert.equal(result.error?.code, "VALIDATION_ERROR");
    }
  });

  it("rejects a credit card with a zero limit", () => {
    const result = Card.create({
      companyId: "company-1",
      account,
      name: "Nubank",
      type: "CREDIT",
      brand: "Visa",
      limit: 0,
      closingDay: 3,
      dueDay: 10,
    });

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });

  it("creates a debit card without a limit", () => {
    const card = createCard({ type: "DEBIT", limit: undefined, closingDay: undefined, dueDay: undefined });

    assert.equal(card.limit, undefined);
    assert.ok(card.availableLimit(Money.zero("BRL")).isFailure);
  });
});

describe("Card available limit", () => {
  it("subtracts the committed amount", () => {
    const card = createCard();

    const available = card.availableLimit(Money.create(500, "BRL"));
    assert.equal(available.value?.amount, 4500);
  });

  it("rejects a purchase above the available limit", () => {
    const card = createCard();

    const result = card.canAfford(
      Money.create(600, "BRL"),
      Money.create(4500, "BRL"),
    );

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
  });

  it("rejects any purchase on an inactive card", () => {
    const card = createCard();
    assert.ok(card.deactivate(0, 0).isSuccess);

    const result = card.canAfford(
      Money.create(10, "BRL"),
      Money.zero("BRL"),
    );

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "INVALID_OPERATION");
  });
});

describe("Card edit", () => {
  it("increases the limit and raises CardLimitChanged", () => {
    const card = createCard();
    card.clearEvents();

    assert.ok(card.edit({ limit: 8000 }, Money.zero("BRL")).isSuccess);
    assert.equal(card.limit?.amount, 8000);
    assert.ok(
      card.events.some((event) => event.getEventType() === "CardLimitChanged"),
    );
  });

  it("rejects a limit below the committed amount", () => {
    const card = createCard();

    const result = card.edit({ limit: 1000 }, Money.create(3000, "BRL"));

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
    assert.equal(card.limit?.amount, 5000);
  });

  it("keeps the type immutable — there is no way to change it", () => {
    const card = createCard();

    // `type` is not part of EditCardInput: the compiler rejects it and the
    // entity exposes no setter, so the value survives any edit.
    assert.ok(card.edit({ name: "Nubank Ultravioleta" }).isSuccess);
    assert.equal(card.type, "CREDIT");
    assert.equal(card.accountId, "account-1");
  });

  it("applies a new closing day without touching already-open cycles", () => {
    const card = createCard();

    assert.ok(card.edit({ closingDay: 15 }).isSuccess);
    // Open invoices carry their own materialized closing date, so only cycles
    // opened from now on use the new day.
    assert.equal(card.closingDay, 15);
  });
});

describe("Card deactivation", () => {
  it("deactivates a settled card", () => {
    const card = createCard();

    assert.ok(card.deactivate(0, 0).isSuccess);
    assert.equal(card.isActive, false);
    assert.ok(
      card.events.some((event) => event.getEventType() === "CardDeactivated"),
    );
  });

  it("refuses to deactivate with an open invoice", () => {
    const card = createCard();

    const result = card.deactivate(1, 0);
    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
    assert.equal(card.isActive, true);
  });

  it("refuses to deactivate with an unpaid closed invoice", () => {
    const card = createCard();

    const result = card.deactivate(0, 1);
    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
  });
});
