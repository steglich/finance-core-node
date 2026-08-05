import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import { Recurrence } from "../domain/recurrence.js";
import type { AccountRepository } from "../infrastructure/account-repository.js";
import type { RecurrenceRepository } from "../infrastructure/recurrence-repository.js";
import {
  validateCreateRecurrenceRequest,
  validateUpdateRecurrenceRequest,
} from "./dtos.js";

/**
 * Recurrence endpoints. Generating the occurrences themselves is the
 * scheduler's job — these endpoints only manage the configuration.
 */
export class RecurrenceController {
  constructor(
    private readonly recurrenceRepository: RecurrenceRepository,
    private readonly accountRepository: AccountRepository,
    private readonly eventBus: DomainEventBus,
  ) {}

  /**
   * POST /api/v1/recurrences
   */
  async create(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateCreateRecurrenceRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const account = await this.accountRepository.findById(
      companyId,
      validation.data.accountId,
    );
    if (!account) {
      return { statusCode: 404, body: { error: "Account not found" } };
    }

    const result = Recurrence.create({
      companyId,
      ...validation.data,
      currency: validation.data.currency || account.currency,
    });

    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    await this.recurrenceRepository.create(result.value);
    this.publish(result.value);

    return { statusCode: 201, body: result.value.toJSON() };
  }

  /**
   * GET /api/v1/recurrences
   */
  async list(companyId: string): Promise<ControllerResult> {
    const { items, total } = await this.recurrenceRepository.findMany(companyId);

    return {
      statusCode: 200,
      body: {
        recurrences: items.map((recurrence) => recurrence.toJSON()),
        total,
      },
    };
  }

  /**
   * PUT /api/v1/recurrences/:recurrenceId
   */
  async update(
    companyId: string,
    recurrenceId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateUpdateRecurrenceRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const recurrence = await this.recurrenceRepository.findById(
      companyId,
      recurrenceId,
    );
    if (!recurrence) {
      return { statusCode: 404, body: { error: "Recurrence not found" } };
    }

    const result = recurrence.edit(validation.data);
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.recurrenceRepository.update(recurrence);

    return { statusCode: 200, body: recurrence.toJSON() };
  }

  /**
   * POST /api/v1/recurrences/:recurrenceId/pause
   */
  async pause(
    companyId: string,
    recurrenceId: string,
  ): Promise<ControllerResult> {
    return this.changeState(companyId, recurrenceId, "pause");
  }

  /**
   * POST /api/v1/recurrences/:recurrenceId/resume
   */
  async resume(
    companyId: string,
    recurrenceId: string,
  ): Promise<ControllerResult> {
    return this.changeState(companyId, recurrenceId, "resume");
  }

  /**
   * POST /api/v1/recurrences/:recurrenceId/cancel — existing transactions stay.
   */
  async cancel(
    companyId: string,
    recurrenceId: string,
  ): Promise<ControllerResult> {
    return this.changeState(companyId, recurrenceId, "cancel");
  }

  private async changeState(
    companyId: string,
    recurrenceId: string,
    operation: "pause" | "resume" | "cancel",
  ): Promise<ControllerResult> {
    const recurrence = await this.recurrenceRepository.findById(
      companyId,
      recurrenceId,
    );
    if (!recurrence) {
      return { statusCode: 404, body: { error: "Recurrence not found" } };
    }

    const result = recurrence[operation]();
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.recurrenceRepository.update(recurrence);
    this.publish(recurrence);

    return { statusCode: 200, body: recurrence.toJSON() };
  }

  private publish(recurrence: Recurrence): void {
    for (const event of recurrence.events) {
      this.eventBus.publish(event);
    }
    recurrence.clearEvents();
  }

  private orGeneric(error: DomainError | undefined): DomainError {
    return (
      error ??
      DomainError.create("BUSINESS_RULE_VIOLATION", "Operation not allowed")
    );
  }
}
