import "dotenv/config";
import { randomUUID } from "node:crypto";
import { RecurrenceService } from "./financeiro/domain/recurrence-service.js";
import { Transaction } from "./financeiro/domain/transaction.js";
import { KnexAccountRepository } from "./financeiro/infrastructure/knex-account-repository.js";
import { KnexInstallmentRepository } from "./financeiro/infrastructure/knex-installment-repository.js";
import { KnexRecurrenceRepository } from "./financeiro/infrastructure/knex-recurrence-repository.js";
import { KnexTransactionRepository } from "./financeiro/infrastructure/knex-transaction-repository.js";
import { KnexInvoiceRepository } from "./financeiro/infrastructure/knex-invoice-repository.js";
import { KnexBudgetRepository } from "./financeiro/infrastructure/knex-budget-repository.js";
import { InvoiceClosingService } from "./financeiro/domain/invoice-closing-service.js";
import { KnexAuditRepository, KnexDomainEventLogRepository } from "./auditoria/infrastructure/knex-audit-repository.js";
import { registerAuditHandlers } from "./auditoria/infrastructure/audit-event-handlers.js";
import { DomainEventBus } from "./shared/domain/domain-event-bus.js";
import { createDatabaseConnection } from "./shared/infrastructure/database-connection.js";
import { createLogger } from "./shared/infrastructure/logger.js";

/**
 * Batch job that keeps time-driven state up to date:
 *
 * 1. generates the transactions due for every active recurrence;
 * 2. flags pending installments whose due date has passed;
 * 3. closes the invoices whose closing date has been reached;
 * 4. flags overdue invoices;
 * 5. closes the budget periods that have ended.
 *
 * Every pass is idempotent through the aggregates' own state machines: a second
 * run on the same day finds the state already advanced, fails harmlessly and
 * publishes nothing.
 *
 * Run it from cron (`node dist/scheduler.js`) — it processes one pass and exits.
 */
async function run(referenceDate: Date): Promise<void> {
  const logger = createLogger("scheduler");
  const database = createDatabaseConnection(logger);
  const knex = database.getKnex();

  const recurrenceRepository = new KnexRecurrenceRepository(knex);
  const transactionRepository = new KnexTransactionRepository(knex);
  const installmentRepository = new KnexInstallmentRepository(knex);
  const accountRepository = new KnexAccountRepository(knex);
  const invoiceRepository = new KnexInvoiceRepository(knex);
  const budgetRepository = new KnexBudgetRepository(knex);
  const auditRepository = new KnexAuditRepository(knex);
  const eventLogRepository = new KnexDomainEventLogRepository(knex);

  const eventBus = new DomainEventBus();
  registerAuditHandlers(eventBus, auditRepository, eventLogRepository, logger);

  const recurrenceService = new RecurrenceService();
  const invoiceClosingService = new InvoiceClosingService();

  try {
    let generated = 0;

    for (const recurrence of await recurrenceRepository.findActive()) {
      const account = await accountRepository.findById(
        recurrence.companyId,
        recurrence.accountId,
      );

      if (!account || !account.isActive) {
        logger.warn(
          `Skipping recurrence ${recurrence.id}: account unavailable`,
        );
        continue;
      }

      for (const occurrenceDate of recurrenceService.dueOccurrences(
        recurrence,
        referenceDate,
      )) {
        const transaction = Transaction.create({
          id: randomUUID(),
          companyId: recurrence.companyId,
          accountId: recurrence.accountId,
          categoryId: recurrence.categoryId,
          type: recurrence.type,
          grossAmount: recurrence.amount.amount,
          currency: recurrence.amount.currency,
          accountCurrency: account.currency,
          date: occurrenceDate,
          description: recurrence.description,
        });

        if (transaction.isFailure || !transaction.value) {
          logger.error(
            `Recurrence ${recurrence.id}: ${transaction.error?.message ?? "could not build transaction"}`,
          );
          break;
        }

        const registered = recurrence.registerOccurrence(
          occurrenceDate,
          transaction.value.id,
        );
        if (registered.isFailure) {
          break;
        }

        // The generated transaction and the updated counter move together, so a
        // crash can never duplicate or skip an occurrence.
        await transactionRepository.runAtomic(async (executor) => {
          await transactionRepository.create(transaction.value!, executor);
          await recurrenceRepository.update(recurrence, executor);
        });

        for (const event of [
          ...transaction.value.events,
          ...recurrence.events,
        ]) {
          eventBus.publish(event);
        }
        transaction.value.clearEvents();
        recurrence.clearEvents();

        generated += 1;
      }

      // An end date that has passed retires the recurrence for good.
      if (recurrence.isActive && recurrenceService.isExhausted(recurrence)) {
        const completed = recurrence.complete();
        if (completed.isSuccess) {
          await recurrenceRepository.update(recurrence);
          for (const event of recurrence.events) {
            eventBus.publish(event);
          }
          recurrence.clearEvents();
        }
      }
    }

    let overdue = 0;
    const companyIds = (await knex("companies").select("id")) as {
      id: string;
    }[];

    for (const { id: companyId } of companyIds) {
      const candidates = await installmentRepository.findOverdueCandidates(
        companyId,
        referenceDate,
      );

      for (const installment of candidates) {
        const result = installment.markOverdue(referenceDate);
        if (result.isFailure) {
          continue;
        }

        await installmentRepository.update(installment);
        for (const event of installment.events) {
          eventBus.publish(event);
        }
        installment.clearEvents();
        overdue += 1;
      }
    }

    // One database transaction per invoice: a failure on one must not abort the
    // rest of the batch.
    let closedInvoices = 0;

    for (const invoice of await invoiceRepository.findDueForClosing(
      referenceDate,
    )) {
      try {
        const purchases = await invoiceRepository.consolidatePurchases(
          invoice.companyId,
          invoice.id,
        );

        const result = invoiceClosingService.close({ invoice, purchases });

        if (result.isFailure) {
          continue;
        }

        await invoiceRepository.update(invoice);
        for (const event of invoice.events) {
          eventBus.publish(event);
        }
        invoice.clearEvents();
        closedInvoices += 1;
      } catch (error) {
        logger.error(
          `Failed to close invoice ${invoice.id}: ${String(error)}`,
        );
      }
    }

    let overdueInvoices = 0;

    for (const invoice of await invoiceRepository.findOverdue(referenceDate)) {
      const result = invoice.markOverdue(referenceDate);
      if (result.isFailure) {
        continue;
      }

      try {
        await invoiceRepository.update(invoice);
        for (const event of invoice.events) {
          eventBus.publish(event);
        }
        invoice.clearEvents();
        overdueInvoices += 1;
      } catch (error) {
        logger.error(
          `Failed to flag invoice ${invoice.id} as overdue: ${String(error)}`,
        );
      }
    }

    let closedBudgets = 0;

    for (const budget of await budgetRepository.findPeriodsToClose(
      referenceDate,
    )) {
      try {
        const actual = await budgetRepository.actualAmount(budget);
        const result = budget.closePeriod(actual, referenceDate);
        if (result.isFailure) {
          continue;
        }

        await budgetRepository.update(budget);
        for (const event of budget.events) {
          eventBus.publish(event);
        }
        budget.clearEvents();
        closedBudgets += 1;
      } catch (error) {
        logger.error(
          `Failed to close budget period ${budget.id}: ${String(error)}`,
        );
      }
    }

    logger.info("Scheduler pass complete", {
      generatedTransactions: generated,
      overdueInstallments: overdue,
      closedInvoices,
      overdueInvoices,
      closedBudgets,
    });
  } finally {
    await database.close();
  }
}

run(new Date()).catch((error: unknown) => {
  createLogger("scheduler").error("Scheduler failed", error as Error);
  process.exitCode = 1;
});
