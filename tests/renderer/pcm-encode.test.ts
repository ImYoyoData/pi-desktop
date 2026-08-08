import { describe, expect, it } from "vitest";
import {
  downsample,
  encodeFloatChunksSync,
  floatTo16BitPCM,
  mergeFloat32,
} from "../../src/renderer/src/utils/pcm-encode-core";

describe("pcm-encode-core", () => {
  it("merges Float32 chunks in order", () => {
    const merged = mergeFloat32([
      new Float32Array([0.1, 0.2]),
      new Float32Array([0.3, 0.4, 0.5]),
    ]);
    expect(Array.from(merged)).toHaveLength(5);
    expect(merged[0]).toBeCloseTo(0.1, 5);
    expect(merged[1]).toBeCloseTo(0.2, 5);
    expect(merged[2]).toBeCloseTo(0.3, 5);
    expect(merged[3]).toBeCloseTo(0.4, 5);
    expect(merged[4]).toBeCloseTo(0.5, 5);
  });

  it("downsamples 48 kHz to 16 kHz by keeping every 3rd sample", () => {
    const input = new Float32Array(9).map((_, i) => i);
    const out = downsample(input, 48000, 16000);
    expect(out.length).toBe(3);
    expect(Array.from(out)).toEqual([0, 3, 6]);
  });

  it("converts float samples to s16 PCM with clamping", () => {
    const pcm = floatTo16BitPCM(new Float32Array([1, -1, 0, 2, -2]));
    expect(pcm[0]).toBe(32767);
    expect(pcm[1]).toBe(-32768);
    expect(pcm[2]).toBe(0);
    expect(pcm[3]).toBe(32767); // clamped
    expect(pcm[4]).toBe(-32768); // clamped
  });

  it("preserves duration when encoding already-16kHz chunks (no double resample)", () => {
    // Voice capture now keeps mic-rate chunks and resamples once on stop.
    // If chunks are already 16 kHz, encode must use (16000, 16000); treating
    // them as 48 kHz would compress a 0.3s take to 0.1s and garble speech.
    const input = new Float32Array(4800); // 0.3s @ 16 kHz
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.5;
    }
    const ok = encodeFloatChunksSync([input], 16000, 16000);
    expect(ok.length).toBe(4800);
    const doubleResampled = encodeFloatChunksSync([input], 48000, 16000);
    expect(doubleResampled.length).toBe(1600);
  });

  it("resamples raw 48 kHz capture chunks once on stop", () => {
    // Mimics the new startVoiceRecord path: buffer mic-rate floats, encode once.
    const input = new Float32Array(4800); // 0.1s @ 48 kHz
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5;
    }
    const pcm = encodeFloatChunksSync([input], 48000, 16000);
    expect(pcm.length).toBe(1600);
    expect(pcm.some((v) => v !== 0)).toBe(true);
  });

  it("encodes a full take to 16 kHz s16le (1s at 48 kHz -> 16k samples)", () => {
    const sampleRate = 48000;
    const seconds = 1;
    const input = new Float32Array(sampleRate * seconds);
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5;
    }
    const pcm = encodeFloatChunksSync([input], sampleRate, 16000);
    expect(pcm.length).toBe(16000);
    // Non-zero audio survived the round trip.
    expect(pcm.some((v) => v !== 0)).toBe(true);
  });
});
