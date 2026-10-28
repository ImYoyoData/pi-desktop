/** Full-window startup splash shown before the app UI is ready. */

const SPLASH_ID = "pi-startup-splash";
/** 至少停留这么久，避免快速启动时 splash 一闪而过。 */
const MIN_HOLD_MS = 300;
const FADE_MS = 300;

/** When this module loads (≈ page boot). */
const shownAt = Date.now();

function splashEl(): HTMLElement | null {
  return document.getElementById(SPLASH_ID);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 应用初始化完成后淡出 splash（遵守最短停留时长）。 */
export async function dismissStartupSplash(): Promise<void> {
  const el = splashEl();
  if (!el) return;
  const elapsed = Date.now() - shownAt;
  if (elapsed < MIN_HOLD_MS) await sleep(MIN_HOLD_MS - elapsed);
  el.classList.add("is-leaving");
  await sleep(FADE_MS);
  el.remove();
}
