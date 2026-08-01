/**
 * Client for the PCM encode worker. Lazily spawns one worker and returns
 * the encoded s16le PCM ArrayBuffer (transferred back zero-copy).
 */
import type { PcmEncodeRequest, PcmEncodeResponse } from "./pcm-encode-worker";

type Pending = {
  resolve: (pcm: ArrayBuffer) => void;
  reject: (err: Error) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function rejectAll(error: Error): void {
  for (const row of pending.values()) row.reject(error);
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL("./pcm-encode-worker.ts", import.meta.url), {
    type: "module",
  });
  created.onmessage = (ev: MessageEvent<PcmEncodeResponse>) => {
    const data = ev.data;
    if (!data || typeof data.id !== "number") return;
    const row = pending.get(data.id);
    if (!row) return;
    pending.delete(data.id);
    if ("error" in data) row.reject(new Error(data.error || "pcm encode failed"));
    else row.resolve(data.pcm);
  };
  created.onerror = (ev) => {
    rejectAll(new Error(ev.message || "pcm encode worker error"));
  };
  worker = created;
  return created;
}

export function encodePcmChunks(
  chunks: Float32Array[],
  inputRate: number,
  targetRate: number,
): Promise<ArrayBuffer> {
  const id = nextId++;
  // Each chunk owns its buffer exclusively (fresh views from the worklet),
  // so transfer them to the worker without copying.
  const buffers = chunks.map((c) => c.buffer);
  return new Promise<ArrayBuffer>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      const payload: PcmEncodeRequest = { id, chunks: buffers, inputRate, targetRate };
      getWorker().postMessage(payload, buffers);
    } catch (err) {
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export function terminatePcmWorker(): void {
  rejectAll(new Error("pcm encode worker terminated"));
  worker?.terminate();
  worker = null;
}
