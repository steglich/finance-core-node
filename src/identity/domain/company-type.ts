import { ValueObject } from "../../shared/domain/value-object.js";

/**
 * Company type enumeration.
 */
export type CompanyTypeValue =
  | "MEI"
  | "EPP"
  | "EMPRESA_DE_PEQUENO_PORTE"
  | "EMPRESA_DE_MEDIO_PORTE"
  | "GRANDE_EMPRESA";

/**
 * CompanyType value object.
 * Represents the legal entity type of a company in Brazil.
 */
export class CompanyType extends ValueObject {
  private readonly _value: CompanyTypeValue;

  private constructor(value: CompanyTypeValue) {
    super();
    this._value = value;
  }

  get value(): CompanyTypeValue {
    return this._value;
  }

  protected compareValues(): string {
    return this._value;
  }

  toJSON(): unknown {
    return this._value;
  }

  /**
   * Creates a CompanyType instance from a string.
   */
  static create(value: string): CompanyType {
    const normalized = value.toUpperCase().trim();

    switch (normalized) {
      case "MEI":
        return new CompanyType("MEI");
      case "EPP":
        return new CompanyType("EPP");
      case "EMPRESA_DE_PEQUENO_PORTE":
      case "EMPRESA DE PEQUENO PORTE":
        return new CompanyType("EMPRESA_DE_PEQUENO_PORTE");
      case "EMPRESA_DE_MEDIO_PORTE":
      case "EMPRESA DE MEDIO PORTE":
        return new CompanyType("EMPRESA_DE_MEDIO_PORTE");
      case "GRANDE_EMPRESA":
      case "GRANDE EMPRESA":
        return new CompanyType("GRANDE_EMPRESA");
      default:
        throw new Error(`Invalid company type: ${value}`);
    }
  }

  /**
   * Returns all valid company types.
   */
  static all(): CompanyTypeValue[] {
    return [
      "MEI",
      "EPP",
      "EMPRESA_DE_PEQUENO_PORTE",
      "EMPRESA_DE_MEDIO_PORTE",
      "GRANDE_EMPRESA",
    ];
  }

  /**
   * Returns the default company type (EPP).
   */
  static default(): CompanyType {
    return new CompanyType("EPP");
  }
}
