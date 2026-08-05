import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { closingDateFor, cycleStartFor, dueDateFor } from "./invoice-cycle.js";

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe("closingDateFor", () => {
  it("sends a purchase made after the closing day to the next cycle", () => {
    assert.equal(
      iso(closingDateFor(new Date("2026-07-20T00:00:00Z"), 3)),
      "2026-08-03",
    );
  });

  it("keeps a purchase made on the closing day in the closing cycle", () => {
    assert.equal(
      iso(closingDateFor(new Date("2026-08-03T00:00:00Z"), 3)),
      "2026-08-03",
    );
  });

  it("sends a purchase made the day after closing to the following cycle", () => {
    assert.equal(
      iso(closingDateFor(new Date("2026-08-05T00:00:00Z"), 3)),
      "2026-09-03",
    );
  });

  it("clamps day 31 to the last day of February", () => {
    assert.equal(
      iso(closingDateFor(new Date("2026-02-10T00:00:00Z"), 31)),
      "2026-02-28",
    );
    // 2028 is a leap year.
    assert.equal(
      iso(closingDateFor(new Date("2028-02-10T00:00:00Z"), 31)),
      "2028-02-29",
    );
  });

  it("clamps day 31 to the last day of a 30-day month", () => {
    assert.equal(
      iso(closingDateFor(new Date("2026-04-15T00:00:00Z"), 31)),
      "2026-04-30",
    );
  });

  it("rolls into the next month when the clamped day has already passed", () => {
    assert.equal(
      iso(closingDateFor(new Date("2026-04-30T00:00:00Z"), 30)),
      "2026-04-30",
    );
    assert.equal(
      iso(closingDateFor(new Date("2026-05-01T00:00:00Z"), 30)),
      "2026-05-30",
    );
  });
});

describe("cycleStartFor", () => {
  it("starts the day after the previous closing date", () => {
    assert.equal(
      iso(cycleStartFor(new Date("2026-08-03T00:00:00Z"), 3)),
      "2026-07-04",
    );
  });

  it("handles a February closing date with day 31", () => {
    assert.equal(
      iso(cycleStartFor(new Date("2026-02-28T00:00:00Z"), 31)),
      "2026-02-01",
    );
  });
});

describe("dueDateFor", () => {
  it("falls in the same month when the due day is later than the closing day", () => {
    assert.equal(
      iso(dueDateFor(new Date("2026-08-03T00:00:00Z"), 10)),
      "2026-08-10",
    );
  });

  it("falls in the month after closing when the due day is not later", () => {
    assert.equal(
      iso(dueDateFor(new Date("2026-08-25T00:00:00Z"), 10)),
      "2026-09-10",
    );
  });

  it("rolls to the next month when the due day equals the closing day", () => {
    assert.equal(
      iso(dueDateFor(new Date("2026-08-10T00:00:00Z"), 10)),
      "2026-09-10",
    );
  });

  it("clamps a due day of 31 to the last day of the month", () => {
    assert.equal(
      iso(dueDateFor(new Date("2026-01-31T00:00:00Z"), 31)),
      "2026-02-28",
    );
  });
});
