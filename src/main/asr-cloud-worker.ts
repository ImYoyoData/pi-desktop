/**
 * Worker-thread ASR helpers: cloud fetch (WAV/base64) and local WAV write.
 * Keeps expensive buffer work off Electron's main process so the UI never freezes.
 *
 * Jobs (parent → worker via postMessage, transferable PCM):
 *   { kind?: "cloud", sampleRate, cloud, pcm: ArrayBuffer }
 *   { kind: "writeWav", path, sampleRate, pcm: ArrayBuffer }
 * Reply:
 *   { ok: true; text?: string } | { ok: false; error: string }
 */

import { writeFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import type { AsrCloudApiStyle, AsrCloudConfig } from "../shared/asr";

type CloudJob = {
  kind?: "cloud";
  sampleRate: number;
  cloud: AsrCloudConfig;
  pcm: ArrayBuffer;
};

type WriteWavJob = {
  kind: "writeWav";
  path: string;
  sampleRate: number;
  pcm: ArrayBuffer;
};

type Job = CloudJob | WriteWavJob;

type Reply = { ok: true; text?: string } | { ok: false; error: string };

function wavBytesFromPcm(pcm: Int16Array, sampleRate: number): Buffer {
  const dataSize = pcm.byteLength;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buffer, 44);
  return buffer;
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

function cloudAsrLanguage(cloud: AsrCloudConfig): string {
  const explicit = (cloud.language ?? "").trim();
  return explicit;
}

function isCloudConfigured(cloud: AsrCloudConfig | undefined): boolean {
  if (!cloud?.apiKey?.trim() || !cloud?.model?.trim()) return false;
  if (cloud.apiStyle === "custom") return Boolean(cloud.endpoint?.trim());
  return Boolean(cloud.baseUrl?.trim());
}

async function transcribeViaCloudApi(
  pcm: Int16Array,
  sampleRate: number,
  cloud: AsrCloudConfig,
): Promise<string> {
  if (!isCloudConfigured(cloud)) {
    throw new Error("Cloud ASR is not configured (set endpoint, API key and model)");
  }
  const wav = wavBytesFromPcm(pcm, sampleRate || 16000);
  const style = inferCloudApiStyle(cloud);
  const apiKey = cloud.apiKey.trim();
  const model = cloud.model.trim();

  let url: string;
  let body: BodyInit;
  const headers: Record<string, string> = {};

  if (style === "custom") {
    url = (cloud.endpoint ?? "").trim();
    if (!url) throw new Error("Cloud ASR: custom endpoint URL is empty");
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
      "audio.wav",
    );
    form.append("model", model);
    body = form;
    headers.Authorization = `Bearer ${apiKey}`;
  } else if (style === "chat") {
    const base = cloud.baseUrl.trim().replace(/\/+$/, "");
    url = `${base}/chat/completions`;
    headers["Content-Type"] = "application/json";
    headers["api-key"] = apiKey;
    headers.Authorization = `Bearer ${apiKey}`;
    const lang = cloudAsrLanguage(cloud);
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
      form.append(
        "file",
        new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
        "audio.wav",
      );
      form.append("model", model);
      body = form;
    }
  }

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body,
  });
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

function reply(msg: Reply): void {
  parentPort?.postMessage(msg);
}

function pcmView(ab: ArrayBuffer): Int16Array {
  return new Int16Array(ab);
}

parentPort?.on("message", (job: Job) => {
  void (async () => {
    try {
      if (!job?.pcm) throw new Error("ASR worker: missing pcm");
      if (job.kind === "writeWav") {
        if (!job.path) throw new Error("ASR worker: missing wav path");
        const pcm = pcmView(job.pcm);
        writeFileSync(job.path, wavBytesFromPcm(pcm, job.sampleRate || 16000));
        reply({ ok: true });
        return;
      }
      const pcm = pcmView(job.pcm);
      const text = await transcribeViaCloudApi(pcm, job.sampleRate || 16000, job.cloud);
      reply({ ok: true, text });
    } catch (err) {
      reply({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
});
