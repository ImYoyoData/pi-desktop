/**
 * ASR 缓冲区工作放到 worker_thread，避免 WAV 编码/落盘阻塞主进程。
 * 云端 HTTP 由主进程 netFetch 发送，从而遵循代理设置。
 */
import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { netFetch } from "./net-fetch";
import type { AsrCloudApiStyle, AsrCloudConfig } from "../shared/asr";

export type CloudTranscribeJob = {
  pcm: Int16Array;
  sampleRate: number;
  cloud: AsrCloudConfig;
};

type WorkerReply = { ok: true; wav?: ArrayBuffer } | { ok: false; error: string };

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
  const buffer = pcm.buffer as ArrayBuffer;
  return pcm.byteOffset === 0 && pcm.byteLength === buffer.byteLength
    ? buffer
    : buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
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

function inferCloudApiStyle(cloud: AsrCloudConfig | undefined): AsrCloudApiStyle {
  const style = cloud?.apiStyle;
  if (
    style === "openai-multipart" ||
    style === "openai-json" ||
    style === "chat" ||
    style === "custom"
  ) {
    return style;
  }
  const base = (cloud?.baseUrl ?? "").toLowerCase();
  if (base.includes("mimo") || base.includes("xiaomi")) return "chat";
  return "openai-multipart";
}

function isCloudConfigured(cloud: AsrCloudConfig | undefined): boolean {
  if (!cloud?.apiKey?.trim() || !cloud?.model?.trim()) return false;
  if (cloud.apiStyle === "custom") return Boolean(cloud.endpoint?.trim());
  return Boolean(cloud.baseUrl?.trim());
}

/** 按 API 风格构造云端 ASR 请求体与请求头。 */
function buildCloudAsrRequest(
  cloud: AsrCloudConfig,
  wav: Buffer,
): { url: string; init: RequestInit } {
  const style = inferCloudApiStyle(cloud);
  const apiKey = cloud.apiKey.trim();
  const model = cloud.model.trim();
  const wavBlob = () => new Blob([new Uint8Array(wav)], { type: "audio/wav" });

  let url: string;
  let body: BodyInit;
  const headers: Record<string, string> = {};

  if (style === "custom") {
    url = (cloud.endpoint ?? "").trim();
    if (!url) throw new Error("Cloud ASR: custom endpoint URL is empty");
    const form = new FormData();
    form.append("file", wavBlob(), "audio.wav");
    form.append("model", model);
    body = form;
    headers.Authorization = `Bearer ${apiKey}`;
  } else if (style === "chat") {
    const base = cloud.baseUrl.trim().replace(/\/+$/, "");
    url = `${base}/chat/completions`;
    headers["Content-Type"] = "application/json";
    headers["api-key"] = apiKey;
    headers.Authorization = `Bearer ${apiKey}`;
    const lang = (cloud.language ?? "").trim();
    body = JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: {
                data: `data:audio/wav;base64,${wav.toString("base64")}`,
              },
            },
          ],
        },
      ],
      ...(lang ? { asr_options: { language: lang } } : {}),
    });
  } else {
    const base = cloud.baseUrl.trim().replace(/\/+$/, "");
    url = `${base}/audio/transcriptions`;
    headers.Authorization = `Bearer ${apiKey}`;
    if (style === "openai-json") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({
        file: `data:audio/wav;base64,${wav.toString("base64")}`,
        model,
      });
    } else {
      const form = new FormData();
      form.append("file", wavBlob(), "audio.wav");
      form.append("model", model);
      body = form;
    }
  }
  return { url, init: { method: "POST", headers, body } };
}

async function parseCloudAsrText(resp: Response, style: AsrCloudApiStyle, url: string): Promise<string> {
  if (!resp.ok) {
    const detail = (await resp.text()).trim().slice(0, 240);
    throw new Error(
      `ASR cloud API failed: HTTP ${resp.status} POST ${url}${detail ? ` - ${detail}` : ""}`,
    );
  }
  const data = (await resp.json()) as {
    text?: unknown;
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  if (style === "chat") {
    return typeof data.choices?.[0]?.message?.content === "string"
      ? data.choices[0]!.message!.content!.trim()
      : "";
  }
  return typeof data.text === "string" ? data.text.trim() : "";
}

/**
 * 云端转写：worker 只做 WAV 编码，主进程用 netFetch 发送请求以遵循代理。
 */
export async function transcribeViaCloudOffMain(job: CloudTranscribeJob): Promise<string> {
  await yieldMain();

  const { pcm, sampleRate, cloud } = job;
  if (!isCloudConfigured(cloud)) {
    throw new Error("Cloud ASR is not configured (set endpoint, API key and model)");
  }
  const ab = transferablePcm(pcm);
  const msg = await runWorkerJob({ kind: "encodeWav", sampleRate, pcm: ab }, [ab]);
  if (!msg.ok) throw new Error(msg.error || "cloud ASR failed");
  if (!msg.wav) throw new Error("cloud ASR failed: no wav from worker");

  const wav = Buffer.from(msg.wav);
  const { url, init } = buildCloudAsrRequest(cloud, wav);
  const resp = await netFetch(url, init);
  return parseCloudAsrText(resp, inferCloudApiStyle(cloud), url);
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
