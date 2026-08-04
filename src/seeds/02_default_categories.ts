import type { Knex } from "knex";

// Default categories for new companies (RN-08)
const defaultExpenseCategories = [
  "Alimentação",
  "Transporte",
  "Moradia",
  "Saúde",
  "Educação",
  "Lazer",
  "Vestuário",
  "Assinaturas",
];

const defaultIncomeCategories = ["Salário", "Bônus", "Investimentos", "Outros"];

export async function seed(knex: Knex): Promise<void> {
  // This will be called by CompanyService.create() when a new company is created
  // For now, we just export the categories for reference
}

// Helper function to create default categories for a company
export async function createDefaultCategories(
  knex: Knex,
  companyId: string,
): Promise<void> {
  const categories = [
    ...defaultExpenseCategories.map((name) => ({
      name,
      type: "EXPENSE",
      company_id: companyId,
    })),
    ...defaultIncomeCategories.map((name) => ({
      name,
      type: "INCOME",
      company_id: companyId,
    })),
  ];

  for (const cat of categories) {
    await knex("categories").insert({
      id: crypto.randomUUID(),
      ...cat,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }
}
