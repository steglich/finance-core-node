import { randomUUID } from "node:crypto";
import type { CostCenterRepository } from "../../cadastros/infrastructure/cost-center-repository.js";
import type { PersonRepository } from "../../cadastros/infrastructure/person-repository.js";
import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import type { Account } from "../domain/account.js";
import type { Card } from "../domain/card.js";
import { ExchangeRate } from "../domain/exchange-rate.js";
import { Installment } from "../domain/installment.js";
import type { Invoice } from "../domain/invoice.js";
import { InvoiceAssignmentService } from "../domain/invoice-assignment-service.js";
import { Transaction } from "../domain/transaction.js";
import type { AccountRepository } from "../infrastructure/account-repository.js";
import type { CardRepository } from "../infrastructure/card-repository.js";
import type { CategoryRepository } from "../infrastructure/category-repository.js";
import type { InstallmentRepository } from "../infrastructure/installment-repository.js";
import type { InvoiceRepository } from "../infrastructure/invoice-repository.js";
import type { SettlementOriginChecker } from "../infrastructure/settlement-origin.js";
import { NO_SETTLEMENT_ORIGIN } from "../infrastructure/settlement-origin.js";
import type { TransactionRepository } from "../infrastructure/transaction-repository.js";
import {
  validateAttachmentRequest,
  validateCreateTransactionRequest,
  validateStateChangeRequest,
  validateTransactionQuery,
  validateUpdateTransactionRequest,
} from "./dtos.js";

/**
 * Transaction endpoints, including the parceled purchase flow and the state
 * transitions that move the account balance.
 */
export class TransactionController {
  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly accountRepository: AccountRepository,
    private readonly categoryRepository: CategoryRepository,
    private readonly installmentRepository: InstallmentRepository,
    private readonly cardRepository: CardRepository,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly eventBus: DomainEventBus,
    private readonly costCenterRepository?: CostCenterRepository,
    private readonly personRepository?: PersonRepository,
    private readonly settlementOrigin: SettlementOriginChecker = NO_SETTLEMENT_ORIGIN,
    private readonly invoiceAssignment: InvoiceAssignmentService = new InvoiceAssignmentService(),
  ) {}

  /**
   * Checks the Phase 3 classifications against the current company: the cost
   * center must exist and still be active, the person must exist. Returns the
   * error response to send, or undefined when both are fine.
   */
  private async validateDimensions(
    companyId: string,
    costCenterId: string | undefined,
    personId: string | undefined,
  ): Promise<ControllerResult | undefined> {
    if (costCenterId && this.costCenterRepository) {
      const costCenter = await this.costCenterRepository.findById(
        companyId,
        costCenterId,
      );
      if (!costCenter) {
        return { statusCode: 404, body: { error: "Cost center not found" } };
      }
      if (!costCenter.isActive) {
        return {
          statusCode: 400,
          body: { error: "Inactive cost centers cannot be selected" },
        };
      }
    }

    if (personId && this.personRepository) {
      const person = await this.personRepository.findById(companyId, personId);
      if (!person) {
        return { statusCode: 404, body: { error: "Person not found" } };
      }
    }

    return undefined;
  }

  /**
   * POST /api/v1/transactions — simple or parceled.
   */
  async create(companyId: string, body: unknown): Promise<ControllerResult> {
    const validation = validateCreateTransactionRequest(body);
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
    if (!account.isActive) {
      return {
        statusCode: 400,
        body: { error: "Inactive accounts do not accept new transactions" },
      };
    }

    if (input.categoryId) {
      const category = await this.categoryRepository.findById(
        companyId,
        input.categoryId,
      );
      if (!category) {
        return { statusCode: 404, body: { error: "Category not found" } };
      }
    }

    const dimensions = await this.validateDimensions(
      companyId,
      input.costCenterId,
      input.personId,
    );
    if (dimensions) {
      return dimensions;
    }

    const result = Transaction.create({
      companyId,
      accountId: input.accountId,
      categoryId: input.categoryId,
      costCenterId: input.costCenterId,
      personId: input.personId,
      type: input.type,
      grossAmount: input.grossAmount,
      discount: input.discount,
      interest: input.interest,
      penalty: input.penalty,
      currency: input.currency ?? account.currency,
      accountCurrency: account.currency,
      exchangeRate: this.toExchangeRate(input.exchangeRate),
      date: input.date,
      competence: input.competence,
      description: input.description,
      tags: input.tags,
      cardId: input.cardId,
    });

    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    const transaction = result.value;

    // A credit card purchase is bound to the invoice of its cycle and never
    // touches the account balance — the debit happens once, on payment (RN-08).
    const assignment = await this.assignToInvoice(companyId, transaction);
    if ("error" in assignment) {
      return assignment.error;
    }
    const { invoice, invoiceIsNew } = assignment;

    const installmentCount = input.installments ?? 1;

    if (installmentCount <= 1) {
      await this.transactionRepository.runAtomic(async (executor) => {
        if (invoice && invoiceIsNew) {
          await this.invoiceRepository.create(invoice, executor);
        }
        await this.transactionRepository.create(transaction, executor);
      });
      this.publish(transaction);

      return { statusCode: 201, body: transaction.toJSON() };
    }

    // Installments inherit the category and the account of the parent purchase.
    const installments = Installment.generate({
      companyId,
      parentTransactionId: transaction.id,
      accountId: transaction.accountId,
      categoryId: transaction.categoryId,
      total: transaction.netAmount,
      count: installmentCount,
      purchaseDate: transaction.date,
    });

    if (installments.isFailure || !installments.value) {
      throw this.orGeneric(installments.error);
    }

    // Parent and installments are written together or not at all.
    await this.transactionRepository.runAtomic(async (executor) => {
      if (invoice && invoiceIsNew) {
        await this.invoiceRepository.create(invoice, executor);
      }
      await this.transactionRepository.create(transaction, executor);
      await this.installmentRepository.createMany(
        installments.value ?? [],
        executor,
      );
    });
    this.publish(transaction);

    return {
      statusCode: 201,
      body: {
        ...(transaction.toJSON() as Record<string, unknown>),
        installments: installments.value.map((item) => item.toJSON()),
      },
    };
  }

  /**
   * GET /api/v1/transactions
   */
  async list(companyId: string, query: unknown): Promise<ControllerResult> {
    const validation = validateTransactionQuery(query);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const { items, total } = await this.transactionRepository.findMany(
      companyId,
      validation.data,
    );

    return {
      statusCode: 200,
      body: {
        transactions: items.map((transaction) => transaction.toJSON()),
        total,
      },
    };
  }

  /**
   * GET /api/v1/transactions/:transactionId
   */
  async detail(
    companyId: string,
    transactionId: string,
  ): Promise<ControllerResult> {
    const transaction = await this.transactionRepository.findById(
      companyId,
      transactionId,
    );
    if (!transaction) {
      return { statusCode: 404, body: { error: "Transaction not found" } };
    }

    const [installments, attachments] = await Promise.all([
      this.installmentRepository.findByParentTransactionId(
        companyId,
        transactionId,
      ),
      this.transactionRepository.listAttachments(companyId, transactionId),
    ]);

    return {
      statusCode: 200,
      body: {
        ...(transaction.toJSON() as Record<string, unknown>),
        installments: installments.map((installment) => installment.toJSON()),
        attachments,
      },
    };
  }

  /**
   * PUT /api/v1/transactions/:transactionId — pending transactions only.
   */
  async update(
    companyId: string,
    transactionId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateUpdateTransactionRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const transaction = await this.transactionRepository.findById(
      companyId,
      transactionId,
    );
    if (!transaction) {
      return { statusCode: 404, body: { error: "Transaction not found" } };
    }

    // A transaction produced by settling a charge or a payable is a record of
    // something already settled: editing it would contradict the obligation.
    if (await this.settlementOrigin.isFromSettlement(companyId, transactionId)) {
      return {
        statusCode: 400,
        body: {
          error:
            "Transactions created by a charge receipt or a payable settlement cannot be edited",
        },
      };
    }

    if (validation.data.categoryId) {
      const category = await this.categoryRepository.findById(
        companyId,
        validation.data.categoryId,
      );
      if (!category) {
        return { statusCode: 404, body: { error: "Category not found" } };
      }
    }

    const dimensions = await this.validateDimensions(
      companyId,
      validation.data.costCenterId ?? undefined,
      undefined,
    );
    if (dimensions) {
      return dimensions;
    }

    const result = transaction.edit(validation.data, {
      invoiceClosed: await this.isBilled(companyId, transaction),
    });
    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.transactionRepository.update(transaction);
    this.publish(transaction);

    return {
      statusCode: 200,
      body: {
        ...(transaction.toJSON() as Record<string, unknown>),
        changes: result.value ?? [],
      },
    };
  }

  /**
   * POST /api/v1/transactions/:transactionId/confirm — posts to the balance.
   */
  async confirm(
    companyId: string,
    transactionId: string,
  ): Promise<ControllerResult> {
    return this.changeState(companyId, transactionId, "confirm");
  }

  /**
   * POST /api/v1/transactions/:transactionId/cancel
   */
  async cancel(
    companyId: string,
    transactionId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateStateChangeRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    return this.changeState(
      companyId,
      transactionId,
      "cancel",
      validation.data.reason,
    );
  }

  /**
   * POST /api/v1/transactions/:transactionId/refund — reverts the balance.
   */
  async refund(
    companyId: string,
    transactionId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateStateChangeRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    return this.changeState(
      companyId,
      transactionId,
      "refund",
      validation.data.reason,
    );
  }

  /**
   * Runs a state transition and, when it moves money, applies the balance
   * change in the same database transaction as the status update.
   */
  private async changeState(
    companyId: string,
    transactionId: string,
    operation: "confirm" | "cancel" | "refund",
    reason?: string,
  ): Promise<ControllerResult> {
    const transaction = await this.transactionRepository.findById(
      companyId,
      transactionId,
    );
    if (!transaction) {
      return { statusCode: 404, body: { error: "Transaction not found" } };
    }

    const account = await this.accountRepository.findById(
      companyId,
      transaction.accountId,
    );
    if (!account) {
      return { statusCode: 404, body: { error: "Account not found" } };
    }

    const invoiceClosed = await this.isBilled(companyId, transaction);

    const result =
      operation === "confirm"
        ? transaction.confirm()
        : operation === "cancel"
          ? transaction.cancel(reason, { invoiceClosed })
          : transaction.refund(reason);

    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    // Refunding a billed purchase does not move money: it reduces what the
    // (still unpaid) invoice is asking for.
    const invoice =
      operation === "refund" && invoiceClosed && transaction.invoiceId
        ? await this.invoiceRepository.findById(
            companyId,
            transaction.invoiceId,
          )
        : null;

    if (invoice) {
      const adjusted = invoice.adjustForRefund(transaction.netAmount);
      if (adjusted.isFailure) {
        throw this.orGeneric(adjusted.error);
      }
    }

    await this.transactionRepository.runAtomic(async (executor) => {
      await this.transactionRepository.update(transaction, executor);

      if (invoice) {
        await this.invoiceRepository.update(invoice, executor);
      }

      if (operation === "cancel") {
        return;
      }

      // A credit card purchase never touched the balance, so there is nothing
      // to post or to undo on the account (RN-08).
      if (!transaction.affectsAccountBalance) {
        return;
      }

      // Confirming applies the transaction direction; refunding applies the
      // opposite one, undoing the original movement.
      const direction = this.movementDirection(transaction, operation);

      await this.accountRepository.applyMovement(
        companyId,
        {
          transactionId: transaction.id,
          accountId: account.id,
          direction,
          amount: transaction.netAmount,
        },
        executor,
      );
    });

    this.publish(transaction);

    return { statusCode: 200, body: transaction.toJSON() };
  }


  /**
   * Validates the card of an expense and, for a credit card, binds the purchase
   * to the invoice of its cycle — opening that invoice when it does not exist.
   *
   * Returns the invoice to persist alongside the transaction, or the error
   * response when the card cannot take the charge.
   */
  private async assignToInvoice(
    companyId: string,
    transaction: Transaction,
  ): Promise<
    | { invoice?: Invoice; invoiceIsNew: boolean }
    | { error: ControllerResult }
  > {
    const cardId = transaction.cardId;
    if (!cardId) {
      return { invoiceIsNew: false };
    }

    const card = await this.cardRepository.findById(companyId, cardId);
    if (!card) {
      return { error: { statusCode: 404, body: { error: "Card not found" } } };
    }

    if (!card.isActive) {
      return {
        error: {
          statusCode: 400,
          body: { error: "Inactive cards do not accept new purchases" },
        },
      };
    }

    // A debit card charge behaves like any other expense: no invoice, and the
    // account balance moves on confirmation.
    if (!card.isCredit) {
      return { invoiceIsNew: false };
    }

    const affordable = await this.ensureCardLimit(companyId, card, transaction);
    if (affordable) {
      return { error: affordable };
    }

    const existing = await this.invoiceRepository.findByCard(companyId, card.id);
    const assigned = this.invoiceAssignment.assign({
      companyId,
      card,
      purchaseDate: transaction.date,
      existingInvoices: existing,
    });

    if (assigned.isFailure || !assigned.value) {
      throw this.orGeneric(assigned.error);
    }

    const linked = transaction.linkToInvoice(assigned.value.invoice.id);
    if (linked.isFailure) {
      throw this.orGeneric(linked.error);
    }

    return {
      invoice: assigned.value.invoice,
      invoiceIsNew: assigned.value.created,
    };
  }

  /**
   * Rejects a purchase that does not fit in the card's available limit.
   */
  private async ensureCardLimit(
    companyId: string,
    card: Card,
    transaction: Transaction,
  ): Promise<ControllerResult | undefined> {
    const committed = await this.cardRepository.committedAmount(
      companyId,
      card.id,
    );

    const affordable = card.canAfford(transaction.netAmount, committed);
    if (affordable.isFailure) {
      return {
        statusCode: 400,
        body: {
          error:
            affordable.error?.message ??
            "The purchase exceeds the card available limit",
        },
      };
    }

    return undefined;
  }

  /**
   * Whether the invoice a purchase belongs to has already closed, which freezes
   * the purchase against edits and cancellation.
   */
  private async isBilled(
    companyId: string,
    transaction: Transaction,
  ): Promise<boolean> {
    const invoiceId = transaction.invoiceId;
    if (!invoiceId) {
      return false;
    }

    const invoice = await this.invoiceRepository.findById(companyId, invoiceId);
    return invoice ? invoice.isBilled : false;
  }

  private movementDirection(
    transaction: Transaction,
    operation: "confirm" | "refund",
  ): "CREDIT" | "DEBIT" {
    const natural = transaction.direction;
    if (operation === "confirm") {
      return natural;
    }
    return natural === "CREDIT" ? "DEBIT" : "CREDIT";
  }

  /**
   * POST /api/v1/transactions/:transactionId/attachments
   *
   * The API stores attachment metadata plus the location of the file; binary
   * upload needs a storage backend and a multipart parser, neither of which is
   * part of this phase.
   */
  async addAttachment(
    companyId: string,
    transactionId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateAttachmentRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const transaction = await this.transactionRepository.findById(
      companyId,
      transactionId,
    );
    if (!transaction) {
      return { statusCode: 404, body: { error: "Transaction not found" } };
    }

    const attachment = await this.transactionRepository.addAttachment(
      companyId,
      { id: randomUUID(), transactionId, ...validation.data },
    );

    return { statusCode: 201, body: attachment };
  }

  /**
   * GET /api/v1/transactions/:transactionId/attachments/:attachmentId
   */
  async getAttachment(
    companyId: string,
    transactionId: string,
    attachmentId: string,
  ): Promise<ControllerResult> {
    const attachment = await this.transactionRepository.findAttachment(
      companyId,
      transactionId,
      attachmentId,
    );

    if (!attachment) {
      return { statusCode: 404, body: { error: "Attachment not found" } };
    }

    return { statusCode: 200, body: attachment };
  }

  private toExchangeRate(
    raw:
      | {
          sourceCurrency: string;
          targetCurrency: string;
          rate: number;
          date: Date;
        }
      | undefined,
  ): ExchangeRate | undefined {
    return raw
      ? new ExchangeRate(
          raw.sourceCurrency,
          raw.targetCurrency,
          raw.rate,
          raw.date,
        )
      : undefined;
  }

  /**
   * Publishes and clears the events accumulated by the aggregate.
   */
  private publish(aggregate: Transaction | Account): void {
    for (const event of aggregate.events) {
      this.eventBus.publish(event);
    }
    aggregate.clearEvents();
  }

  private orGeneric(error: DomainError | undefined): DomainError {
    return (
      error ??
      DomainError.create("BUSINESS_RULE_VIOLATION", "Operation not allowed")
    );
  }
}
