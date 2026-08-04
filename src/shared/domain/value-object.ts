/**
 * Base class for all value objects.
 * Value objects are immutable and compare by their properties.
 */
export abstract class ValueObject {
  /**
   * Compares two value objects by their string representation.
   * Subclasses should override toString() or implement compareValues().
   */
  equals(other: ValueObject): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    if (this.constructor !== other.constructor) {
      return false;
    }
    return this.compareValues() === (other as this).compareValues();
  }

  /**
   * Returns a string representation of the value object's properties for comparison.
   */
  protected abstract compareValues(): string;

  /**
   * Converts the value object to a plain object representation.
   */
  abstract toJSON(): unknown;
}
