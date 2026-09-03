/**
 * Follow-bottom decision state machine for MessageList — pure so the scroll
 * edge cases can be unit-tested without mounting Vue.
 *
 * Core rule: disengaging is intent-driven (any clear upward move latches
 * `away`); re-engaging requires scrolling back INTO the near-bottom zone.
 * A pure distance threshold deadlocks while streaming: every chunk snap resets
 * scrollTop to the very bottom, so `nearBottom` stays true and a user wheeling
 * up in small steps can never escape the threshold.
 *
 * Callers must gate BEFORE invoking this during DOM mutations: scroll events
 * fired while the virtual window prepends rows / restores scrollTop are
 * synthetic and would otherwise be mistaken for user motion.
 */

export type FollowDecision = {
  following: boolean;
  away: boolean;
  suppressUntil: number;
  scrolledUp: boolean;
};

export function decideFollowOnScroll(input: {
  top: number;
  lastTop: number;
  nearBottom: boolean;
  now: number;
  suppressUntil: number;
  away: boolean;
  following: boolean;
  guarded: boolean;
}): FollowDecision {
  const scrolledUp = input.lastTop >= 0 && input.top < input.lastTop - 1;
  if (input.guarded) {
    // While a window adjust / settle mutates the list, synthetic scroll events
    // fire — never let them re-engage (or "detach") a reader. `following` is
    // derived anyway; keep the latched truth stable.
    return {
      following: input.following,
      away: input.away,
      suppressUntil: input.suppressUntil,
      scrolledUp,
    };
  }
  let away = input.away;
  let suppressUntil = input.suppressUntil;
  if (scrolledUp) {
    suppressUntil = 0;
    // Big upward moves leave the near zone and latch. Tiny programmatic nudges
    // (scroll anchoring, estimate fixes) stay inside it and keep following.
    if (!input.nearBottom) away = true;
  } else if (input.nearBottom) {
    // Scrolled back down into the live edge — resume following.
    away = false;
  }
  const following =
    input.now < suppressUntil ? true : input.nearBottom && !away;
  return { following, away, suppressUntil, scrolledUp };
}
