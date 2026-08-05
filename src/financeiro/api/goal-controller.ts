import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import { Goal } from "../domain/goal.js";
import { Money } from "../domain/money.js";
import type { AccountRepository } from "../infrastructure/account-repository.js";
import type { GoalRepository } from "../infrastructure/goal-repository.js";
import {
  validateContributionRequest,
  validateCreateGoalRequest,
  validateEditGoalRequest,
} from "./dtos.js";

/**
 * Goal endpoints, including the contribution flow.
 */
export class GoalController {
  constructor(
    private readonly goalRepository: GoalRepository,
    private readonly accountRepository: AccountRepository,
    private readonly eventBus: DomainEventBus,
  ) {}

  /**
   * POST /api/v1/goals
   */
  async create(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateCreateGoalRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const input = validation.data;

    const account = await this.accountRepository.findById(
      companyId,
      input.accountId,
    );
    if (!account) {
      return { statusCode: 404, body: { error: "Account not found" } };
    }

    const result = Goal.create({
      companyId,
      account,
      name: input.name,
      targetAmount: input.targetAmount,
      deadline: input.deadline,
    });

    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    const goal = result.value;
    await this.goalRepository.create(goal);
    this.publish(goal);

    return { statusCode: 201, body: goal.toJSON() };
  }

  /**
   * GET /api/v1/goals
   */
  async list(companyId: string): Promise<ControllerResult> {
    const goals = await this.goalRepository.findByCompany(companyId);

    return {
      statusCode: 200,
      body: { goals: goals.map((goal) => goal.toJSON()) },
    };
  }

  /**
   * GET /api/v1/goals/:goalId — with the contribution history.
   */
  async detail(companyId: string, goalId: string): Promise<ControllerResult> {
    const goal = await this.goalRepository.findById(companyId, goalId);
    if (!goal) {
      return { statusCode: 404, body: { error: "Goal not found" } };
    }

    const contributions = await this.goalRepository.findContributions(
      companyId,
      goalId,
    );

    return {
      statusCode: 200,
      body: {
        ...(goal.toJSON() as Record<string, unknown>),
        contributions: contributions.map((entry) => entry.toJSON()),
      },
    };
  }

  /**
   * PUT /api/v1/goals/:goalId
   */
  async edit(
    companyId: string,
    goalId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateEditGoalRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const goal = await this.goalRepository.findById(companyId, goalId);
    if (!goal) {
      return { statusCode: 404, body: { error: "Goal not found" } };
    }

    const result = goal.edit(validation.data);
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.goalRepository.update(goal);

    return { statusCode: 200, body: goal.toJSON() };
  }

  /**
   * POST /api/v1/goals/:goalId/contributions
   */
  async contribute(
    companyId: string,
    goalId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateContributionRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const goal = await this.goalRepository.findById(companyId, goalId);
    if (!goal) {
      return { statusCode: 404, body: { error: "Goal not found" } };
    }

    let amount: Money;
    try {
      amount = Money.create(validation.data.amount, goal.currency);
    } catch (error) {
      if (error instanceof DomainError) {
        return { statusCode: 400, body: { error: error.message } };
      }
      throw error;
    }

    const result = goal.contribute(amount, validation.data.date ?? new Date());
    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    // The contribution row and the cached current amount move together.
    const contribution = result.value;
    await this.goalRepository.runAtomic(async (executor) => {
      await this.goalRepository.update(goal, executor);
      await this.goalRepository.addContribution(contribution, executor);
    });
    this.publish(goal);

    return {
      statusCode: 201,
      body: {
        ...(goal.toJSON() as Record<string, unknown>),
        contribution: result.value.toJSON(),
      },
    };
  }

  /**
   * POST /api/v1/goals/:goalId/cancel
   */
  async cancel(companyId: string, goalId: string): Promise<ControllerResult> {
    const goal = await this.goalRepository.findById(companyId, goalId);
    if (!goal) {
      return { statusCode: 404, body: { error: "Goal not found" } };
    }

    const result = goal.cancel();
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.goalRepository.update(goal);

    return { statusCode: 200, body: goal.toJSON() };
  }

  private publish(goal: Goal): void {
    for (const event of goal.events) {
      this.eventBus.publish(event);
    }
    goal.clearEvents();
  }

  private orGeneric(error: DomainError | undefined): DomainError {
    return (
      error ??
      DomainError.create("BUSINESS_RULE_VIOLATION", "Operation not allowed")
    );
  }
}
