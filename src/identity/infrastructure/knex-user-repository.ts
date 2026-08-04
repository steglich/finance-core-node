import type { Knex } from "knex";
import type { UserRepository } from "./user-repository.js";
import { User } from "../domain/user.js";

/**
 * Knex-based implementation of UserRepository.
 */
export class KnexUserRepository implements UserRepository {
  constructor(private readonly knex: Knex) {}

  async create(user: User): Promise<void> {
    await this.knex("users").insert({
      id: user.id,
      name: user.name,
      email: user.email,
      password_hash: user.passwordHash,
      status: user.status,
      created_at: user.createdAt,
      updated_at: new Date(),
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.knex("users")
      .where("email", email.toLowerCase().trim())
      .first();

    if (!row) return null;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return this.mapRowToUser(row);
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.knex("users").where("id", id).first();

    if (!row) return null;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return this.mapRowToUser(row);
  }

  async update(user: User): Promise<void> {
    await this.knex("users").where("id", user.id).update({
      name: user.name,
      password_hash: user.passwordHash,
      status: user.status,
      updated_at: new Date(),
    });
  }

  private mapRowToUser(row: Record<string, unknown>): User {
    return new User(
      row.id as string,
      row.email as string,
      row.name as string,
      row.password_hash as string,
      (row.status as "ACTIVE" | "INACTIVE") || "ACTIVE",
      new Date(row.created_at as string),
    );
  }
}
