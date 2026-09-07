/**
 * Pure helpers for MessageList virtual window — kept separate so scroll/sticky
 * edge cases can be unit-tested without mounting Vue.
 */

export type VirtualWindow = { start: number; end: number };

/** Inclusive start / exclusive end, clamped to [0, len]. */
export function clampVirtualWindow(
  start: number,
  end: number,
  len: number,
): VirtualWindow {
  const s = Math.max(0, Math.min(start, len));
  const e = Math.max(s, Math.min(end, len));
  return { start: s, end: e };
}

/**
 * Ensure `index` is inside the mounted window. Returns whether the window
 * actually changed (idempotent when already satisfied / already trimmed).
 */
export function ensureIndexInVirtualWindow(
  window: VirtualWindow,
  index: number,
  len: number,
  maxSize: number,
): { window: VirtualWindow; changed: boolean } {
  if (index < 0 || index >= len || len <= 0) {
    return { window: clampVirtualWindow(window.start, window.end, len), changed: false };
  }

  let start = window.start;
  let end = window.end;
  let changed = false;

  if (index < start) {
    start = Math.max(0, index);
    changed = true;
  }
  if (index >= end) {
    end = Math.min(len, index + 1);
    changed = true;
  }

  if (end - start > maxSize) {
    let nextStart: number;
    let nextEnd: number;
    if (start === Math.max(0, index)) {
      nextStart = start;
      nextEnd = Math.min(len, start + maxSize);
    } else {
      nextStart = Math.max(0, end - maxSize);
      nextEnd = end;
      if (index < nextStart) {
        nextStart = Math.max(0, index);
        nextEnd = Math.min(len, nextStart + maxSize);
      }
    }
    if (nextStart !== start || nextEnd !== end) {
      start = nextStart;
      end = nextEnd;
      changed = true;
    }
  }

  return { window: { start, end }, changed };
}

/** Trailing window while following bottom — never exceed maxSize. */
export function followBottomVirtualWindow(
  len: number,
  windowSize: number,
): VirtualWindow {
  if (len <= 0) return { start: 0, end: 0 };
  const size = Math.max(1, windowSize);
  const end = len;
  const start = Math.max(0, end - size);
  return { start, end };
}

/**
 * After prepending `added` older rows at index 0, shift the mounted window so the
 * same messages stay mounted, then peek `peekChunk` further into the older slice.
 */
export function windowAfterHistoryPrepend(
  window: VirtualWindow,
  added: number,
  len: number,
  maxSize: number,
  peekChunk: number,
): VirtualWindow {
  if (added <= 0 || len <= 0) return clampVirtualWindow(window.start, window.end, len);
  let start = window.start + added;
  let end = window.end + added;
  start = Math.max(0, start - Math.max(0, peekChunk));
  end = Math.max(start, Math.min(len, end));
  if (end - start > maxSize) {
    end = Math.min(len, start + maxSize);
  }
  return clampVirtualWindow(start, end, len);
}
