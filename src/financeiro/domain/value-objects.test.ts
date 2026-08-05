import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Email } from "../../shared/domain/email.js";
import { Password } from "../../identity/domain/password.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { ExchangeRate } from "./exchange-rate.js";
import { Money } from "./money.js";
import { Percent } from "./percent.js";
import { Period } from "./period.js";

describe("Money", () => {
  it("adds and subtracts without floating point drift", () => {
    const total = Money.create(0.1, "BRL").add(Money.create(0.2, "BRL"));
    assert.equal(total.amount, 0.3);
    assert.equal(total.subtract(Money.create(0.3, "BRL")).cents, 0);
  });

  it("rejects amounts with more precision than the currency", () => {
    assert.throws(() => Money.create(1.005, "BRL"), DomainError);
  });

  it("rejects an unsupported currency", () => {
    assert.throws(() => Money.create(1, "XYZ"), DomainError);
  });

  it("refuses to mix currencies", () => {
    assert.throws(
      () => Money.create(1, "BRL").add(Money.create(1, "USD")),
      DomainError,
    );
  });

  it("rounds multiplication half away from zero", () => {
    assert.equal(Money.create(10, "BRL").multiply(0.125).amount, 1.25);
    assert.equal(Money.create(-0.05, "BRL").multiply(0.5).amount, -0.03);
  });

  it("serializes as a fixed-scale decimal string", () => {
    assert.equal(Money.create(1234.5, "BRL").toDecimalString(), "1234.50");
  });

  it("sums a list of amounts", () => {
    const sum = Money.sum("BRL", [
      Money.create(10, "BRL"),
      Money.create(0.55, "BRL"),
    ]);
    assert.equal(sum.amount, 10.55);
  });
});

describe("ExchangeRate", () => {
  const date = new Date("2024-08-01T00:00:00.000Z");

  it("converts from the source currency", () => {
    const rate = ExchangeRate.create("BRL", "USD", 0.2, date);
    assert.equal(rate.convert(Money.create(520, "BRL")).amount, 104);
  });

  it("rejects converting a currency it does not cover", () => {
    const rate = ExchangeRate.create("BRL", "USD", 0.2, date);
    assert.throws(() => rate.convert(Money.create(10, "USD")), DomainError);
  });

  it("inverts to the opposite direction", () => {
    const inverted = ExchangeRate.create("BRL", "USD", 0.2, date).invert();
    assert.equal(inverted.sourceCurrency, "USD");
    assert.equal(inverted.targetCurrency, "BRL");
    assert.equal(inverted.rate, 5);
  });

  it("rejects a non-positive rate", () => {
    assert.throws(() => ExchangeRate.create("BRL", "USD", 0, date), DomainError);
  });
});

describe("Period", () => {
  it("rejects an end date before the start date", () => {
    assert.throws(
      () => new Period(new Date("2024-08-10"), new Date("2024-08-01")),
      DomainError,
    );
  });

  it("counts both ends when measuring days", () => {
    const period = new Period(new Date("2024-08-01"), new Date("2024-08-03"));
    assert.equal(period.days, 3);
  });

  it("contains its boundaries", () => {
    const period = new Period(new Date("2024-08-01"), new Date("2024-08-03"));
    assert.ok(period.contains(new Date("2024-08-01")));
    assert.ok(period.contains(new Date("2024-08-03")));
    assert.ok(!period.contains(new Date("2024-08-04")));
  });
});

describe("Percent", () => {
  it("rejects values outside 0-100", () => {
    assert.throws(() => Percent.create(-1), DomainError);
    assert.throws(() => Percent.create(101), DomainError);
  });

  it("applies to a monetary amount", () => {
    assert.equal(Percent.create(10).applyTo(Money.create(200, "BRL")).amount, 20);
  });
});

describe("Email", () => {
  it("normalizes case and whitespace", () => {
    assert.equal(Email.create("  User@Example.COM ").value, "user@example.com");
  });

  it("rejects an invalid format", () => {
    assert.throws(() => Email.create("not-an-email"), DomainError);
  });
});

describe("Password", () => {
  it("accepts a password meeting every requirement", () => {
    assert.equal(Password.create("Str0ngPass").value, "Str0ngPass");
  });

  it("rejects passwords missing length, case or digits", () => {
    for (const invalid of ["Sh0rt", "alllowercase1", "ALLUPPERCASE1", "NoDigitsHere"]) {
      assert.throws(() => Password.create(invalid), DomainError);
    }
  });

  it("never exposes the value in JSON", () => {
    assert.equal(Password.create("Str0ngPass").toJSON(), undefined);
  });
});
