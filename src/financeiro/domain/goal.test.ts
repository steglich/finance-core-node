import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Goal, type CreateGoalInput, type GoalAccount } from "./goal.js";
import { Money } from "./money.js";

const brl = (value: number): Money => Money.create(value, "BRL");

const account: GoalAccount = {
  id: "account-1",
  companyId: "company-1",
  currency: "BRL",
  isActive: true,
};

const TODAY = new Date("2026-08-05T00:00:00Z");

function createGoal(overrides: Partial<CreateGoalInput> = {}): Goal {
  const result = Goal.create({
    companyId: "company-1",
    account,
    name: "Viagem",
    targetAmount: 15000,
    deadline: new Date("2027-12-31T00:00:00Z"),
    referenceDate: TODAY,
    ...overrides,
  });

  assert.ok(result.value);
  return result.value;
}

describe("Goal creation", () => {
  it("starts created, at zero, with 0% progress", () => {
    const goal = createGoal();

    assert.equal(goal.status, "CREATED");
    assert.equal(goal.currentAmount.amount, 0);
    assert.equal(goal.progress().value, 0);
    assert.equal(goal.currency, "BRL");
    assert.ok(
      goal.events.some((event) => event.getEventType() === "GoalCreated"),
    );
  });

  it("rejects a non-positive target", () => {
    const result = Goal.create({
      companyId: "company-1",
      account,
      name: "Viagem",
      targetAmount: 0,
      deadline: new Date("2027-12-31T00:00:00Z"),
      referenceDate: TODAY,
    });

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });

  it("rejects a deadline in the past", () => {
    const result = Goal.create({
      companyId: "company-1",
      account,
      name: "Viagem",
      targetAmount: 15000,
      deadline: new Date("2026-08-04T00:00:00Z"),
      referenceDate: TODAY,
    });

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });

  it("rejects an inactive account", () => {
    const result = Goal.create({
      companyId: "company-1",
      account: { ...account, isActive: false },
      name: "Viagem",
      targetAmount: 15000,
      deadline: new Date("2027-12-31T00:00:00Z"),
      referenceDate: TODAY,
    });

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
  });

  it("rejects an account of another company", () => {
    const result = Goal.create({
      companyId: "company-1",
      account: { ...account, companyId: "company-2" },
      name: "Viagem",
      targetAmount: 15000,
      deadline: new Date("2027-12-31T00:00:00Z"),
      referenceDate: TODAY,
    });

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "UNAUTHORIZED_ACCESS");
  });
});

describe("Goal contributions", () => {
  it("moves the goal to in progress and publishes ContributionMade", () => {
    const goal = createGoal();
    goal.clearEvents();

    const result = goal.contribute(brl(1500));

    assert.ok(result.isSuccess);
    assert.equal(goal.status, "IN_PROGRESS");
    assert.equal(goal.currentAmount.amount, 1500);
    assert.equal(goal.progress().value, 10);
    assert.ok(
      goal.events.some(
        (event) => event.getEventType() === "ContributionMade",
      ),
    );
  });

  it("rejects a contribution that would pass the target", () => {
    const goal = createGoal();
    assert.ok(goal.contribute(brl(14000)).isSuccess);

    const result = goal.contribute(brl(2000));

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
    assert.equal(goal.currentAmount.amount, 14000);
  });

  it("rejects a non-positive contribution", () => {
    const goal = createGoal();

    assert.ok(goal.contribute(brl(0)).isFailure);
  });

  it("rejects a contribution in another currency", () => {
    const goal = createGoal();

    const result = goal.contribute(Money.create(100, "USD"));

    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
  });

  it("records the contribution as a child entity", () => {
    const goal = createGoal();

    const result = goal.contribute(brl(1500), new Date("2026-08-10T00:00:00Z"));

    assert.equal(result.value?.goalId, goal.id);
    assert.equal(result.value?.amount.amount, 1500);
    assert.equal(goal.contributionCount, 1);
  });
});

describe("Goal state machine", () => {
  it("reaches achieved at 100% and publishes GoalAchieved", () => {
    const goal = createGoal();
    assert.ok(goal.contribute(brl(14000)).isSuccess);
    goal.clearEvents();

    assert.ok(goal.contribute(brl(1000)).isSuccess);
    assert.equal(goal.status, "ACHIEVED");
    assert.equal(goal.progress().value, 100);

    const event = goal.events.find(
      (candidate) => candidate.getEventType() === "GoalAchieved",
    );
    assert.ok(event);
    assert.equal(
      (event as unknown as { contributionCount: number }).contributionCount,
      2,
    );
  });

  it("rejects contributing to an achieved goal", () => {
    const goal = createGoal({ targetAmount: 1000 });
    assert.ok(goal.contribute(brl(1000)).isSuccess);

    const result = goal.contribute(brl(1));
    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "INVALID_OPERATION");
  });

  it("cancels an open goal and stops accepting contributions", () => {
    const goal = createGoal();
    assert.ok(goal.contribute(brl(1500)).isSuccess);

    assert.ok(goal.cancel().isSuccess);
    assert.equal(goal.status, "CANCELLED");
    assert.ok(goal.contribute(brl(100)).isFailure);
  });

  it("never reopens a cancelled goal", () => {
    const goal = createGoal();
    assert.ok(goal.cancel().isSuccess);

    assert.ok(goal.cancel().isFailure);
    assert.ok(goal.edit({ name: "Outra" }).isFailure);
    assert.equal(goal.status, "CANCELLED");
  });

  it("refuses to cancel an achieved goal", () => {
    const goal = createGoal({ targetAmount: 1000 });
    assert.ok(goal.contribute(brl(1000)).isSuccess);

    assert.ok(goal.cancel().isFailure);
    assert.equal(goal.status, "ACHIEVED");
  });
});

describe("Goal editing", () => {
  it("updates name, target and deadline and recomputes the progress", () => {
    const goal = createGoal();
    assert.ok(goal.contribute(brl(1500)).isSuccess);

    const result = goal.edit({
      name: "Viagem Europa",
      targetAmount: 30000,
      deadline: new Date("2028-06-30T00:00:00Z"),
    });

    assert.ok(result.isSuccess);
    assert.equal(goal.name, "Viagem Europa");
    assert.equal(goal.targetAmount.amount, 30000);
    assert.equal(goal.progress().value, 5);
  });

  it("rejects a target below what has already been contributed", () => {
    const goal = createGoal();
    assert.ok(goal.contribute(brl(1500)).isSuccess);

    const result = goal.edit({ targetAmount: 1000 });
    assert.ok(result.isFailure);
    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
  });
});
