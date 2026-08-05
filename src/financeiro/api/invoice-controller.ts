import type { ControllerResult } from "../../shared/api/controller-result.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { DomainEvent } from "../../shared/domain/domain-event.js";
import type { DomainEventBus } from "../../shared/domain/domain-event-bus.js";
import type { InvoiceClosingService } from "../domain/invoice-closing-service.js";
import type { InvoicePaymentService } from "../domain/invoice-payment-service.js";
import type { AccountRepository } from "../infrastructure/account-repository.js";
import type { CardRepository } from "../infrastructure/card-repository.js";
import type { InvoiceRepository } from "../infrastructure/invoice-repository.js";
import type { TransactionRepository } from "../infrastructure/transaction-repository.js";
import { validateInvoicePaymentRequest } from "./dtos.js";

/**
 * Invoice endpoints: consulting a card's invoices, closing a cycle manually and
 * paying an invoice.
 */
export class InvoiceController {
  constructor(
    private readonly invoiceRepository: InvoiceRepository,
    private readonly cardRepository: CardRepository,
    private readonly accountRepository: AccountRepository,
    private readonly transactionRepository: TransactionRepository,
    private readonly closingService: InvoiceClosingService,
    private readonly paymentService: InvoicePaymentService,
    private readonly eventBus: DomainEventBus,
  ) {}

  /**
   * GET /api/v1/cards/:cardId/invoices
   */
  async listByCard(
    companyId: string,
    cardId: string,
  ): Promise<ControllerResult> {
    const card = await this.cardRepository.findById(companyId, cardId);
    if (!card) {
      return { statusCode: 404, body: { error: "Card not found" } };
    }

    const invoices = await this.invoiceRepository.findByCard(companyId, cardId);

    return {
      statusCode: 200,
      body: { invoices: invoices.map((invoice) => invoice.toJSON()) },
    };
  }

  /**
   * GET /api/v1/invoices/:invoiceId — with the consolidated purchases and the
   * payments made.
   */
  async detail(
    companyId: string,
    invoiceId: string,
  ): Promise<ControllerResult> {
    const invoice = await this.invoiceRepository.findById(companyId, invoiceId);
    if (!invoice) {
      return { statusCode: 404, body: { error: "Invoice not found" } };
    }

    const [purchases, payments] = await Promise.all([
      this.transactionRepository.findMany(companyId, { invoiceId }),
      this.invoiceRepository.listPayments(companyId, invoiceId),
    ]);

    return {
      statusCode: 200,
      body: {
        ...(invoice.toJSON() as Record<string, unknown>),
        purchases: purchases.items.map((purchase) => purchase.toJSON()),
        payments,
      },
    };
  }

  /**
   * POST /api/v1/cards/:cardId/invoices/close — the manual counterpart of the
   * scheduler's closing pass.
   */
  async close(companyId: string, cardId: string): Promise<ControllerResult> {
    const card = await this.cardRepository.findById(companyId, cardId);
    if (!card) {
      return { statusCode: 404, body: { error: "Card not found" } };
    }

    const invoice = await this.invoiceRepository.findOpenByCard(
      companyId,
      cardId,
    );
    if (!invoice) {
      return {
        statusCode: 404,
        body: { error: "This card has no open invoice" },
      };
    }

    const { items } = await this.transactionRepository.findMany(companyId, {
      invoiceId: invoice.id,
      status: "CONFIRMED",
    });

    const result = this.closingService.close({
      invoice,
      purchases: items.map((purchase) => ({
        transactionId: purchase.id,
        netAmount: purchase.netAmount,
      })),
    });

    if (result.isFailure) {
      throw this.orGeneric(result.error);
    }

    await this.invoiceRepository.update(invoice);
    this.publish(invoice.events);
    invoice.clearEvents();

    return { statusCode: 200, body: invoice.toJSON() };
  }

  /**
   * POST /api/v1/invoices/:invoiceId/payments
   *
   * The expense transaction, the account debit, the payment record and the
   * invoice transition are written in a single database transaction.
   */
  async pay(
    companyId: string,
    invoiceId: string,
    body: unknown,
  ): Promise<ControllerResult> {
    const validation = validateInvoicePaymentRequest(body);
    if (!validation.success) {
      return { statusCode: 400, body: { error: validation.error.message } };
    }

    const input = validation.data;

    const invoice = await this.invoiceRepository.findById(companyId, invoiceId);
    if (!invoice) {
      return { statusCode: 404, body: { error: "Invoice not found" } };
    }

    const account = await this.accountRepository.findById(
      companyId,
      input.accountId,
    );
    if (!account) {
      return { statusCode: 404, body: { error: "Account not found" } };
    }

    const result = this.paymentService.pay({
      invoice,
      account,
      amount: input.amount,
      date: input.date ?? new Date(),
      categoryId: input.categoryId,
      description: input.description,
    });

    if (result.isFailure || !result.value) {
      throw this.orGeneric(result.error);
    }

    const { payment, paymentId, amount, paidAt, events } = result.value;

    await this.transactionRepository.runAtomic(async (executor) => {
      await this.transactionRepository.create(payment, executor);
      await this.accountRepository.applyMovement(
        companyId,
        {
          transactionId: payment.id,
          accountId: account.id,
          direction: "DEBIT",
          amount,
        },
        executor,
      );
      await this.invoiceRepository.update(invoice, executor);
      await this.invoiceRepository.registerPayment(
        {
          id: paymentId,
          invoiceId: invoice.id,
          transactionId: payment.id,
          accountId: account.id,
          amount: amount.toDecimalString(),
          paidAt,
        },
        executor,
      );
    });

    this.publish(events);
    payment.clearEvents();
    invoice.clearEvents();

    return {
      statusCode: 200,
      body: {
        ...(invoice.toJSON() as Record<string, unknown>),
        payment: payment.toJSON(),
      },
    };
  }

  private publish(events: readonly DomainEvent<string>[]): void {
    for (const event of events) {
      this.eventBus.publish(event);
    }
  }

  private orGeneric(error: DomainError | undefined): DomainError {
    return (
      error ??
      DomainError.create("BUSINESS_RULE_VIOLATION", "Operation not allowed")
    );
  }
}
