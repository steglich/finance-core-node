import type { User } from "../domain/user.js";

/**
 * Repository interface for User entity.
 */
export interface UserRepository {
  /**
   * Creates a new user.
   */
  create(user: User): Promise<void>;

  /**
   * Finds a user by email.
   */
  findByEmail(email: string): Promise<User | null>;

  /**
   * Finds a user by ID.
   */
  findById(id: string): Promise<User | null>;

  /**
   * Updates a user.
   */
  update(user: User): Promise<void>;
}
