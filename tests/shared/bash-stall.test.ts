import { describe, expect, it } from "vitest";
import {
  BASH_STALL_SILENCE_MS,
  shouldInterruptBashStall,
} from "../../src/shared/bash-stall";

describe("bash-stall", () => {
  it("interrupts running non-detached bash after silence window", () => {
    const startedAt = 1_000;
    expect(
      shouldInterruptBashStall(
        {
          status: "running",
          detached: false,
          startedAt,
          lastOutputAt: startedAt,
        },
        startedAt + BASH_STALL_SILENCE_MS,
      ),
    ).toBe(true);
  });

  it("does not interrupt before the silence window", () => {
    const startedAt = 1_000;
    expect(
      shouldInterruptBashStall(
        {
          status: "running",
          startedAt,
          lastOutputAt: startedAt,
        },
        startedAt + BASH_STALL_SILENCE_MS - 1,
      ),
    ).toBe(false);
  });

  it("ignores detached / terminating / recently active runs", () => {
    const now = 200_000;
    expect(
      shouldInterruptBashStall(
        {
          status: "running",
          detached: true,
          startedAt: 1,
          lastOutputAt: 1,
        },
        now,
      ),
    ).toBe(false);
    expect(
      shouldInterruptBashStall(
        {
          status: "terminating",
          startedAt: 1,
          lastOutputAt: 1,
        },
        now,
      ),
    ).toBe(false);
    expect(
      shouldInterruptBashStall(
        {
          status: "running",
          startedAt: 1,
          lastOutputAt: now - 1_000,
        },
        now,
      ),
    ).toBe(false);
  });
});
