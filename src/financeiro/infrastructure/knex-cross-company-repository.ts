import type { Knex } from "knex";
import type {
  CompanyNetWorth,
  CrossCompanyReader,
  NetWorthRepository,
} from "./net-worth-repository.js";

/**
 * The one reading in the system that spans companies.
 *
 * It deliberately lives in a file of its own, extends nothing, and takes a
 * **userId** rather than a list of companies. The company scope is a repository
 * invariant so that no exception happens by accident; the exception that is
 * genuinely needed therefore has to be impossible to mistake for a normal
 * repository. A `findAll(companyIds)` on an ordinary repository would be the
 * door through which the isolation later leaks by mistake (design, decision 12).
 *
 * The set of companies comes from `company_users`. A company the client names
 * but the user does not belong to simply is not in the result.
 */
export class KnexCrossCompanyRepository implements CrossCompanyReader {
  constructor(
    private readonly knex: Knex,
    private readonly netWorthRepository: NetWorthRepository,
  ) {}

  async netWorthByCompany(
    userId: string,
    referenceDate: Date,
  ): Promise<CompanyNetWorth[]> {
    const rows = (await this.knex("company_users as cu")
      .join("companies as c", "c.id", "cu.company_id")
      .where("cu.user_id", userId)
      .orderBy("c.name", "asc")
      .select("c.id", "c.name")) as { id: string; name: string }[];

    const results: CompanyNetWorth[] = [];

    for (const row of rows) {
      results.push({
        companyId: row.id,
        companyName: row.name,
        components: await this.netWorthRepository.netWorthAt(
          row.id,
          referenceDate,
        ),
      });
    }

    return results;
  }
}
