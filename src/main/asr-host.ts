import { app, BrowserWindow, ipcMain } from "electron";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync, statSync } from "fs";
import { join, dirname } from "path";
import { cpus } from "os";
import { pipeline } from "stream/promises";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { Readable } from "stream";
import { IpcChannels } from "../shared/protocol";
import {
  ASR_BINARY_MB,
  ASR_DISK_MB,
  ASR_MODEL_FILENAME,
  ASR_MODEL_LABEL,
  ASR_MODEL_URL,
  ASR_RAM_MB,
  resolveAsrBinaryAsset,
  type AsrInstallProgress,
  type AsrStatus,
} from "../shared/asr";

const execFileAsync = promisify(execFile);
const PREFS_FILE = "asr-prefs.json";

type Prefs = { enabled: boolean };

let busy = false;
let lastError: string | null = null;
let installAbort: AbortController | null = null;

function asrRoot(): string {
  return join(app.getPath("userData"), "asr");
}

function prefsPath(): string {
  return join(asrRoot(), PREFS_FILE);
}

function modelPath(): string {
  return join(asrRoot(), "models", ASR_MODEL_FILENAME);
}

function runtimeDir(): string {
  return join(asrRoot(), "runtime");
}

function ensureDirs(): void {
  mkdirSync(join(asrRoot(), "models"), { recursive: true });
  mkdirSync(runtimeDir(), { recursive: true });
  mkdirSync(join(asrRoot(), "tmp"), { recursive: true });
}

function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(readFileSync(prefsPath(), "utf8")) as Prefs;
    return { enabled: raw.enabled !== false };
  } catch {
    return { enabled: true };
  }
}

function writePrefs(prefs: Prefs): void {
  ensureDirs();
  writeFileSync(prefsPath(), `${JSON.stringify(prefs, null, 2)}\n`, "utf8");
}

function findBinary(dir: string, names: string[]): string | null {
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(cur, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (names.some((n) => name === n || name.toLowerCase() === n.toLowerCase())) {
        return full;
      }
    }
  }
  // Also match crispasr* executables
  const stack2 = [dir];
  while (stack2.length) {
    const cur = stack2.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(cur, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack2.push(full);
        continue;
      }
      const lower = name.toLowerCase();
      if (lower.startsWith("crispasr") && (lower.endsWith(".exe") || !lower.includes("."))) {
        return full;
      }
    }
  }
  return null;
}

function resolvedBinary(): string | null {
  const asset = resolveAsrBinaryAsset(process.platform, process.arch);
  if (!asset) return null;
  if (!existsSync(runtimeDir())) return null;
  return findBinary(runtimeDir(), asset.binaryNames);
}

function getStatus(): AsrStatus {
  const prefs = readPrefs();
  const asset = resolveAsrBinaryAsset(process.platform, process.arch);
  const bin = resolvedBinary();
  const model = modelPath();
  const installed = Boolean(bin && existsSync(model));
  return {
    enabled: prefs.enabled,
    supported: Boolean(asset),
    installed,
    modelPath: existsSync(model) ? model : null,
    binaryPath: bin,
    diskMb: ASR_DISK_MB,
    ramMb: ASR_RAM_MB,
    binaryMb: ASR_BINARY_MB,
    modelLabel: ASR_MODEL_LABEL,
    busy,
    lastError,
  };
}

function broadcastProgress(progress: AsrInstallProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.asr.progress, progress);
  }
}

function estimatePhaseBytes(phase: "binary" | "model"): number {
  if (phase === "binary") return ASR_BINARY_MB * 1024 * 1024;
  return Math.max(ASR_DISK_MB - ASR_BINARY_MB, 500) * 1024 * 1024;
}

async function downloadFile(
  url: string,
  dest: string,
  phase: "binary" | "model",
  signal: AbortSignal,
): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  broadcastProgress({
    phase,
    receivedBytes: 0,
    totalBytes: estimatePhaseBytes(phase),
    message: phase === "model" ? "Downloading ASR model…" : "Downloading ASR runtime…",
  });
  const res = await fetch(url, { signal, redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}): ${url}`);
  }
  const headerTotal = Number(res.headers.get("content-length") || 0);
  let totalBytes = headerTotal > 0 ? headerTotal : estimatePhaseBytes(phase);
  let received = 0;
  let lastEmit = 0;
  const reader = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
  const out = createWriteStream(tmp);
  const emit = (force = false): void => {
    const now = Date.now();
    if (!force && now - lastEmit < 100) return;
    lastEmit = now;
    if (received > totalBytes) totalBytes = Math.ceil(received * 1.05);
    broadcastProgress({
      phase,
      receivedBytes: received,
      totalBytes,
      message: phase === "model" ? "Downloading ASR model…" : "Downloading ASR runtime…",
    });
  };
  reader.on("data", (chunk: Buffer) => {
    received += chunk.length;
    emit();
  });
  await pipeline(reader, out);
  emit(true);
  rmSync(dest, { force: true });
  renameSync(tmp, dest);
}

async function extractArchive(archivePath: string, destDir: string, kind: "zip" | "tar.gz"): Promise<void> {
  mkdirSync(destDir, { recursive: true });
  broadcastProgress({
    phase: "extract",
    receivedBytes: 0,
    totalBytes: null,
    message: "Extracting ASR runtime…",
  });
  if (process.platform === "win32" && kind === "zip") {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
      ],
      { windowsHide: true },
    );
    return;
  }
  if (kind === "tar.gz") {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", destDir]);
    return;
  }
  if (kind === "zip") {
    await execFileAsync("tar", ["-xf", archivePath, "-C", destDir]);
    return;
  }
  throw new Error(`Unsupported archive: ${kind}`);
}

async function installAsr(): Promise<AsrStatus> {
  if (busy) throw new Error("ASR install already in progress");
  const asset = resolveAsrBinaryAsset(process.platform, process.arch);
  if (!asset) throw new Error("ASR is not supported on this platform");

  busy = true;
  lastError = null;
  installAbort = new AbortController();
  const signal = installAbort.signal;
  ensureDirs();
  broadcastProgress({
    phase: "binary",
    receivedBytes: 0,
    totalBytes: estimatePhaseBytes("binary"),
    message: "Starting ASR install…",
  });

  try {
    // Runtime binary
    if (!resolvedBinary()) {
      const archivePath = join(asrRoot(), `runtime-download.${asset.archive === "zip" ? "zip" : "tar.gz"}`);
      await downloadFile(asset.url, archivePath, "binary", signal);
      // clean previous extract
      rmSync(runtimeDir(), { recursive: true, force: true });
      mkdirSync(runtimeDir(), { recursive: true });
      await extractArchive(archivePath, runtimeDir(), asset.archive);
      rmSync(archivePath, { force: true });
      const bin = resolvedBinary();
      if (!bin) throw new Error("ASR binary not found after extract");
      try {
        chmodSync(bin, 0o755);
      } catch {
        // windows
      }
    }

    // Model
    if (!existsSync(modelPath())) {
      await downloadFile(ASR_MODEL_URL, modelPath(), "model", signal);
    }

    broadcastProgress({
      phase: "done",
      receivedBytes: 0,
      totalBytes: null,
      message: "ASR ready",
    });
    return getStatus();
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    broadcastProgress({
      phase: "error",
      receivedBytes: 0,
      totalBytes: null,
      message: lastError,
    });
    throw err;
  } finally {
    busy = false;
    installAbort = null;
  }
}

async function uninstallAsr(): Promise<AsrStatus> {
  ensureDirs();
  rmSync(join(asrRoot(), "models"), { recursive: true, force: true });
  rmSync(runtimeDir(), { recursive: true, force: true });
  mkdirSync(join(asrRoot(), "models"), { recursive: true });
  mkdirSync(runtimeDir(), { recursive: true });
  lastError = null;
  return getStatus();
}

function writeWavPcm16(filePath: string, pcm: Int16Array, sampleRate: number): void {
  const dataSize = pcm.byteLength;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buffer, 44);
  writeFileSync(filePath, buffer);
}

async function transcribePcm(pcmBase64: string, sampleRate: number): Promise<string> {
  const prefs = readPrefs();
  if (!prefs.enabled) throw new Error("ASR is disabled in settings");
  const status = getStatus();
  if (!status.installed || !status.binaryPath || !status.modelPath) {
    throw new Error("ASR model is not installed");
  }
  if (busy) throw new Error("ASR is busy");

  busy = true;
  lastError = null;
  const wavPath = join(asrRoot(), "tmp", `utt-${Date.now()}.wav`);
  try {
    const raw = Buffer.from(pcmBase64, "base64");
    const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
    writeWavPcm16(wavPath, pcm, sampleRate || 16000);

    const args = [
      "--backend",
      "qwen3",
      "-m",
      status.modelPath,
      "-f",
      wavPath,
      "-t",
      String(Math.max(2, Math.min(8, cpus().length || 4))),
    ];

    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(status.binaryPath!, args, {
        windowsHide: true,
        env: { ...process.env },
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => {
        out += String(d);
      });
      child.stderr.on("data", (d) => {
        err += String(d);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve({ stdout: out, stderr: err });
        else reject(new Error(err.trim() || out.trim() || `ASR exited with code ${code}`));
      });
    });

    const text = pickTranscript(stdout, stderr);
    if (!text) throw new Error("ASR returned empty transcript");
    return text;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    busy = false;
    try {
      rmSync(wavPath, { force: true });
    } catch {
      // ignore
    }
  }
}

function pickTranscript(stdout: string, stderr: string): string {
  const combined = `${stdout}\n${stderr}`.replace(/\r/g, "");
  const lines = combined
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // Prefer lines that look like speech text (not logs)
  const candidates = lines.filter(
    (l) =>
      !/^(\[|INFO|WARN|ERROR|loading|ggml|llama|whisper|mel|encode|decode|tokens|system)/i.test(l) &&
      !/^\d+(\.\d+)?(ms|s|%|MB)/i.test(l) &&
      l.length > 1,
  );
  if (candidates.length) return candidates[candidates.length - 1]!;
  return stdout.trim();
}

export function registerAsrIpc(): void {
  ensureDirs();

  ipcMain.handle(IpcChannels.asr.status, () => getStatus());
  ipcMain.handle(IpcChannels.asr.setEnabled, (_e, enabled: boolean) => {
    writePrefs({ enabled: Boolean(enabled) });
    return getStatus();
  });
  ipcMain.handle(IpcChannels.asr.install, async () => installAsr());
  ipcMain.handle(IpcChannels.asr.uninstall, async () => uninstallAsr());
  ipcMain.handle(
    IpcChannels.asr.transcribe,
    async (_e, payload: { pcmBase64: string; sampleRate: number }) => {
      return transcribePcm(payload.pcmBase64, payload.sampleRate);
    },
  );
}
