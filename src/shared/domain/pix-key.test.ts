import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DomainError } from "./domain-error.js";
import { PixKey } from "./pix-key.js";

describe("PixKey", () => {
  it("accepts a CPF key and strips the mask", () => {
    const key = PixKey.create("529.982.247-25");
    assert.equal(key.type, "CPF");
    assert.equal(key.value, "52998224725");
  });

  it("accepts a CNPJ key and strips the mask", () => {
    const key = PixKey.create("11.222.333/0001-81");
    assert.equal(key.type, "CNPJ");
    assert.equal(key.value, "11222333000181");
  });

  it("accepts an email key and normalizes it", () => {
    const key = PixKey.create("  Financeiro@Empresa.COM  ");
    assert.equal(key.type, "EMAIL");
    assert.equal(key.value, "financeiro@empresa.com");
  });

  it("accepts a phone key with country code and strips the mask", () => {
    const key = PixKey.create("+55 (11) 99999-9999");
    assert.equal(key.type, "PHONE");
    assert.equal(key.value, "+5511999999999");
  });

  it("accepts a random key and lowercases it", () => {
    const key = PixKey.create("123E4567-E89B-42D3-A456-426614174000");
    assert.equal(key.type, "RANDOM");
    assert.equal(key.value, "123e4567-e89b-42d3-a456-426614174000");
  });

  it("reads an eleven digit number without country code as a CPF", () => {
    // A phone key is only recognized with its country code; without the `+`
    // the value is indistinguishable from a CPF and is validated as one.
    assert.equal(PixKey.create("529.982.247-25").type, "CPF");
    assert.throws(() => PixKey.create("11999999999"), DomainError);
  });

  it("rejects a document that fails its check digits", () => {
    assert.throws(() => PixKey.create("529.982.247-26"), DomainError);
    assert.throws(() => PixKey.create("11.222.333/0001-82"), DomainError);
  });

  it("rejects a malformed email", () => {
    assert.throws(() => PixKey.create("not-an-email@"), DomainError);
  });

  it("rejects a phone without a valid country code", () => {
    assert.throws(() => PixKey.create("+0119999"), DomainError);
  });

  it("rejects an empty key and anything that matches no format", () => {
    assert.throws(() => PixKey.create("   "), DomainError);
    assert.throws(() => PixKey.create("12345"), DomainError);
  });

  it("compares by type and normalized value", () => {
    assert.equal(
      PixKey.create("529.982.247-25").equals(PixKey.create("52998224725")),
      true,
    );
    assert.equal(
      PixKey.create("52998224725").equals(PixKey.create("11144477735")),
      false,
    );
  });

  it("serializes the value together with its inferred type", () => {
    assert.deepEqual(PixKey.create("52998224725").toJSON(), {
      value: "52998224725",
      type: "CPF",
    });
  });
});
