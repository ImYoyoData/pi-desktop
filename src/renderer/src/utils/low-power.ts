/**
 * Heuristic for low-CPU / low-RAM clients (old laptops, power-saver mode).
 * Used to drop visual polish and heavy mic DSP that stalls the UI thread.
 */

let cached: boolean | null = null;

export function isLowPowerClient(): boolean {
  if (cached != null) return cached;
  try {
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { saveData?: boolean; effectiveType?: string };
    };
    const cores = nav.hardwareConcurrency || 4;
    const mem = typeof nav.deviceMemory === "number" ? nav.deviceMemory : 8;
    const saveData = Boolean(nav.connection?.saveData);
    const slowNet =
      nav.connection?.effectiveType === "slow-2g" ||
      nav.connection?.effectiveType === "2g";
    cached = cores <= 4 || mem <= 4 || saveData || slowNet;
  } catch {
    cached = false;
  }
  return cached;
}

/** Yield until after the next paint so click UI can commit before heavy work. */
export function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}
