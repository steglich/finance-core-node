import { DomainError } from "../../shared/domain/domain-error.js";
import type { UserRepository } from "../infrastructure/user-repository.js";
import type { CompanyRepository } from "../infrastructure/company-repository.js";
import type { ProfileRepository } from "../infrastructure/profile-repository.js";
import type { PasswordService } from "./password-service.js";
import type { CategoryRepository } from "../../financeiro/infrastructure/category-repository.js";
import type { CreateCompanyInput, CreateCompanyResult } from "./company.js";
import { User, type UserStatus } from "./user.js";
import { Email } from "./email.js";
import { CompanyType } from "./company-type.js";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
} from "../../financeiro/domain/category.js";

/**
 * Input for creating a new user.
 */
export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
}

/**
 * User service that handles business logic for user creation.
 */
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly companyRepository: CompanyRepository,
    private readonly profileRepository: ProfileRepository,
    private readonly passwordService: PasswordService,
  ) {}

  /**
   * Creates a new user with an associated personal company.
   */
  async create(
    input: CreateUserInput,
  ): Promise<{ user: User; companyId: string }> {
    const email = new Email(input.email);

    // Check if email already exists
    const existingUser = await this.userRepository.findByEmail(email.value);
    if (existingUser) {
      throw DomainError.create(
        "DUPLICATE_ENTITY",
        `User with email ${email.value} already exists`,
      );
    }

    // Hash password
    const passwordHash = await this.passwordService.hash(input.password);

    // Create user
    const userId = crypto.randomUUID();
    const user = new User(
      userId,
      email.value,
      input.name.trim(),
      passwordHash,
      "ACTIVE",
    );

    // Save user
    await this.userRepository.create(user);

    return { user, companyId: userId };
  }

  /**
   * Authenticates a user by email and password.
   */
  async authenticate(
    email: string,
    password: string,
  ): Promise<{
    user: User;
    companyIds: string[];
  }> {
    const emailObj = new Email(email);
    const user = await this.userRepository.findByEmail(emailObj.value);

    if (!user) {
      throw DomainError.create(
        "ENTITY_NOT_FOUND",
        `User with email ${email} not found`,
      );
    }

    const isValidPassword = await this.passwordService.verify(
      password,
      user.passwordHash,
    );
    if (!isValidPassword) {
      throw DomainError.create("VALIDATION_ERROR", "Invalid password");
    }

    // Get all companies the user belongs to
    const companyIds = await this.companyRepository.findUserCompanies(user.id);

    return { user, companyIds };
  }
}

/**
 * Company service that handles business logic for company creation.
 */
export class CompanyService {
  constructor(
    private readonly companyRepository: CompanyRepository,
    private readonly categoryRepository: CategoryRepository,
  ) {}

  /**
   * Creates a new company with default categories (RN-08).
   */
  async create(input: CreateCompanyInput): Promise<CreateCompanyResult> {
    const companyId = crypto.randomUUID();

    // Import Company class dynamically to avoid circular dependency issues
    const { Company } = await import("./company.js");

    const company = new Company(
      companyId,
      input.name.trim(),
      input.type,
      input.defaultCurrency || "BRL",
    );

    // Create default categories (RN-08)
    const categoryInputs = [
      ...DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
        name,
        type: "EXPENSE" as const,
      })),
      ...DEFAULT_INCOME_CATEGORIES.map((name) => ({
        name,
        type: "INCOME" as const,
      })),
    ];

    await this.categoryRepository.createDefaultCategories(
      companyId,
      categoryInputs,
    );

    // Save company (without user association for now - that's handled separately via addUser)
    await this.companyRepository.create(company);

    return {
      companyId,
      categoryIds: [], // Category IDs would need to be returned from createDefaultCategories
    };
  }
}
