/**
 * Wake-word helpers for resident ASR listening.
 * Matching is case-insensitive substring only (no fuzzy/phonetic).
 */

/** Default wake-words textarea content (newline-separated). */
export const DEFAULT_ASR_WAKE_WORDS = "小皮\nhey pi";

/**
 * Split raw wake-word prefs on commas (ASCII/fullwidth) and newlines.
 * Trims each token and drops empties.
 */
export function parseWakeWords(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,，\r\n]+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Return the first configured wake word found as a case-insensitive substring
 * of `transcript`, or null if none match.
 */
export function matchWakeWords(transcript: string, words: string[]): string | null {
  if (!transcript || words.length === 0) return null;
  const hay = transcript.toLocaleLowerCase();
  for (const word of words) {
    const needle = word.trim().toLocaleLowerCase();
    if (!needle) continue;
    if (hay.includes(needle)) return word.trim();
  }
  return null;
}
