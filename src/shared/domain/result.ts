import type { DomainError } from "./domain-error.js";

/**
 * Represents a success or failure result of an operation.
 */
export class Result<T> {
  private readonly _isSuccess: boolean;
  private readonly _value: T | undefined;
  private readonly _error: DomainError | undefined;

  private constructor(isSuccess: boolean, value?: T, error?: DomainError) {
    this._isSuccess = isSuccess;
    this._value = value;
    this._error = error;
  }

  get isSuccess(): boolean {
    return this._isSuccess;
  }

  get isFailure(): boolean {
    return !this._isSuccess;
  }

  get value(): T | undefined {
    return this._value;
  }

  get error(): DomainError | undefined {
    return this._error;
  }

  /**
   * Creates a successful result with the given value.
   */
  static success<U>(value: U): Result<U> {
    return new Result<U>(true, value);
  }

  /**
   * Creates a failed result with the given error.
   */
  static failed<U>(error: DomainError): Result<U> {
    return new Result<U>(false, undefined, error);
  }

  /**
   * Maps the success value to a new type.
   */
  map<U>(fn: (value: T) => U): Result<U> {
    if (this.isFailure) {
      const err = this._error;
      return err
        ? Result.failed(err)
        : Result.failed(new Error("Unknown error") as DomainError);
    }
    const val = this._value;
    return val !== undefined
      ? Result.success(fn(val))
      : Result.failed(new Error("No value") as DomainError);
  }

  /**
   * Executes the appropriate handler based on success or failure.
   */
  match(
    onSuccess: (value: T) => void,
    onFailure: (error: DomainError) => void,
  ): void {
    if (this.isSuccess && this._value !== undefined) {
      onSuccess(this._value);
    } else if (this._error !== undefined) {
      onFailure(this._error);
    }
  }

  /**
   * Returns the value or a default.
   */
  getValueOr(defaultValue: T): T {
    return this._value ?? defaultValue;
  }

  /**
   * Returns the value or throws the error.
   */
  getValueOrThrow(): T {
    if (this.isFailure) {
      const err = this._error;
      if (err) throw err;
      throw new Error("Unknown failure");
    }
    const val = this._value;
    if (val === undefined) {
      throw new Error("No value in success result");
    }
    return val;
  }
}
