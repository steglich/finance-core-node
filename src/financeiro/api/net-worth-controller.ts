import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { NetWorthService } from "../domain/net-worth-service.js";
import {
  validateNetWorthEvolutionQuery,
  validateNetWorthQuery,
} from "./dtos.js";

/**
 * Net worth endpoints.
 *
 * The single-company readings take the company from the token; the
 * consolidation takes the **user** from it and resolves the companies from
 * their memberships, never from the request.
 */
export class NetWorthController {
  constructor(private readonly netWorthService: NetWorthService) {}

  /**
   * GET /api/v1/net-worth
   */
  async get(companyId: string, query: unknown): Promise<ControllerResult> {
    const validation = validateNetWorthQuery(query);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const input = validation.data;
    const displayCurrency = await this.netWorthService.resolveDisplayCurrency(
      companyId,
      input.displayCurrency,
    );

    const result = await this.netWorthService.netWorthAt(
      companyId,
      input.referenceDate,
      displayCurrency,
      input.accountIds,
    );

    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    return { statusCode: 200, body: result.value };
  }

  /**
   * GET /api/v1/net-worth/evolution
   */
  async evolution(
    companyId: string,
    query: unknown,
  ): Promise<ControllerResult> {
    const validation = validateNetWorthEvolutionQuery(query);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const input = validation.data;
    const displayCurrency = await this.netWorthService.resolveDisplayCurrency(
      companyId,
      input.displayCurrency,
    );

    const result = await this.netWorthService.evolution(
      companyId,
      input.start,
      input.end,
      displayCurrency,
    );

    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    return {
      statusCode: 200,
      body: {
        start: input.start,
        end: input.end,
        displayCurrency,
        points: result.value,
      },
    };
  }

  /**
   * GET /api/v1/net-worth/consolidated
   *
   * The only reading that crosses companies. It receives the authenticated
   * user's id and the company of the current context only to resolve the
   * default display currency — the set of companies comes from the user's
   * memberships, so a company named by the client but outside them cannot
   * appear in the result.
   */
  async consolidated(
    userId: string,
    companyId: string,
    query: unknown,
  ): Promise<ControllerResult> {
    const validation = validateNetWorthQuery(query);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const input = validation.data;
    const displayCurrency = await this.netWorthService.resolveDisplayCurrency(
      companyId,
      input.displayCurrency,
    );

    const result = await this.netWorthService.consolidated(
      userId,
      input.referenceDate,
      displayCurrency,
    );

    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    return { statusCode: 200, body: result.value };
  }

  private orGeneric(error: DomainError | undefined): DomainError {
    return (
      error ??
      DomainError.create("BUSINESS_RULE_VIOLATION", "Operation not allowed")
    );
  }
}
