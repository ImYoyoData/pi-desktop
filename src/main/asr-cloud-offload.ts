/**
 * Run ASR buffer work on a worker_thread so WAV/base64/fetch/write never
 * block Electron's main process (which freezes every window when jammed).
 */
import { Worker } from "node:worker_threads";
import { join } from "node:path";
import type { AsrCloudConfig } from "../shared/asr";

export type CloudTranscribeJob = {
  pcm: Int16Array;
  sampleRate: number;
  cloud: AsrCloudConfig;
};

type WorkerReply = { ok: true; text?: string } | { ok: false; error: string };

function yieldMain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function workerScriptPath(): string {
  // electron-vite emits this next to the main bundle (see rollup input).
  // worker_threads cannot execute scripts inside app.asar — packaged builds
  // unpack this file (see electron-builder.yml asarUnpack).
  let p = join(__dirname, "asr-cloud-worker.js");
  if (p.includes("app.asar") && !p.includes("app.asar.unpacked")) {
    p = p.replace("app.asar", "app.asar.unpacked");
  }
  return p;
}

function transferablePcm(pcm: Int16Array): ArrayBuffer {
  return pcm.byteOffset === 0 && pcm.byteLength === pcm.buffer.byteLength
    ? pcm.buffer
    : pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
}

function runWorkerJob(payload: Record<string, unknown>, transfer: ArrayBuffer[]): Promise<WorkerReply> {
  return new Promise<WorkerReply>((resolve, reject) => {
    let settled = false;
    const worker = new Worker(workerScriptPath());

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      worker.removeAllListeners();
      void worker.terminate();
      fn();
    };

    worker.on("message", (msg: WorkerReply) => {
      if (!msg || typeof msg !== "object") {
        finish(() => reject(new Error("ASR worker: invalid reply")));
        return;
      }
      finish(() => resolve(msg));
    });
    worker.on("error", (err) => {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    });
    worker.on("exit", (code) => {
      if (settled) return;
      finish(() => reject(new Error(`ASR worker exited (${code})`)));
    });

    worker.postMessage(payload, transfer);
  });
}

/**
 * Off-main cloud transcription. Transfers the PCM ArrayBuffer into the worker
 * so the expensive WAV + base64 work never runs on the UI/main thread.
 */
export async function transcribeViaCloudOffMain(job: CloudTranscribeJob): Promise<string> {
  await yieldMain();

  const { pcm, sampleRate, cloud } = job;
  const ab = transferablePcm(pcm);
  const msg = await runWorkerJob({ kind: "cloud", sampleRate, cloud, pcm: ab }, [ab]);
  if (!msg.ok) throw new Error(msg.error || "cloud ASR failed");
  return typeof msg.text === "string" ? msg.text : "";
}

/**
 * Build + write a WAV file off the main process (local ASR path).
 * Long takes otherwise freeze every window during writeFileSync.
 */
export async function writeWavOffMain(
  filePath: string,
  pcm: Int16Array,
  sampleRate: number,
): Promise<void> {
  await yieldMain();
  const ab = transferablePcm(pcm);
  const msg = await runWorkerJob(
    { kind: "writeWav", path: filePath, sampleRate: sampleRate || 16000, pcm: ab },
    [ab],
  );
  if (!msg.ok) throw new Error(msg.error || "WAV write failed");
}

/** Cooperative yield for light main-process work. */
export { yieldMain as yieldAsrMain };
