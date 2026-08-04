// Value Objects
export { Email } from "./email.js";
// Note: CompanyTypeValue is exported from company.ts (for Company entity) and BrazilianCompanyType from company-type.ts
export type { CompanyTypeValue as BrazilianCompanyType } from "./company-type.js";
export { CompanyType } from "./company-type.js";
export { CPF } from "./cpf.js";
export { CNPJ } from "./cnpj.js";
export { Password } from "./password.js";

// Entities - Note: CompanyTypeValue is defined in company.ts for use with the Company entity
export {
  User,
  type UserStatus,
  createUserRegistered,
  type UserRegistered,
} from "./user.js";
export {
  Company,
  createUserAddedToCompany,
  type UserAddedToCompany,
  type CreateCompanyInput,
  type CreateCompanyResult,
} from "./company.js";
// Re-export CompanyTypeValue for convenience (defined in company.ts)
export type { CompanyTypeValue } from "./company.js";
export {
  Profile,
  Permission,
  type PermissionAction,
  type PermissionResource,
} from "./profile.js";

// Services
export {
  UserService,
  CompanyService,
  type CreateUserInput,
} from "./user-service.js";
