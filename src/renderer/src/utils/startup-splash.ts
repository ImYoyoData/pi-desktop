/** Full-window startup splash shown before the app UI is ready. */

const SPLASH_ID = "pi-startup-splash";
/** Keep the splash on screen at least this long so loading flashes never peek through. */
const MIN_HOLD_MS = 800;
const FADE_MS = 300;

/** When this module loads (≈ page boot). */
const shownAt = Date.now();

function splashEl(): HTMLElement | null {
  return document.getElementById(SPLASH_ID);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Ensure the splash is visible (re-shows it if it was removed). */
export function showStartupSplash(): void {
  const el = splashEl();
  if (!el) return;
  el.classList.remove("is-leaving");
}

/** Remove the splash without animation (e.g. locale-reload covers the screen). */
export function hideStartupSplashInstantly(): void {
  splashEl()?.remove();
}

/**
 * Fade the splash out once the app has initialized (min hold time respected).
 * Pass 'fast' to skip the minimum hold - used when a system dialog (e.g. the
 * project trust prompt) must be clickable right away.
 */
export async function dismissStartupSplash(fast = false): Promise<void> {
  const el = splashEl();
  if (!el) return;
  if (!fast) {
    const elapsed = Date.now() - shownAt;
    if (elapsed < MIN_HOLD_MS) await sleep(MIN_HOLD_MS - elapsed);
  }
  el.classList.add("is-leaving");
  await sleep(fast ? 160 : FADE_MS);
  el.remove();
}
