import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import { Card } from "../domain/card.js";
import type { AccountRepository } from "../infrastructure/account-repository.js";
import type { CardRepository } from "../infrastructure/card-repository.js";
import type { InvoiceRepository } from "../infrastructure/invoice-repository.js";
import { validateCreateCardRequest, validateEditCardRequest } from "./dtos.js";

/**
 * Card endpoints. The available limit is always computed from the committed
 * amount — it is never read from a column (RN-02).
 */
export class CardController {
  constructor(
    private readonly cardRepository: CardRepository,
    private readonly accountRepository: AccountRepository,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly eventBus: DomainEventBus,
  ) {}

  /**
   * POST /api/v1/cards
   */
  async create(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateCreateCardRequest(body);
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

    const result = Card.create({
      companyId,
      account,
      name: input.name,
      type: input.type,
      brand: input.brand,
      bank: input.bank,
      limit: input.limit,
      closingDay: input.closingDay,
      dueDay: input.dueDay,
    });

    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    const card = result.value;
    await this.cardRepository.create(card);
    this.publish(card);

    return { statusCode: 201, body: await this.present(companyId, card) };
  }

  /**
   * GET /api/v1/cards
   */
  async list(
    companyId: string,
    includeInactive = false,
  ): Promise<ControllerResult> {
    const cards = await this.cardRepository.findByCompany(
      companyId,
      includeInactive,
    );

    const body = await Promise.all(
      cards.map((card) => this.present(companyId, card)),
    );

    return { statusCode: 200, body: { cards: body } };
  }

  /**
   * GET /api/v1/cards/:cardId
   */
  async detail(companyId: string, cardId: string): Promise<ControllerResult> {
    const card = await this.cardRepository.findById(companyId, cardId);
    if (!card) {
      return { statusCode: 404, body: { error: "Card not found" } };
    }

    return { statusCode: 200, body: await this.present(companyId, card) };
  }

  /**
   * PUT /api/v1/cards/:cardId
   */
  async edit(
    companyId: string,
    cardId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateEditCardRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const card = await this.cardRepository.findById(companyId, cardId);
    if (!card) {
      return { statusCode: 404, body: { error: "Card not found" } };
    }

    // The committed amount is what a limit reduction has to clear.
    const committed =
      card.type === "DEBIT"
        ? undefined
        : await this.cardRepository.committedAmount(companyId, cardId);

    const result = card.edit(validation.data, committed);
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.cardRepository.update(card);
    this.publish(card);

    return { statusCode: 200, body: await this.present(companyId, card) };
  }

  /**
   * DELETE /api/v1/cards/:cardId — deactivates; cards are never deleted.
   */
  async deactivate(
    companyId: string,
    cardId: string,
  ): Promise<ControllerResult> {
    const card = await this.cardRepository.findById(companyId, cardId);
    if (!card) {
      return { statusCode: 404, body: { error: "Card not found" } };
    }

    const [open, unpaid] = await Promise.all([
      this.invoiceRepository.countOpenByCard(companyId, cardId),
      this.invoiceRepository.countUnpaidByCard(companyId, cardId),
    ]);

    const result = card.deactivate(open, unpaid);
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.cardRepository.update(card);
    this.publish(card);

    return { statusCode: 200, body: card.toJSON() };
  }

  /**
   * Card as returned by the API: the stored fields plus the derived limit.
   */
  private async present(
    companyId: string,
    card: Card,
  ): Promise<Record<string, unknown>> {
    const base = card.toJSON() as Record<string, unknown>;

    if (card.type === "DEBIT") {
      return base;
    }

    const committed = await this.cardRepository.committedAmount(
      companyId,
      card.id,
    );
    const available = card.availableLimit(committed);

    return {
      ...base,
      committedAmount: committed.amount,
      availableLimit: available.value?.amount,
    };
  }

  private publish(card: Card): void {
    for (const event of card.events) {
      this.eventBus.publish(event);
    }
    card.clearEvents();
  }

  private orGeneric(error: DomainError | undefined): DomainError {
    return (
      error ??
      DomainError.create("BUSINESS_RULE_VIOLATION", "Operation not allowed")
    );
  }
}
