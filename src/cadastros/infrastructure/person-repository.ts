import type { PersonBankAccount } from "../domain/person-bank-account.js";
import type { Person, PersonRole, PersonType } from "../domain/person.js";

/**
 * Filters for listing the people of a company.
 */
export interface PersonFilter {
  role?: PersonRole | undefined;
  personType?: PersonType | undefined;
  isActive?: boolean | undefined;
  /** Case-insensitive match on the name or the document. */
  search?: string | undefined;
}

/**
 * Repository interface for the Person aggregate and its bank accounts.
 * Every method is scoped by companyId (multi-tenancy invariant).
 */
export interface PersonRepository {
  /**
   * Persists a new person together with its roles.
   */
  create(person: Person): Promise<void>;

  /**
   * Finds a person by id within a company.
   */
  findById(companyId: string, id: string): Promise<Person | null>;

  /**
   * Finds a person by its unmasked document within a company — the uniqueness
   * check behind "Duplicate document in the same company".
   */
  findByDocument(companyId: string, document: string): Promise<Person | null>;

  /**
   * Lists the people of a company, optionally filtered.
   */
  findByCompany(companyId: string, filter?: PersonFilter): Promise<Person[]>;

  /**
   * Lists the active people of a company carrying a given classification.
   */
  findByRole(companyId: string, role: PersonRole): Promise<Person[]>;

  /**
   * Updates a person and reconciles its roles.
   */
  update(person: Person): Promise<void>;

  /**
   * Persists a new bank account for a payee.
   */
  createBankAccount(account: PersonBankAccount): Promise<void>;

  /**
   * Bank accounts of a person, the default one first.
   */
  findBankAccounts(
    companyId: string,
    personId: string,
  ): Promise<PersonBankAccount[]>;

  /**
   * Finds a single bank account within a company.
   */
  findBankAccountById(
    companyId: string,
    id: string,
  ): Promise<PersonBankAccount | null>;

  /**
   * Updates one or more bank accounts — several at once when the default flag
   * moves from one account to another.
   */
  updateBankAccounts(accounts: readonly PersonBankAccount[]): Promise<void>;

  /**
   * Removes a bank account. Bank details carry no history of their own, so
   * unlike people they can be deleted outright.
   */
  deleteBankAccount(companyId: string, id: string): Promise<boolean>;
}
