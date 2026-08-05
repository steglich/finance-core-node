import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Budget, type BudgetCategory } from "./budget.js";
import { BudgetService } from "./budget-service.js";
import { Category } from "./category.js";
import { CategoryHierarchy } from "./category-hierarchy.js";
import { Money } from "./money.js";

const brl = (value: number): Money => Money.create(value, "BRL");

const expenseCategory: BudgetCategory = {
  id: "category-food",
  companyId: "company-1",
  type: "EXPENSE",
};

function createBudget(planned = 800): Budget {
  const result = Budget.create({
    companyId: "company-1",
    category: expenseCategory,
    periodStart: new Date("2026-08-01T00:00:00Z"),
    periodEnd: new Date("2026-08-31T00:00:00Z"),
    plannedAmount: planned,
    currency: "BRL",
  });

  assert.ok(result.value);
  return result.value;
}

function category(id: string, parentId?: string): Category {
  const result = Category.create({
    id,
    companyId: "company-1",
    name: id,
    type: "EXPENSE",
    parentId,
  });

  assert.ok(result.value);
  return result.value;
}

describe("Budget creation", () => {
  it("starts with no progress and the full amount remaining", () => {
    const budget = createBudget();

    const progress = budget.progress(Money.zero("BRL"));
    assert.equal(progress.value?.percentUsed, 0);
    assert.equal(progress.value?.remaining.amount, 800);
    assert.ok(
      budget.events.some((event) => event.getEventType() === "BudgetCreated"),
    );
  });

  it("rejects a non-positive planned amount", () => {
    const result = Budget.create({
      companyId: "company-1",
      category: expenseCategory,
      periodStart: new Date("2026-08-01T00:00:00Z"),
      periodEnd: new Date("2026-08-31T00:00:00Z"),
      plannedAmount: 0,
      currency: "BRL",
    });

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });

  it("rejects an income category", () => {
    const result = Budget.create({
      companyId: "company-1",
      category: { ...expenseCategory, type: "INCOME" },
      periodStart: new Date("2026-08-01T00:00:00Z"),
      periodEnd: new Date("2026-08-31T00:00:00Z"),
      plannedAmount: 800,
      currency: "BRL",
    });

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });

  it("rejects a period whose start is later than its end", () => {
    const result = Budget.create({
      companyId: "company-1",
      category: expenseCategory,
      periodStart: new Date("2026-08-31T00:00:00Z"),
      periodEnd: new Date("2026-08-01T00:00:00Z"),
      plannedAmount: 800,
      currency: "BRL",
    });

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });
});

describe("Budget progress", () => {
  it("derives the percentage used and the remaining amount", () => {
    const budget = createBudget();

    const progress = budget.progress(brl(200));
    assert.equal(progress.value?.actualAmount.amount, 200);
    assert.equal(progress.value?.percentUsed, 25);
    assert.equal(progress.value?.remaining.amount, 600);
    assert.equal(progress.value?.exceeded, false);
  });

  it("reports more than 100% once the plan is passed", () => {
    const budget = createBudget();

    const progress = budget.progress(brl(850));
    assert.equal(progress.value?.percentUsed, 106.25);
    assert.equal(progress.value?.exceeded, true);
    assert.equal(progress.value?.remaining.amount, -50);
  });
});

describe("Budget exceeded alert", () => {
  it("publishes BudgetExceeded the first time the plan is passed", () => {
    const budget = createBudget();
    budget.clearEvents();

    assert.ok(budget.evaluate(brl(850)).isSuccess);
    assert.equal(budget.exceededNotified, true);
    assert.ok(
      budget.events.some((event) => event.getEventType() === "BudgetExceeded"),
    );
  });

  it("does not publish again while it stays over the limit", () => {
    const budget = createBudget();
    assert.ok(budget.evaluate(brl(850)).isSuccess);
    budget.clearEvents();

    assert.ok(budget.evaluate(brl(900)).isSuccess);
    assert.equal(budget.events.length, 0);
  });

  it("rearms when the budget falls back below 100% and fires again", () => {
    const budget = createBudget();
    assert.ok(budget.evaluate(brl(850)).isSuccess);
    budget.clearEvents();

    // A refund brings it back under the plan.
    assert.ok(budget.evaluate(brl(650)).isSuccess);
    assert.equal(budget.exceededNotified, false);
    assert.equal(budget.events.length, 0);

    assert.ok(budget.evaluate(brl(900)).isSuccess);
    assert.ok(
      budget.events.some((event) => event.getEventType() === "BudgetExceeded"),
    );
  });
});

describe("Budget period closing", () => {
  it("freezes the actual amount and publishes the variance", () => {
    const budget = createBudget();
    budget.clearEvents();

    const result = budget.closePeriod(
      brl(850),
      new Date("2026-09-01T00:00:00Z"),
    );

    assert.ok(result.isSuccess);
    assert.equal(budget.status, "CLOSED");
    assert.equal(budget.frozenActualAmount?.amount, 850);

    const event = budget.events.find(
      (candidate) => candidate.getEventType() === "BudgetPeriodClosed",
    );
    assert.ok(event);
    assert.equal(
      (event as unknown as { variance: Money }).variance.amount,
      -50,
    );
  });

  it("refuses to close before the period ends", () => {
    const budget = createBudget();

    const result = budget.closePeriod(
      brl(400),
      new Date("2026-08-15T00:00:00Z"),
    );

    assert.ok(result.isFailure);
    assert.equal(budget.status, "ACTIVE");
  });

  it("refuses to close twice — the scheduler can run again safely", () => {
    const budget = createBudget();
    assert.ok(
      budget.closePeriod(brl(850), new Date("2026-09-01T00:00:00Z")).isSuccess,
    );
    budget.clearEvents();

    assert.ok(
      budget.closePeriod(brl(850), new Date("2026-09-02T00:00:00Z")).isFailure,
    );
    assert.equal(budget.events.length, 0);
  });

  it("rejects editing a budget whose period is closed", () => {
    const budget = createBudget();
    assert.ok(
      budget.closePeriod(brl(850), new Date("2026-09-01T00:00:00Z")).isSuccess,
    );

    const result = budget.edit({ plannedAmount: 1000 });
    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "INVALID_OPERATION");
  });
});

describe("Budget management", () => {
  it("edits the planned amount and recomputes the progress", () => {
    const budget = createBudget();

    assert.ok(budget.edit({ plannedAmount: 1000 }).isSuccess);
    assert.equal(budget.plannedAmount.amount, 1000);
    assert.equal(budget.progress(brl(250)).value?.percentUsed, 25);
  });

  it("deactivates a budget and stops evaluating it", () => {
    const budget = createBudget();

    assert.ok(budget.deactivate().isSuccess);
    assert.equal(budget.status, "INACTIVE");
    assert.ok(budget.evaluate(brl(900)).isFailure);
  });
});

describe("BudgetService rollup", () => {
  const service = new BudgetService();
  const hierarchy = new CategoryHierarchy([
    category("category-food"),
    category("category-market", "category-food"),
    category("category-transport"),
  ]);

  it("counts the category and its descendants toward the budget", () => {
    assert.deepEqual(service.categoryScope(hierarchy, "category-food"), [
      "category-food",
      "category-market",
    ]);
  });

  it("routes subcategory spending to the parent budget", () => {
    const budget = createBudget();

    const affected = service.budgetsAffectedBy(
      [budget],
      hierarchy,
      "category-market",
    );

    assert.equal(affected.length, 1);
    assert.equal(affected[0]?.id, budget.id);
  });

  it("ignores budgets of unrelated categories", () => {
    const budget = createBudget();

    const affected = service.budgetsAffectedBy(
      [budget],
      hierarchy,
      "category-transport",
    );

    assert.equal(affected.length, 0);
  });
});

describe("Budget dimensions", () => {
  const period = {
    periodStart: new Date("2026-08-01T00:00:00Z"),
    periodEnd: new Date("2026-08-31T00:00:00Z"),
    plannedAmount: 800,
    currency: "BRL",
  };

  it("accepts a budget on a category alone", () => {
    const result = Budget.create({
      companyId: "company-1",
      category: expenseCategory,
      ...period,
    });

    assert.equal(result.isSuccess, true);
    assert.equal(result.value?.categoryId, "category-food");
    assert.equal(result.value?.costCenterId, undefined);
  });

  it("accepts a budget on a cost center alone", () => {
    const result = Budget.create({
      companyId: "company-1",
      costCenterId: "cc-marketing",
      ...period,
    });

    assert.equal(result.isSuccess, true, result.error?.message ?? "");
    assert.equal(result.value?.categoryId, undefined);
    assert.equal(result.value?.costCenterId, "cc-marketing");
  });

  it("accepts a budget carrying both dimensions", () => {
    const result = Budget.create({
      companyId: "company-1",
      category: expenseCategory,
      costCenterId: "cc-marketing",
      ...period,
    });

    assert.equal(result.isSuccess, true);
    assert.equal(result.value?.categoryId, "category-food");
    assert.equal(result.value?.costCenterId, "cc-marketing");
  });

  it("rejects a budget with no dimension at all", () => {
    const result = Budget.create({ companyId: "company-1", ...period });

    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });

  it("still rejects an income category and a category of another company", () => {
    assert.equal(
      Budget.create({
        companyId: "company-1",
        category: { ...expenseCategory, type: "INCOME" },
        ...period,
      }).error?.code,
      "VALIDATION_ERROR",
    );

    assert.equal(
      Budget.create({
        companyId: "company-1",
        category: { ...expenseCategory, companyId: "company-2" },
        ...period,
      }).error?.code,
      "UNAUTHORIZED_ACCESS",
    );
  });

  it("carries both dimensions on BudgetCreated", () => {
    const budget = Budget.create({
      companyId: "company-1",
      category: expenseCategory,
      costCenterId: "cc-marketing",
      ...period,
    }).value!;

    const event = budget.events.find(
      (raised) => raised.getEventType() === "BudgetCreated",
    ) as unknown as { categoryId?: string; costCenterId?: string };

    assert.equal(event.categoryId, "category-food");
    assert.equal(event.costCenterId, "cc-marketing");
  });

  it("exposes both dimensions on toJSON", () => {
    const budget = Budget.create({
      companyId: "company-1",
      costCenterId: "cc-marketing",
      ...period,
    }).value!;

    const json = budget.toJSON() as Record<string, unknown>;
    assert.equal(json.categoryId, undefined);
    assert.equal(json.costCenterId, "cc-marketing");
  });

  it("does not let a category-only transaction move a cost-center-only budget", () => {
    const service = new BudgetService();
    const hierarchy = new CategoryHierarchy([category("category-food")]);

    const costCenterBudget = Budget.create({
      companyId: "company-1",
      costCenterId: "cc-marketing",
      ...period,
    }).value!;
    const categoryBudget = Budget.create({
      companyId: "company-1",
      category: expenseCategory,
      ...period,
    }).value!;

    const affected = service.budgetsAffectedBy(
      [costCenterBudget, categoryBudget],
      hierarchy,
      "category-food",
    );

    assert.deepEqual(
      affected.map((budget) => budget.id),
      [categoryBudget.id],
    );
  });
});
