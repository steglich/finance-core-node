// Value Objects
export { Email } from "./email.js";
export type { CompanyTypeValue } from "./company-type.js";
export { CompanyType } from "./company-type.js";
export { CPF } from "./cpf.js";
export { CNPJ } from "./cnpj.js";
export { Password } from "./password.js";

// Entities
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
} from "./company.js";
export {
  Profile,
  Permission,
  type PermissionAction,
  type PermissionResource,
} from "./profile.js";

// Services
export { UserService, type CreateUserInput } from "./user-service.js";
