import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { DatabaseConnection } from "./shared/infrastructure/database-connection.js";
import { createDatabaseConnection } from "./shared/infrastructure/database-connection.js";
import { createLogger } from "./shared/infrastructure/logger.js";
import type { UserRepository } from "./identity/infrastructure/user-repository.js";
import { KnexUserRepository } from "./identity/infrastructure/knex-user-repository.js";
import type { CompanyRepository } from "./identity/infrastructure/company-repository.js";
import { KnexCompanyRepository } from "./identity/infrastructure/knex-company-repository.js";
import type { ProfileRepository } from "./identity/infrastructure/profile-repository.js";
import { KnexProfileRepository } from "./identity/infrastructure/knex-profile-repository.js";
import type { PasswordService } from "./identity/domain/password-service.js";
import { createPasswordService } from "./identity/domain/password-service.js";
import type { JwtTokenService } from "./identity/infrastructure/jwt-token-service.js";
import { createJwtTokenService } from "./identity/infrastructure/jwt-token-service.js";
import type { CategoryRepository } from "./financeiro/infrastructure/category-repository.js";
import { KnexCategoryRepository } from "./financeiro/infrastructure/knex-category-repository.js";
import { AuthController } from "./identity/api/auth-controller.js";
import { CompanyController } from "./identity/api/company-controller.js";
import { ProfileController } from "./identity/api/profile-controller.js";
import { createRoutes, handleRoute } from "./routes/index.js";

export class AppServer {
  private readonly server;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private database!: DatabaseConnection;
  private readonly logger = createLogger();

  // Repositories
  private userRepository!: UserRepository;
  private companyRepository!: CompanyRepository;
  private profileRepository!: ProfileRepository;
  private categoryRepository!: CategoryRepository;

  // Services
  private passwordService!: PasswordService;
  private jwtTokenService!: JwtTokenService;

  // Controllers
  private authController!: AuthController;
  private companyController!: CompanyController;
  private profileController!: ProfileController;

  constructor() {
    this.server = createServer(this.handleRequest.bind(this));
  }

  start(port: number): void {
    this.initialize();
    this.server.listen(port, () => {
      console.log(`Server listening on http://localhost:${port}`);
    });
  }

  private initialize(): void {
    // Initialize database connection
    this.database = createDatabaseConnection(this.logger);

    // Initialize repositories
    const knex = this.database.getKnex();
    this.userRepository = new KnexUserRepository(knex);
    this.companyRepository = new KnexCompanyRepository(knex);
    this.profileRepository = new KnexProfileRepository(knex);
    this.categoryRepository = new KnexCategoryRepository(knex);

    // Initialize services
    this.passwordService = createPasswordService();
    this.jwtTokenService = createJwtTokenService();

    // Initialize controllers
    this.authController = new AuthController(
      this.userRepository,
      this.companyRepository,
      this.profileRepository,
      this.passwordService,
      this.jwtTokenService,
      this.categoryRepository,
      this.database,
    );

    this.companyController = new CompanyController(
      this.companyRepository,
      this.userRepository,
      this.profileRepository,
    );

    this.profileController = new ProfileController(this.profileRepository);
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // Set CORS headers for development
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const routes = createRoutes({
        authController: this.authController,
        companyController: this.companyController,
        profileController: this.profileController,
      });

      await handleRoute(req, res, routes);
    } catch (error) {
      this.logger.error("Unhandled error", error as Error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    } finally {
      await this.database.close();
    }
  }
}
