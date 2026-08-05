import Fastify, {
  type FastifyError,
  type FastifyInstance,
} from "fastify";
import type { DatabaseConnection } from "./shared/infrastructure/database-connection.js";
import { createDatabaseConnection } from "./shared/infrastructure/database-connection.js";
import { createLogger } from "./shared/infrastructure/logger.js";
import { DomainError } from "./shared/domain/domain-error.js";
import { toHttpStatusCode } from "./shared/api/controller-result.js";
import { KnexUserRepository } from "./identity/infrastructure/knex-user-repository.js";
import { KnexCompanyRepository } from "./identity/infrastructure/knex-company-repository.js";
import { KnexProfileRepository } from "./identity/infrastructure/knex-profile-repository.js";
import { createPasswordService } from "./identity/domain/password-service.js";
import { createJwtTokenService } from "./identity/infrastructure/jwt-token-service.js";
import { KnexCategoryRepository } from "./financeiro/infrastructure/knex-category-repository.js";
import { KnexWalletRepository } from "./financeiro/infrastructure/knex-wallet-repository.js";
import { KnexAccountRepository } from "./financeiro/infrastructure/knex-account-repository.js";
import { KnexTransactionRepository } from "./financeiro/infrastructure/knex-transaction-repository.js";
import { KnexInstallmentRepository } from "./financeiro/infrastructure/knex-installment-repository.js";
import { KnexRecurrenceRepository } from "./financeiro/infrastructure/knex-recurrence-repository.js";
import { TransferService } from "./financeiro/domain/transfer-service.js";
import { DomainEventBus } from "./shared/domain/domain-event-bus.js";
import { AccountController } from "./financeiro/api/account-controller.js";
import { CategoryController } from "./financeiro/api/category-controller.js";
import { TransactionController } from "./financeiro/api/transaction-controller.js";
import { InstallmentController } from "./financeiro/api/installment-controller.js";
import { TransferController } from "./financeiro/api/transfer-controller.js";
import { RecurrenceController } from "./financeiro/api/recurrence-controller.js";
import { AuthController } from "./identity/api/auth-controller.js";
import { CompanyController } from "./identity/api/company-controller.js";
import { ProfileController } from "./identity/api/profile-controller.js";
import {
  createAuthenticate,
  createRequirePermission,
} from "./identity/api/middlewares.js";
import {
  KnexAccessLogRepository,
  KnexAuditRepository,
  KnexDomainEventLogRepository,
} from "./auditoria/infrastructure/knex-audit-repository.js";
import { registerAuditHandlers } from "./auditoria/infrastructure/audit-event-handlers.js";
import { AuditController } from "./auditoria/api/audit-controller.js";
import { registerRoutes } from "./routes/index.js";

/**
 * HTTP application: composition root + Fastify instance.
 */
export class AppServer {
  private readonly logger = createLogger();
  private readonly app: FastifyInstance = Fastify({ logger: false });
  private database?: DatabaseConnection;
  private ready?: Promise<void>;

  /**
   * Wires dependencies and registers hooks and routes. Idempotent.
   */
  initialize(): Promise<void> {
    this.ready ??= this.build();
    return this.ready;
  }

  async start(port: number): Promise<void> {
    await this.initialize();
    await this.app.listen({ port, host: "0.0.0.0" });
    this.logger.info(`Server listening on http://localhost:${port}`);
  }

  /**
   * Closes the HTTP server and, through the onClose hook, the database pool.
   */
  async stop(): Promise<void> {
    await this.app.close();
  }

  /**
   * Exposes the Fastify instance (useful for injection in tests).
   */
  getInstance(): FastifyInstance {
    return this.app;
  }

  private async build(): Promise<void> {
    // Infrastructure — one connection pool for the whole process lifetime
    const database = createDatabaseConnection(this.logger);
    this.database = database;
    const knex = database.getKnex();

    // Repositories
    const userRepository = new KnexUserRepository(knex);
    const companyRepository = new KnexCompanyRepository(knex);
    const profileRepository = new KnexProfileRepository(knex);
    const categoryRepository = new KnexCategoryRepository(knex);
    const walletRepository = new KnexWalletRepository(knex);
    const accountRepository = new KnexAccountRepository(knex);
    const transactionRepository = new KnexTransactionRepository(knex);
    const installmentRepository = new KnexInstallmentRepository(knex);
    const recurrenceRepository = new KnexRecurrenceRepository(knex);
    const auditRepository = new KnexAuditRepository(knex);
    const eventLogRepository = new KnexDomainEventLogRepository(knex);
    const accessLogRepository = new KnexAccessLogRepository(knex);

    // Services
    const passwordService = createPasswordService();
    const jwtTokenService = createJwtTokenService();
    const transferService = new TransferService();
    const eventBus = new DomainEventBus();

    // Every Phase 1 domain event is mirrored into the audit trail (RN-09)
    registerAuditHandlers(
      eventBus,
      auditRepository,
      eventLogRepository,
      this.logger,
    );

    // Controllers
    const authController = new AuthController(
      userRepository,
      companyRepository,
      profileRepository,
      passwordService,
      jwtTokenService,
      categoryRepository,
      database,
      accessLogRepository,
    );
    const companyController = new CompanyController(
      companyRepository,
      userRepository,
      profileRepository,
    );
    const profileController = new ProfileController(profileRepository);
    const accountController = new AccountController(
      accountRepository,
      walletRepository,
    );
    const categoryController = new CategoryController(
      categoryRepository,
      transactionRepository,
    );
    const transactionController = new TransactionController(
      transactionRepository,
      accountRepository,
      categoryRepository,
      installmentRepository,
      eventBus,
    );
    const installmentController = new InstallmentController(
      installmentRepository,
      transactionRepository,
      accountRepository,
      eventBus,
    );
    const transferController = new TransferController(
      transactionRepository,
      accountRepository,
      transferService,
      eventBus,
    );
    const recurrenceController = new RecurrenceController(
      recurrenceRepository,
      accountRepository,
      eventBus,
    );

    const auditController = new AuditController(
      auditRepository,
      eventLogRepository,
      accessLogRepository,
    );

    const requirePermission = createRequirePermission({
      companyRepository,
      profileRepository,
    });

    this.registerHooks();

    await registerRoutes(this.app, {
      authController,
      companyController,
      profileController,
      accountController,
      categoryController,
      transactionController,
      installmentController,
      transferController,
      recurrenceController,
      auditController,
      requireAuditManage: requirePermission("audit", "MANAGE"),
      authenticate: createAuthenticate(jwtTokenService),
    });

    await this.app.ready();
  }

  private registerHooks(): void {
    // CORS for development
    this.app.addHook("onRequest", async (request, reply) => {
      reply.header("Access-Control-Allow-Origin", "*");
      reply.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (request.method === "OPTIONS") {
        return reply.code(204).send();
      }
      return undefined;
    });

    // Structured access log for every completed request
    this.app.addHook("onResponse", async (request, reply) => {
      this.logger.info("request", {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
        userId: request.authContext?.userId,
        companyId: request.authContext?.companyId,
        ip: request.ip,
      });
    });

    // Single translation point from errors to HTTP responses
    this.app.setErrorHandler<FastifyError>((error, _request, reply) => {
      if (error instanceof DomainError) {
        return reply
          .code(toHttpStatusCode(error.code))
          .send({ error: error.message });
      }

      // Fastify's own client errors (bad JSON, unsupported media type, ...)
      const statusCode = error.statusCode ?? 500;
      if (statusCode < 500) {
        return reply.code(statusCode).send({ error: error.message });
      }

      this.logger.error("Unhandled error", error);
      return reply.code(500).send({ error: "Internal server error" });
    });

    this.app.setNotFoundHandler((_request, reply) =>
      reply.code(404).send({ error: "Not found" }),
    );

    // The pool is released once, on shutdown — never per request
    this.app.addHook("onClose", async () => {
      await this.database?.close();
    });
  }
}
