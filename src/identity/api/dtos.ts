import { DomainError } from "../../shared/domain/domain-error.js";

/**
 * Result type for API operations.
 */
export type ApiResult<T> =
  { success: true; data: T } | { success: false; error: DomainError };

/**
 * Register user request DTO.
 */
export interface RegisterUserRequest {
  name: string;
  email: string;
  password: string;
}

/**
 * Validates register user request.
 */
export function validateRegisterUserRequest(
  body: unknown,
): ApiResult<RegisterUserRequest> {
  if (typeof body !== "object" || body === null) {
    return {
      success: false,
      error: DomainError.create("VALIDATION_ERROR", "Invalid request body"),
    };
  }

  const b = body as Record<string, unknown>;

  if (typeof b.name !== "string" || b.name.trim().length < 2) {
    return {
      success: false,
      error: DomainError.create(
        "VALIDATION_ERROR",
        "Name must be at least 2 characters",
      ),
    };
  }

  if (typeof b.email !== "string" || !b.email.includes("@")) {
    return {
      success: false,
      error: DomainError.create("VALIDATION_ERROR", "Valid email is required"),
    };
  }

  if (typeof b.password !== "string" || b.password.length < 8) {
    return {
      success: false,
      error: DomainError.create(
        "VALIDATION_ERROR",
        "Password must be at least 8 characters",
      ),
    };
  }

  return {
    success: true,
    data: {
      name: b.name.trim(),
      email: b.email.toLowerCase().trim(),
      password: b.password,
    },
  };
}

/**
 * Login request DTO.
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Validates login request.
 */
export function validateLoginRequest(body: unknown): ApiResult<LoginRequest> {
  if (typeof body !== "object" || body === null) {
    return {
      success: false,
      error: DomainError.create("VALIDATION_ERROR", "Invalid request body"),
    };
  }

  const b = body as Record<string, unknown>;

  if (typeof b.email !== "string") {
    return {
      success: false,
      error: DomainError.create("VALIDATION_ERROR", "Email is required"),
    };
  }

  if (typeof b.password !== "string") {
    return {
      success: false,
      error: DomainError.create("VALIDATION_ERROR", "Password is required"),
    };
  }

  return {
    success: true,
    data: {
      email: b.email.toLowerCase().trim(),
      password: b.password,
    },
  };
}

/**
 * Refresh token request DTO.
 */
export interface RefreshTokenRequest {
  refreshToken: string;
}

/**
 * Validates refresh token request.
 */
export function validateRefreshTokenRequest(
  body: unknown,
): ApiResult<RefreshTokenRequest> {
  if (typeof body !== "object" || body === null) {
    return {
      success: false,
      error: DomainError.create("VALIDATION_ERROR", "Invalid request body"),
    };
  }

  const b = body as Record<string, unknown>;

  if (typeof b.refreshToken !== "string" || b.refreshToken.length === 0) {
    return {
      success: false,
      error: DomainError.create(
        "VALIDATION_ERROR",
        "Refresh token is required",
      ),
    };
  }

  return {
    success: true,
    data: { refreshToken: b.refreshToken },
  };
}

/**
 * Recover password request DTO.
 */
export interface RecoverPasswordRequest {
  email: string;
}

/**
 * Validates recover password request.
 */
export function validateRecoverPasswordRequest(
  body: unknown,
): ApiResult<RecoverPasswordRequest> {
  if (typeof body !== "object" || body === null) {
    return {
      success: false,
      error: DomainError.create("VALIDATION_ERROR", "Invalid request body"),
    };
  }

  const b = body as Record<string, unknown>;

  if (typeof b.email !== "string" || !b.email.includes("@")) {
    return {
      success: false,
      error: DomainError.create("VALIDATION_ERROR", "Valid email is required"),
    };
  }

  return {
    success: true,
    data: { email: b.email.toLowerCase().trim() },
  };
}

/**
 * Reset password request DTO.
 */
export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

/**
 * Validates reset password request.
 */
export function validateResetPasswordRequest(
  body: unknown,
): ApiResult<ResetPasswordRequest> {
  if (typeof body !== "object" || body === null) {
    return {
      success: false,
      error: DomainError.create("VALIDATION_ERROR", "Invalid request body"),
    };
  }

  const b = body as Record<string, unknown>;

  if (typeof b.token !== "string" || b.token.length === 0) {
    return {
      success: false,
      error: DomainError.create("VALIDATION_ERROR", "Token is required"),
    };
  }

  if (typeof b.newPassword !== "string" || b.newPassword.length < 8) {
    return {
      success: false,
      error: DomainError.create(
        "VALIDATION_ERROR",
        "Password must be at least 8 characters",
      ),
    };
  }

  return {
    success: true,
    data: { token: b.token, newPassword: b.newPassword },
  };
}

/**
 * Create company request DTO.
 */
export interface CreateCompanyRequest {
  name: string;
  type: "INDIVIDUAL" | "CORPORATE";
  defaultCurrency?: string;
}

/**
 * Validates create company request.
 */
export function validateCreateCompanyRequest(
  body: unknown,
): ApiResult<CreateCompanyRequest> {
  if (typeof body !== "object" || body === null) {
    return {
      success: false,
      error: DomainError.create("VALIDATION_ERROR", "Invalid request body"),
    };
  }

  const b = body as Record<string, unknown>;

  if (typeof b.name !== "string" || b.name.trim().length < 2) {
    return {
      success: false,
      error: DomainError.create(
        "VALIDATION_ERROR",
        "Name must be at least 2 characters",
      ),
    };
  }

  const validTypes = ["INDIVIDUAL", "CORPORATE"];
  if (b.type !== "INDIVIDUAL" && b.type !== "CORPORATE") {
    return {
      success: false,
      error: DomainError.create(
        "VALIDATION_ERROR",
        "Type must be INDIVIDUAL or CORPORATE",
      ),
    };
  }

  const currency =
    typeof b.defaultCurrency === "string"
      ? b.defaultCurrency.toUpperCase()
      : "BRL";

  return {
    success: true,
    data: {
      name: b.name.trim(),
      type: b.type as "INDIVIDUAL" | "CORPORATE",
      defaultCurrency: currency,
    },
  };
}

/**
 * Create profile request DTO.
 */
export interface CreateProfileRequest {
  name: string;
  permissionIds: string[];
}

/**
 * Validates create profile request.
 */
export function validateCreateProfileRequest(
  body: unknown,
): ApiResult<CreateProfileRequest> {
  if (typeof body !== "object" || body === null) {
    return {
      success: false,
      error: DomainError.create("VALIDATION_ERROR", "Invalid request body"),
    };
  }

  const b = body as Record<string, unknown>;

  if (typeof b.name !== "string" || b.name.trim().length < 2) {
    return {
      success: false,
      error: DomainError.create(
        "VALIDATION_ERROR",
        "Name must be at least 2 characters",
      ),
    };
  }

  const permissionIds = b.permissionIds;
  if (
    !Array.isArray(permissionIds) ||
    permissionIds.some((id) => typeof id !== "string")
  ) {
    return {
      success: false,
      error: DomainError.create(
        "VALIDATION_ERROR",
        "Permission IDs must be an array of strings",
      ),
    };
  }

  return {
    success: true,
    data: { name: b.name.trim(), permissionIds },
  };
}

/**
 * Update profile request DTO.
 */
export interface UpdateProfileRequest {
  name?: string;
  permissionIds?: string[];
}

/**
 * Validates update profile request.
 */
export function validateUpdateProfileRequest(
  body: unknown,
): ApiResult<UpdateProfileRequest> {
  if (typeof body !== "object" || body === null) {
    return {
      success: false,
      error: DomainError.create("VALIDATION_ERROR", "Invalid request body"),
    };
  }

  const b = body as Record<string, unknown>;
  const result: UpdateProfileRequest = {};

  if (b.name !== undefined) {
    if (typeof b.name !== "string" || b.name.trim().length < 2) {
      return {
        success: false,
        error: DomainError.create(
          "VALIDATION_ERROR",
          "Name must be at least 2 characters",
        ),
      };
    }
    result.name = b.name.trim();
  }

  if (b.permissionIds !== undefined) {
    const permissionIds = b.permissionIds;
    if (
      !Array.isArray(permissionIds) ||
      permissionIds.some((id) => typeof id !== "string")
    ) {
      return {
        success: false,
        error: DomainError.create(
          "VALIDATION_ERROR",
          "Permission IDs must be an array of strings",
        ),
      };
    }
    result.permissionIds = permissionIds;
  }

  return { success: true, data: result };
}
