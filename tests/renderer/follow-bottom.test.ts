import { describe, expect, it } from "vitest";
import { decideFollowOnScroll } from "../../src/renderer/src/utils/follow-bottom";

type ScrollInput = Parameters<typeof decideFollowOnScroll>[0];

function input(overrides: Partial<ScrollInput>): ScrollInput {
  return {
    top: 0,
    lastTop: -1,
    nearBottom: true,
    now: 1_000,
    suppressUntil: 0,
    away: false,
    following: true,
    guarded: false,
    ...overrides,
  };
}

describe("decideFollowOnScroll", () => {
  it("keeps following while snapped to the bottom", () => {
    const d = decideFollowOnScroll(
      input({ top: 900, lastTop: 800, nearBottom: true }),
    );
    expect(d.following).toBe(true);
    expect(d.away).toBe(false);
  });

  it("does NOT latch away on a tiny upward nudge inside the near-bottom zone (scroll anchoring)", () => {
    const d = decideFollowOnScroll(
      input({ top: 880, lastTop: 900, nearBottom: true }),
    );
    expect(d.scrolledUp).toBe(true);
    expect(d.away).toBe(false);
    expect(d.following).toBe(true);
  });

  it("latches away once an upward move leaves the near-bottom zone", () => {
    const d = decideFollowOnScroll(
      input({ top: 300, lastTop: 900, nearBottom: false }),
    );
    expect(d.away).toBe(true);
    expect(d.following).toBe(false);
  });

  it("stays disengaged while reading history even when the snap would re-bottom (threshold deadlock)", () => {
    // User disengaged earlier; stream chunk growth fires no scroll event, and a
    // later scroll event still inside the near zone must not re-engage follow
    // while the last motion was upward.
    let d = decideFollowOnScroll(
      input({
        top: 850,
        lastTop: 900,
        nearBottom: true,
        away: true,
        following: false,
      }),
    );
    expect(d.following).toBe(false);
    expect(d.away).toBe(true);
    // Continued upward steps keep it latched.
    d = decideFollowOnScroll(
      input({
        top: 500,
        lastTop: 850,
        nearBottom: false,
        away: d.away,
        following: d.following,
      }),
    );
    expect(d.following).toBe(false);
    expect(d.away).toBe(true);
  });

  it("re-engages only when the user scrolls back down into the near-bottom zone", () => {
    // Downward move still far from bottom: stays disengaged.
    let d = decideFollowOnScroll(
      input({
        top: 400,
        lastTop: 300,
        nearBottom: false,
        away: true,
        following: false,
      }),
    );
    expect(d.following).toBe(false);
    expect(d.away).toBe(true);
    // Downward move landing near the bottom: follow resumes.
    d = decideFollowOnScroll(
      input({
        top: 890,
        lastTop: 700,
        nearBottom: true,
        away: d.away,
        following: d.following,
      }),
    );
    expect(d.away).toBe(false);
    expect(d.following).toBe(true);
  });

  it("forces following during the post-send suppression window", () => {
    const d = decideFollowOnScroll(
      input({
        top: 500,
        lastTop: 500,
        nearBottom: false,
        suppressUntil: 2_000,
        now: 1_000,
      }),
    );
    expect(d.following).toBe(true);
  });

  it("expires suppression immediately on upward motion", () => {
    const d = decideFollowOnScroll(
      input({
        top: 300,
        lastTop: 900,
        nearBottom: false,
        suppressUntil: 2_000,
        now: 1_000,
      }),
    );
    expect(d.suppressUntil).toBe(0);
    expect(d.following).toBe(false);
  });

  it("keeps state untouched while guarded (window adjust / session settle) but still tracks position", () => {
    const d = decideFollowOnScroll(
      input({
        top: 100,
        lastTop: 900,
        nearBottom: false,
        guarded: true,
        following: true,
      }),
    );
    expect(d.scrolledUp).toBe(true);
    expect(d.following).toBe(true);
    expect(d.away).toBe(false);
  });
});
