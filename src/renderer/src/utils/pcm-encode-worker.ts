/**
 * Off-main-thread PCM encoder: merges Float32 audio chunks, resamples to
 * 16 kHz and converts to s16le PCM. Keeps the long post-record encode off
 * the renderer UI thread so the app never freezes after a voice take.
 */

export type PcmEncodeRequest = {
  id: number;
  chunks: ArrayBuffer[];
  inputRate: number;
  targetRate: number;
};

export type PcmEncodeResponse =
  | { id: number; pcm: ArrayBuffer }
  | { id: number; error: string };

const workerSelf = self as unknown as {
  onmessage: ((ev: MessageEvent<PcmEncodeRequest>) => void) | null;
  postMessage: (msg: PcmEncodeResponse, transfer?: Transferable[]) => void;
};

import { downsample, floatTo16BitPCM } from "./pcm-encode-core";

workerSelf.onmessage = (ev: MessageEvent<PcmEncodeRequest>) => {
  const { id, chunks, inputRate, targetRate } = ev.data ?? {};
  try {
    if (!Array.isArray(chunks)) throw new Error("pcm-encode: chunks required");
    let sampleCount = 0;
    for (const buf of chunks) {
      sampleCount += Math.floor((buf.byteLength || 0) / Float32Array.BYTES_PER_ELEMENT);
    }
    const merged = new Float32Array(sampleCount);
    let offset = 0;
    for (const buf of chunks) {
      const view = new Float32Array(buf);
      merged.set(view, offset);
      offset += view.length;
    }
    const resampled =
      inputRate === targetRate ? merged : downsample(merged, inputRate, targetRate);
    const pcm = floatTo16BitPCM(resampled);
    workerSelf.postMessage({ id, pcm: pcm.buffer }, [pcm.buffer]);
  } catch (err) {
    workerSelf.postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export {};
