/**
 * Pure PCM encode helpers shared by the off-thread worker and the sync
 * fallback, so the two paths can never drift.
 */

export function mergeFloat32(chunks: Float32Array[]): Float32Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Float32Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export function downsample(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (toRate >= fromRate) return input;
  const ratio = fromRate / toRate;
  const newLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(newLen);
  // Linear interpolation: far better speech quality than keeping every
  // Nth sample, which folds high frequencies back into the voice band.
  for (let i = 0; i < newLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/**
 * Encode a take synchronously (fallback when the worker is unavailable).
 * Returns s16le PCM at `targetRate`.
 */
export function encodeFloatChunksSync(
  chunks: Float32Array[],
  inputRate: number,
  targetRate: number,
): Int16Array {
  const merged = mergeFloat32(chunks);
  const resampled =
    inputRate === targetRate ? merged : downsample(merged, inputRate, targetRate);
  return floatTo16BitPCM(resampled);
}
