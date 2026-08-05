import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Money } from "../../financeiro/domain/money.js";
import { Payable } from "./payable.js";
import type {
  PayableCategory,
  PayableSupplier,
  RegisterPayableInput,
} from "./payable.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const OTHER_COMPANY = "22222222-2222-2222-2222-222222222222";

const DUE_DATE = new Date("2026-08-20T00:00:00Z");
const AFTER_DUE = new Date("2026-08-25T00:00:00Z");

const brl = (amount: number): Money => Money.create(amount, "BRL");

function supplier(overrides: Partial<PayableSupplier> = {}): PayableSupplier {
  return {
    id: "person-1",
    companyId: COMPANY,
    isActive: true,
    hasRole: (role) => role === "SUPPLIER",
    ...overrides,
  };
}

function category(overrides: Partial<PayableCategory> = {}): PayableCategory {
  return {
    id: "category-1",
    companyId: COMPANY,
    type: "EXPENSE",
    ...overrides,
  };
}

function register(overrides: Partial<RegisterPayableInput> = {}): Payable {
  const result = Payable.register({
    companyId: COMPANY,
    supplier: supplier(),
    category: category(),
    amount: 1000,
    currency: "BRL",
    dueDate: DUE_DATE,
    ...overrides,
  });

  assert.equal(result.isSuccess, true, result.error?.message ?? "");
  return result.value!;
}

function overdue(): Payable {
  const payable = register();
  assert.equal(payable.markOverdue(AFTER_DUE).isSuccess, true);
  payable.clearEvents();
  return payable;
}

describe("Register payable", () => {
  it("starts PENDING and publishes PayableRegistered", () => {
    const payable = register();

    assert.equal(payable.status, "PENDING");
    assert.equal(payable.isOpen, true);
    assert.equal(payable.paidAt, undefined);
    assert.deepEqual(
      payable.events.map((event) => event.getEventType()),
      ["PayableRegistered"],
    );
  });

  it("accepts a due date already in the past", () => {
    const payable = register({ dueDate: new Date("2020-01-01T00:00:00Z") });

    assert.equal(payable.status, "PENDING");
  });

  it("rejects a non-positive amount", () => {
    const result = Payable.register({
      companyId: COMPANY,
      supplier: supplier(),
      category: category(),
      amount: 0,
      currency: "BRL",
      dueDate: DUE_DATE,
    });

    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });

  it("rejects a person who is not a supplier", () => {
    const result = Payable.register({
      companyId: COMPANY,
      supplier: supplier({ hasRole: () => false }),
      category: category(),
      amount: 1000,
      currency: "BRL",
      dueDate: DUE_DATE,
    });

    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
  });

  it("rejects an inactive supplier", () => {
    const result = Payable.register({
      companyId: COMPANY,
      supplier: supplier({ isActive: false }),
      category: category(),
      amount: 1000,
      currency: "BRL",
      dueDate: DUE_DATE,
    });

    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
  });

  it("rejects an income category", () => {
    const result = Payable.register({
      companyId: COMPANY,
      supplier: supplier(),
      category: category({ type: "INCOME" }),
      amount: 1000,
      currency: "BRL",
      dueDate: DUE_DATE,
    });

    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });

  it("rejects a supplier or a category of another company", () => {
    assert.equal(
      Payable.register({
        companyId: COMPANY,
        supplier: supplier({ companyId: OTHER_COMPANY }),
        category: category(),
        amount: 1000,
        currency: "BRL",
        dueDate: DUE_DATE,
      }).error?.code,
      "UNAUTHORIZED_ACCESS",
    );

    assert.equal(
      Payable.register({
        companyId: COMPANY,
        supplier: supplier(),
        category: category({ companyId: OTHER_COMPANY }),
        amount: 1000,
        currency: "BRL",
        dueDate: DUE_DATE,
      }).error?.code,
      "UNAUTHORIZED_ACCESS",
    );
  });

  it("keeps the optional fields it was given", () => {
    const payable = register({
      costCenterId: "cc-1",
      competenceDate: new Date("2026-07-31T00:00:00Z"),
      description: "Serviços de julho",
      documentNumber: "NF-123",
    });

    assert.equal(payable.costCenterId, "cc-1");
    assert.equal(payable.documentNumber, "NF-123");
    assert.equal(payable.description, "Serviços de julho");
  });
});

describe("Payable state machine", () => {
  it("moves PENDING to OVERDUE and publishes PayableOverdue with the delay", () => {
    const payable = register();

    assert.equal(payable.markOverdue(AFTER_DUE).isSuccess, true);
    assert.equal(payable.status, "OVERDUE");
    const event = payable.events.at(-1) as unknown as { daysLate: number };
    assert.equal(event.daysLate, 5);
  });

  it("refuses to mark overdue before the due date", () => {
    const payable = register();

    assert.equal(
      payable.markOverdue(new Date("2026-08-10T00:00:00Z")).error?.code,
      "INVALID_OPERATION",
    );
    assert.equal(payable.status, "PENDING");
  });

  it("is idempotent: a second overdue pass changes nothing and emits nothing", () => {
    const payable = overdue();

    assert.equal(payable.markOverdue(AFTER_DUE).isFailure, true);
    assert.equal(payable.status, "OVERDUE");
    assert.deepEqual(payable.events, []);
  });

  it("moves PENDING and OVERDUE to PAID", () => {
    const fromPending = register();
    assert.equal(fromPending.registerPayment(brl(1000), DUE_DATE).isSuccess, true);
    assert.equal(fromPending.status, "PAID");
    assert.equal(fromPending.paidAt?.getTime(), DUE_DATE.getTime());

    const fromOverdue = overdue();
    assert.equal(fromOverdue.registerPayment(brl(1000), AFTER_DUE).isSuccess, true);
    assert.equal(fromOverdue.status, "PAID");
  });

  it("moves PENDING and OVERDUE to CANCELLED", () => {
    const fromPending = register();
    assert.equal(fromPending.cancel("nota cancelada").isSuccess, true);
    assert.equal(fromPending.status, "CANCELLED");

    const fromOverdue = overdue();
    assert.equal(fromOverdue.cancel("acordo").isSuccess, true);
    assert.equal(fromOverdue.status, "CANCELLED");
  });

  it("refuses every transition out of PAID", () => {
    const payable = register();
    payable.registerPayment(brl(1000), DUE_DATE);
    payable.clearEvents();

    assert.equal(payable.cancel("erro").error?.code, "INVALID_OPERATION");
    assert.equal(payable.markOverdue(AFTER_DUE).error?.code, "INVALID_OPERATION");
    assert.equal(
      payable.registerPayment(brl(1000), DUE_DATE).error?.code,
      "INVALID_OPERATION",
    );
    assert.equal(payable.edit({ amount: 10 }).error?.code, "INVALID_OPERATION");
    assert.equal(payable.status, "PAID");
    assert.deepEqual(payable.events, []);
  });

  it("refuses every transition out of CANCELLED", () => {
    const payable = register();
    payable.cancel("nota cancelada");
    payable.clearEvents();

    assert.equal(
      payable.registerPayment(brl(1000), DUE_DATE).error?.code,
      "INVALID_OPERATION",
    );
    assert.equal(payable.markOverdue(AFTER_DUE).error?.code, "INVALID_OPERATION");
    assert.equal(payable.cancel("de novo").error?.code, "INVALID_OPERATION");
    assert.equal(payable.status, "CANCELLED");
    assert.deepEqual(payable.events, []);
  });
});

describe("Payable settlement", () => {
  it("rejects a partial payment", () => {
    const payable = register();

    const result = payable.registerPayment(brl(400), DUE_DATE);

    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
    assert.equal(payable.status, "PENDING");
  });

  it("rejects a payment above the amount owed", () => {
    assert.equal(
      register().registerPayment(brl(1500), DUE_DATE).error?.code,
      "BUSINESS_RULE_VIOLATION",
    );
  });

  it("rejects a currency that is not the payable's", () => {
    assert.equal(
      register().registerPayment(Money.create(1000, "USD"), DUE_DATE).error?.code,
      "BUSINESS_RULE_VIOLATION",
    );
  });

  it("does not accrue anything for lateness", () => {
    // Unlike a charge, a payable owes exactly its amount however late it is.
    const payable = overdue();

    assert.equal(payable.registerPayment(brl(1000), AFTER_DUE).isSuccess, true);
  });
});

describe("Payable cancellation", () => {
  it("requires a reason", () => {
    const payable = register();

    assert.equal(payable.cancel("  ").error?.code, "VALIDATION_ERROR");
    assert.equal(payable.status, "PENDING");
  });

  it("keeps the reason and publishes PayableCancelled", () => {
    const payable = register();
    payable.clearEvents();

    payable.cancel("nota cancelada");

    assert.equal(payable.cancelReason, "nota cancelada");
    assert.notEqual(payable.cancelledAt, undefined);
    assert.deepEqual(
      payable.events.map((event) => event.getEventType()),
      ["PayableCancelled"],
    );
  });
});

describe("Payable editing", () => {
  it("edits amount, due date, category, cost center and description while PENDING", () => {
    const payable = register();

    const result = payable.edit({
      amount: 1200,
      dueDate: AFTER_DUE,
      categoryId: "category-2",
      costCenterId: "cc-9",
      description: "Revisado",
    });

    assert.equal(result.isSuccess, true);
    assert.equal(payable.amount.amount, 1200);
    assert.equal(payable.dueDate.getTime(), AFTER_DUE.getTime());
    assert.equal(payable.categoryId, "category-2");
    assert.equal(payable.costCenterId, "cc-9");
    assert.equal(payable.description, "Revisado");
  });

  it("clears the cost center when null is passed", () => {
    const payable = register({ costCenterId: "cc-1" });

    payable.edit({ costCenterId: null });

    assert.equal(payable.costCenterId, undefined);
  });

  it("rejects an edit of an overdue payable", () => {
    assert.equal(
      overdue().edit({ amount: 1200 }).error?.code,
      "INVALID_OPERATION",
    );
  });

  it("rejects an invalid value and leaves the payable untouched", () => {
    const payable = register();

    assert.equal(payable.edit({ amount: 0 }).error?.code, "VALIDATION_ERROR");
    assert.equal(
      payable.edit({ categoryId: "  " }).error?.code,
      "VALIDATION_ERROR",
    );

    assert.equal(payable.amount.amount, 1000);
    assert.equal(payable.categoryId, "category-1");
  });
});
