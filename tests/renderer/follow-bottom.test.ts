import { describe, expect, it } from "vitest";
import { decideFollowOnIntent } from "../../src/renderer/src/utils/follow-bottom";

type IntentInput = Parameters<typeof decideFollowOnIntent>[0];

function input(overrides: Partial<IntentInput>): IntentInput {
  return {
    intent: "down",
    nearBottom: true,
    following: true,
    ...overrides,
  };
}

describe("decideFollowOnIntent", () => {
  it("keeps following while the user stays at the live edge", () => {
    const d = decideFollowOnIntent(input({ intent: "down", nearBottom: true }));
    expect(d.following).toBe(true);
    expect(d.engaged).toBe(false);
  });

  it("leaves the live edge on any upward intent", () => {
    // Even inside the near-bottom zone: a distance threshold alone cannot express
    // "the user wants to read history", and the stream snaps would keep resetting
    // the user's scroll progress.
    const d = decideFollowOnIntent(input({ intent: "up", nearBottom: true }));
    expect(d.following).toBe(false);
    expect(d.engaged).toBe(true);
  });

  it("reports no change when already reading history", () => {
    const d = decideFollowOnIntent(
      input({ intent: "up", nearBottom: false, following: false }),
    );
    expect(d.following).toBe(false);
    expect(d.engaged).toBe(false);
  });

  it("stays disengaged while scrolling down outside the bottom zone", () => {
    const d = decideFollowOnIntent(
      input({ intent: "down", nearBottom: false, following: false }),
    );
    expect(d.following).toBe(false);
    expect(d.engaged).toBe(false);
  });

  it("re-engages once the downward intent reaches the bottom zone", () => {
    const d = decideFollowOnIntent(
      input({ intent: "down", nearBottom: true, following: false }),
    );
    expect(d.following).toBe(true);
    expect(d.engaged).toBe(true);
  });
});
