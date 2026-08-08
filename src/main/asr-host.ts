import { app, BrowserWindow, dialog, globalShortcut, ipcMain } from "electron";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  chmodSync,
  statSync,
} from "fs";
import { join, dirname, basename } from "path";
import { cpus } from "os";
import { pipeline } from "stream/promises";
import { spawn, execFile, execFileSync, type ChildProcessWithoutNullStreams } from "child_process";
import { promisify } from "util";
import { Readable } from "stream";
import { IpcChannels } from "../shared/protocol";
import {
  ASR_BINARY_MB,
  ASR_DISK_MB,
  ASR_MODEL_FILENAME,
  ASR_MODEL_LABEL,
  ASR_RAM_MB,
  asrDownloadSourceHost,
  asrModelUrlsForMirror,
  assertAsrGgufPath,
  assertAsrRuntimeArchivePath,
  asrRuntimeArchiveName,
  expandAsrDownloadUrls,
  normalizeAsrDownloadMirror,
  normalizeAsrModelUrl,
  resolveAsrBinaryAsset,
  scrubAsrHallucination,
  type AsrDownloadMirror,
  type AsrGpuBackend,
  type AsrGpuOption,
  type AsrInstallProgress,
  type AsrStatus,
  type AsrStreamEvent,
  type AsrBackendKind,
  type AsrCloudConfig,
  type AsrTranscribePayload,
} from "../shared/asr";
import {
  detectAsrGpuInfo,
  enumerateAsrGpuOptions,
  isAsrDiagnosticOnlyMessage,
  isAsrNativeCrashExitCode,
  parseAsrExitCode,
  resolveAsrGpuPreference,
  type AsrGpuInfo,
} from "./asr-gpu";
import { DEFAULT_ASR_WAKE_HOTKEY, normalizeAccelerator } from "../shared/hotkey";
import { DEFAULT_ASR_WAKE_WORDS } from "../shared/asr-wake";

const execFileAsync = promisify(execFile);
const PREFS_FILE = "asr-prefs.json";
const BACKEND_MARKER = ".backend";

type Prefs = {
  enabled: boolean;
  /**
   * After a CUDA native crash (AV / missing DLL), stick to Vulkan until the user
   * re-downloads runtime or explicitly selects CUDA again.
   */
  disableCuda?: boolean;
  /** "auto" | "cuda" | "cpu" | "metal" | "vulkan:<id>" */
  gpuPreference?: string;
  /** Prefer China vs international download mirrors. */
  downloadMirror?: AsrDownloadMirror;
  /** Electron accelerator for wake / start voice recording. */
  wakeHotkey?: string;
  /** Keep the model preloaded in memory (no mic / no wake listening). */
  residentModel?: boolean;
  /** Always-on voice wake-word listening (separate from model resident). */
  wakeEnabled?: boolean;
  /** Raw wake-word list (comma / newline separated). */
  wakeWords?: string;
};

/** Currently registered wake accelerator (for unregister on change). */
let registeredWakeHotkey: string | null = null;

/** Install/import only — must NOT gate the install UI via transcription. */
let installBusy = false;
/** Chains withInstallLock callers so concurrent IPC waits instead of throwing. */
let installQueue: Promise<void> = Promise.resolve();
/** Transcription job lock. */
let inferBusy = false;
/** Long-lived CrispASR `--stream` session. */
let streamChild: ChildProcessWithoutNullStreams | null = null;
let streamStdoutBuf = "";
let streamReady = false;
let streamStderrTail = "";
let lastError: string | null = null;
let installAbort: AbortController | null = null;
let cachedGpuInfo: AsrGpuInfo | null = null;

/** Stable token so renderer can suppress error toasts on user cancel. */
const ASR_INSTALL_CANCELLED = "ASR_INSTALL_CANCELLED";

function throwIfInstallAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error(ASR_INSTALL_CANCELLED);
}

/** True only for explicit user cancel (install AbortSignal), not mirror stall aborts. */
function isInstallCancelledError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (!(err instanceof Error)) return false;
  return /ASR_INSTALL_CANCELLED/i.test(err.message);
}

function cancelAsrInstall(): { ok: boolean } {
  if (!installAbort) return { ok: false };
  installAbort.abort();
  return { ok: true };
}

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

/** Cloud ASR backend prefs (~/.pi/agent/asr-cloud.json). */
type AsrCloudPrefs = {
  backend?: AsrBackendKind;
  cloud?: AsrCloudConfig;
};

function cloudPrefsPath(): string {
  return join(asrRoot(), "asr-cloud.json");
}

function readCloudPrefs(): AsrCloudPrefs {
  try {
    const parsed = JSON.parse(readFileSync(cloudPrefsPath(), "utf8")) as Partial<AsrCloudPrefs>;
    return {
      backend: parsed.backend === "local" || parsed.backend === "cloud" ? parsed.backend : null,
      cloud: parsed.cloud && typeof parsed.cloud === "object" ? parsed.cloud : undefined,
    };
  } catch {
    return {};
  }
}

function writeCloudPrefs(prefs: AsrCloudPrefs): void {
  writeFileSync(cloudPrefsPath(), `${JSON.stringify(prefs, null, 2)}\n`, "utf8");
}

/**
 * Pick a concrete API style for a cloud ASR config.
 *
 * Older saved configs predate the format selector and have no apiStyle;
 * Xiaomi MiMo has no /audio/transcriptions endpoint, so route it to the
 * chat-completions + input_audio style automatically.
 */
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
  if (/xiaomimimo\.com/.test(base)) return "chat";
  return "openai-multipart";
}

/**
 * Language hint for chat-style ASR (e.g. Xiaomi MiMo). MiMo docs
 * recommend pinning the language for better accuracy; default to zh when
 * the app locale is Chinese, otherwise leave auto-detection on.
 */
function cloudAsrLanguage(cloud: AsrCloudConfig): string {
  const explicit = (cloud.language ?? "").trim();
  if (explicit) return explicit;
  try {
    return app.getLocale().toLowerCase().startsWith("zh") ? "zh" : "";
  } catch {
    return "";
  }
}

function isCloudConfigured(cloud: AsrCloudConfig | undefined): boolean {
  if (!cloud?.apiKey?.trim() || !cloud?.model?.trim()) return false;
  if (cloud.apiStyle === "custom") return Boolean(cloud.endpoint?.trim());
  // chat (MiMo) and openai-* styles all need a base URL; language is optional.
  return Boolean(cloud.baseUrl?.trim());
}

function ensureDirs(): void {
  mkdirSync(join(asrRoot(), "models"), { recursive: true });
  mkdirSync(runtimeDir(), { recursive: true });
  mkdirSync(join(asrRoot(), "tmp"), { recursive: true });
  cleanupLegacyAsrModels();
}

/**
 * Remove model files from superseded local ASR backends so a model switch
 * does not leave hundreds of MB orphaned on disk. Only known legacy names.
 */
function cleanupLegacyAsrModels(): void {
  const legacyNames = ["qwen3-asr-0.6b-q4_k.gguf", "qwen3-asr-0.6b-q4_k"] as const;
  for (const name of legacyNames) {
    try {
      const target = join(asrRoot(), "models", name);
      if (existsSync(target)) rmSync(target, { force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(readFileSync(prefsPath(), "utf8")) as Prefs;
    const pref =
      typeof raw.gpuPreference === "string" && raw.gpuPreference.trim()
        ? raw.gpuPreference.trim()
        : "auto";
    const wake =
      normalizeAccelerator(typeof raw.wakeHotkey === "string" ? raw.wakeHotkey : "") ||
      DEFAULT_ASR_WAKE_HOTKEY;
    const wakeWords =
      typeof raw.wakeWords === "string" ? raw.wakeWords : DEFAULT_ASR_WAKE_WORDS;
    return {
      enabled: raw.enabled !== false,
      disableCuda: Boolean(raw.disableCuda),
      gpuPreference: pref,
      downloadMirror: normalizeAsrDownloadMirror(raw.downloadMirror),
      wakeHotkey: wake,
      residentModel: raw.residentModel !== false,
      wakeEnabled: Boolean(raw.wakeEnabled),
      wakeWords,
    };
  } catch {
    return {
      enabled: true,
      gpuPreference: "auto",
      downloadMirror: "auto",
      wakeHotkey: DEFAULT_ASR_WAKE_HOTKEY,
      residentModel: true,
      wakeEnabled: false,
      wakeWords: DEFAULT_ASR_WAKE_WORDS,
    };
  }
}

function writePrefs(prefs: Prefs): void {
  ensureDirs();
  const wake =
    normalizeAccelerator(prefs.wakeHotkey || "") || DEFAULT_ASR_WAKE_HOTKEY;
  const wakeWords =
    typeof prefs.wakeWords === "string" ? prefs.wakeWords : DEFAULT_ASR_WAKE_WORDS;
  writeFileSync(
    prefsPath(),
    `${JSON.stringify(
      {
        enabled: prefs.enabled,
        disableCuda: Boolean(prefs.disableCuda),
        gpuPreference: prefs.gpuPreference || "auto",
        downloadMirror: normalizeAsrDownloadMirror(prefs.downloadMirror),
        wakeHotkey: wake,
        residentModel: Boolean(prefs.residentModel),
        wakeWords,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function wakeHotkeyFromPrefs(): string {
  return readPrefs().wakeHotkey || DEFAULT_ASR_WAKE_HOTKEY;
}

function broadcastWake(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send(IpcChannels.asr.wake);
  }
}

function unregisterWakeHotkey(): void {
  if (registeredWakeHotkey) {
    try {
      globalShortcut.unregister(registeredWakeHotkey);
    } catch {
      // ignore
    }
    registeredWakeHotkey = null;
  }
}

/** Register (or re-register) the global ASR wake shortcut. Returns false if taken/invalid. */
function registerWakeHotkey(accel?: string): boolean {
  const next = normalizeAccelerator(accel || wakeHotkeyFromPrefs()) || DEFAULT_ASR_WAKE_HOTKEY;
  unregisterWakeHotkey();
  try {
    const ok = globalShortcut.register(next, () => {
      broadcastWake();
    });
    if (!ok) return false;
    registeredWakeHotkey = next;
    return true;
  } catch {
    return false;
  }
}

function setWakeHotkey(raw: string): AsrStatus {
  const next = normalizeAccelerator(raw);
  if (!next) throw new Error("Invalid hotkey");
  const prefs = readPrefs();
  if (!registerWakeHotkey(next)) {
    // Restore previous registration
    registerWakeHotkey(prefs.wakeHotkey || DEFAULT_ASR_WAKE_HOTKEY);
    throw new Error("Hotkey already in use");
  }
  writePrefs({
    ...prefs,
    wakeHotkey: next,
  });
  return getStatus();
}

function setResidentModel(enabled: boolean): AsrStatus {
  const prefs = readPrefs();
  writePrefs({
    ...prefs,
    residentModel: Boolean(enabled),
  });
  return getStatus();
}

function setWakeWords(raw: string): AsrStatus {
  const prefs = readPrefs();
  writePrefs({
    ...prefs,
    wakeWords: typeof raw === "string" ? raw : DEFAULT_ASR_WAKE_WORDS,
  });
  return getStatus();
}

function clearCudaDisable(): void {
  const prefs = readPrefs();
  if (!prefs.disableCuda) return;
  writePrefs({
    ...prefs,
    disableCuda: false,
  });
  cachedGpuInfo = null;
}

/** When CUDA was blacklisted, expose Vulkan as the effective preference (auto/cuda only). */
function applyCudaPolicy(info: AsrGpuInfo, preference: string): AsrGpuInfo {
  if (info.backend !== "cuda" || !readPrefs().disableCuda) return info;
  // Explicit user pick of CUDA overrides the crash blacklist.
  if (preference === "cuda") return info;
  return {
    backend: "vulkan",
    deviceLabel: /vulkan/i.test(info.deviceLabel)
      ? info.deviceLabel
      : `${info.deviceLabel} · Vulkan`,
    kind: info.kind === "cpu" ? "discrete" : info.kind,
    vulkanDeviceId: info.vulkanDeviceId,
  };
}

function gpuInfo(): AsrGpuInfo {
  if (!cachedGpuInfo) {
    const prefs = readPrefs();
    const pref = prefs.gpuPreference || "auto";
    cachedGpuInfo = applyCudaPolicy(resolveAsrGpuPreference(pref), pref);
  }
  return cachedGpuInfo;
}

function localizedGpuOptions(): AsrGpuOption[] {
  return enumerateAsrGpuOptions().map((opt) => {
    if (opt.id === "auto") return { ...opt, label: "Auto" };
    if (opt.id === "cpu") return { ...opt, label: "CPU" };
    return opt;
  });
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

function preferredGpuBackend(): AsrGpuBackend {
  return gpuInfo().backend;
}

function backendMarkerPath(): string {
  return join(runtimeDir(), BACKEND_MARKER);
}

function installedBackend(): AsrGpuBackend | null {
  try {
    const raw = readFileSync(backendMarkerPath(), "utf8").trim().toLowerCase();
    if (raw === "cuda" || raw === "vulkan" || raw === "metal" || raw === "cpu") return raw;
  } catch {
    // legacy installs without marker
  }
  return null;
}

function resolvedBinary(): string | null {
  const backend = preferredGpuBackend();
  const asset = resolveAsrBinaryAsset(process.platform, process.arch, backend);
  if (!asset) return null;
  if (!existsSync(runtimeDir())) return null;
  return findBinary(runtimeDir(), asset.binaryNames);
}

function runtimeMatchesBackend(backend: AsrGpuBackend): boolean {
  if (!resolvedBinary()) return false;
  const marker = installedBackend();
  // Legacy installs without marker count as CPU-only
  if (!marker) return backend === "cpu";
  return marker === backend;
}

function runtimeMatchesPreferred(): boolean {
  return runtimeMatchesBackend(preferredGpuBackend());
}

function getStatus(): AsrStatus {
  const prefs = readPrefs();
  const backend = preferredGpuBackend();
  const asset = resolveAsrBinaryAsset(process.platform, process.arch, backend);
  const bin = resolvedBinary();
  const model = modelPath();
  const matches = runtimeMatchesPreferred();
  const installed = Boolean(bin && existsSync(model) && matches);
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
    installing: installBusy,
    busy: inferBusy || Boolean(streamChild),
    gpuBackend: backend,
    gpuDeviceLabel: gpuInfo().deviceLabel,
    gpuKind: gpuInfo().kind,
    gpuPreference: prefs.gpuPreference || "auto",
    gpuOptions: localizedGpuOptions(),
    runtimeMatchesPreference: matches,
    runtimeArchiveHint: asrRuntimeArchiveName(process.platform, process.arch, backend),
    downloadMirror: normalizeAsrDownloadMirror(prefs.downloadMirror),
    wakeHotkey: prefs.wakeHotkey || DEFAULT_ASR_WAKE_HOTKEY,
    residentModel: Boolean(prefs.residentModel),
    wakeEnabled: Boolean(prefs.wakeEnabled),
    wakeWords: prefs.wakeWords ?? DEFAULT_ASR_WAKE_WORDS,
    lastError,
    backend: readCloudPrefs().backend ?? null,
    cloudConfigured: isCloudConfigured(readCloudPrefs().cloud),
  };
}

function setGpuPreference(preference: string): AsrStatus {
  const prefs = readPrefs();
  const next = typeof preference === "string" && preference.trim() ? preference.trim() : "auto";
  const options = enumerateAsrGpuOptions();
  const allowed = new Set(options.map((o) => o.id));
  if (!allowed.has(next)) {
    throw new Error(`Unknown GPU preference: ${next}`);
  }
  // Explicit CUDA selection clears crash blacklist.
  const disableCuda = next === "cuda" ? false : prefs.disableCuda;
  writePrefs({
    ...prefs,
    disableCuda,
    gpuPreference: next,
  });
  cachedGpuInfo = null;
  return getStatus();
}

function setDownloadMirror(mirror: string): AsrStatus {
  const prefs = readPrefs();
  writePrefs({
    ...prefs,
    downloadMirror: normalizeAsrDownloadMirror(mirror),
  });
  return getStatus();
}

function currentDownloadMirror(): AsrDownloadMirror {
  return normalizeAsrDownloadMirror(readPrefs().downloadMirror);
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

/** ASCII error token — localized in renderer (avoids Windows console mojibake). */
function downloadErrorMessage(err: unknown, url: string): string {
  const cause =
    err && typeof err === "object" && "cause" in err
      ? (err as { cause?: { code?: string; message?: string } }).cause
      : undefined;
  const code = cause?.code ?? "";
  const detail = cause?.message || (err instanceof Error ? err.message : String(err));
  const kind =
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    /fetch failed|timed? ?out|ECONNREFUSED|ENOTFOUND/i.test(detail)
      ? "timeout"
      : "failed";
  return `ASR_DOWNLOAD_${kind.toUpperCase()}|${url}|${code || detail}`;
}

/** GitHub release URLs often need mirrors from CN networks. */
function expandDownloadUrls(urls: readonly string[]): string[] {
  return expandAsrDownloadUrls(urls, currentDownloadMirror(), app.getLocale());
}

/** No first byte / stalled transfer → switch mirror. */
const DOWNLOAD_STALL_MS = 8_000;
/** After this window, require a minimum of bytes or treat the mirror as too slow. */
const DOWNLOAD_SLOW_CHECK_MS = 6_000;
const DOWNLOAD_SLOW_MIN_BYTES = 256 * 1024;

function isSlowDownloadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /ASR_DOWNLOAD_SLOW\|/i.test(msg);
}

async function downloadOnce(
  url: string,
  dest: string,
  phase: "binary" | "model",
  signal: AbortSignal,
): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  rmSync(tmp, { force: true });
  const host = asrDownloadSourceHost(url);
  const phaseLabel = phase === "model" ? "Downloading ASR model…" : "Downloading ASR runtime…";
  broadcastProgress({
    phase,
    receivedBytes: 0,
    totalBytes: estimatePhaseBytes(phase),
    message: host ? `${phaseLabel} (${host})` : phaseLabel,
    sourceHost: host || null,
  });

  const local = new AbortController();
  const onParentAbort = (): void => local.abort();
  if (signal.aborted) throw new Error(ASR_INSTALL_CANCELLED);
  signal.addEventListener("abort", onParentAbort, { once: true });

  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let slowTimer: ReturnType<typeof setTimeout> | null = null;
  let received = 0;
  let markedSlow = false;

  const clearTimers = (): void => {
    if (stallTimer) clearTimeout(stallTimer);
    if (slowTimer) clearTimeout(slowTimer);
    stallTimer = null;
    slowTimer = null;
  };

  const armStall = (): void => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      markedSlow = true;
      local.abort();
    }, DOWNLOAD_STALL_MS);
  };

  try {
    armStall();
    slowTimer = setTimeout(() => {
      if (received < DOWNLOAD_SLOW_MIN_BYTES) {
        markedSlow = true;
        local.abort();
      }
    }, DOWNLOAD_SLOW_CHECK_MS);

    const res = await fetch(url, {
      signal: local.signal,
      redirect: "follow",
      headers: {
        // Some CDNs reject empty / electron default agents
        "User-Agent": `pi-desktop-asr/${app.getVersion()}`,
        Accept: "*/*",
      },
    });
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}`);
    }
    const headerTotal = Number(res.headers.get("content-length") || 0);
    let totalBytes = headerTotal > 0 ? headerTotal : estimatePhaseBytes(phase);
    let lastEmit = 0;
    const reader = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
    const out = createWriteStream(tmp, { highWaterMark: 1024 * 1024 });
    const emit = (force = false): void => {
      const now = Date.now();
      if (!force && now - lastEmit < 100) return;
      lastEmit = now;
      if (received > totalBytes) totalBytes = Math.ceil(received * 1.05);
      broadcastProgress({
        phase,
        receivedBytes: received,
        totalBytes,
        message: host ? `${phaseLabel} (${host})` : phaseLabel,
        sourceHost: host || null,
      });
    };
    reader.on("data", (chunk: Buffer) => {
      received += chunk.length;
      armStall();
      if (received >= DOWNLOAD_SLOW_MIN_BYTES && slowTimer) {
        clearTimeout(slowTimer);
        slowTimer = null;
      }
      emit();
    });
    try {
      await pipeline(reader, out);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }
    emit(true);
    if (received <= 0) {
      rmSync(tmp, { force: true });
      throw new Error("empty download");
    }
    rmSync(dest, { force: true });
    renameSync(tmp, dest);
  } catch (err) {
    // Mirror stall/slow uses local.abort() → AbortError; that is NOT user cancel.
    if (signal.aborted) {
      throw new Error(ASR_INSTALL_CANCELLED);
    }
    if (markedSlow || local.signal.aborted) {
      throw new Error(`ASR_DOWNLOAD_SLOW|${url}`);
    }
    if (isInstallCancelledError(err, signal)) {
      throw new Error(ASR_INSTALL_CANCELLED);
    }
    throw err;
  } finally {
    clearTimers();
    signal.removeEventListener("abort", onParentAbort);
  }
}

/** Try each URL until one succeeds; skip slow mirrors quickly. */
async function downloadFile(
  urls: string | readonly string[],
  dest: string,
  phase: "binary" | "model",
  signal: AbortSignal,
): Promise<void> {
  const list = expandDownloadUrls(Array.isArray(urls) ? [...urls] : [urls]);
  let lastErr: unknown;
  let lastUrl = list[list.length - 1] ?? "";
  for (const url of list) {
    lastUrl = url;
    throwIfInstallAborted(signal);
    try {
      await downloadOnce(url, dest, phase, signal);
      return;
    } catch (err) {
      lastErr = err;
      if (isInstallCancelledError(err, signal)) throw new Error(ASR_INSTALL_CANCELLED);
      // Slow / stalled mirrors: jump to the next candidate immediately.
      if (isSlowDownloadError(err)) continue;
      // One quick retry for transient mid-transfer failures on the same URL.
      throwIfInstallAborted(signal);
      try {
        await new Promise((r) => setTimeout(r, 300));
        await downloadOnce(url, dest, phase, signal);
        return;
      } catch (retryErr) {
        lastErr = retryErr;
        if (isInstallCancelledError(retryErr, signal)) throw new Error(ASR_INSTALL_CANCELLED);
        if (isSlowDownloadError(retryErr)) continue;
      }
    }
  }
  throw new Error(downloadErrorMessage(lastErr, lastUrl));
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

async function installRuntimeBackend(backend: AsrGpuBackend, signal: AbortSignal): Promise<void> {
  const asset = resolveAsrBinaryAsset(process.platform, process.arch, backend);
  if (!asset) throw new Error(`ASR runtime not available for ${backend}`);

  broadcastProgress({
    phase: "binary",
    receivedBytes: 0,
    totalBytes: estimatePhaseBytes("binary"),
    message: `Downloading ASR runtime (${backend})…`,
  });
  const archivePath = join(asrRoot(), `runtime-download.${asset.archive === "zip" ? "zip" : "tar.gz"}`);
  await downloadFile(asset.url, archivePath, "binary", signal);
  throwIfInstallAborted(signal);
  rmSync(runtimeDir(), { recursive: true, force: true });
  mkdirSync(runtimeDir(), { recursive: true });
  await extractArchive(archivePath, runtimeDir(), asset.archive);
  rmSync(archivePath, { force: true });
  writeFileSync(backendMarkerPath(), `${asset.backend}\n`, "utf8");
  ensureRuntimeExecutables();
  const bin = resolvedBinary();
  if (!bin) throw new Error("ASR binary not found after extract");
  try {
    chmodSync(bin, 0o755);
  } catch {
    // windows
  }
}

async function ensureRuntime(signal: AbortSignal): Promise<void> {
  const preferred = preferredGpuBackend();
  if (!resolveAsrBinaryAsset(process.platform, process.arch, preferred)) {
    throw new Error("ASR is not supported on this platform");
  }
  if (runtimeMatchesPreferred()) return;

  // Prefer GPU build; if GitHub/mirrors fail, fall back so voice still works (slower).
  const candidates: AsrGpuBackend[] = [];
  const add = (b: AsrGpuBackend): void => {
    if (!candidates.includes(b) && resolveAsrBinaryAsset(process.platform, process.arch, b)) {
      candidates.push(b);
    }
  };
  add(preferred);
  if (preferred === "cuda") add("vulkan");
  if (preferred !== "cpu") add("cpu");

  let lastErr: unknown;
  for (const backend of candidates) {
    if (runtimeMatchesBackend(backend)) {
      if (backend !== preferred) {
        cachedGpuInfo = {
          backend,
          deviceLabel: backend === "cpu" ? "CPU (fallback)" : gpuInfo().deviceLabel,
          kind: backend === "cpu" ? "cpu" : gpuInfo().kind,
        };
      }
      return;
    }
    try {
      await installRuntimeBackend(backend, signal);
      if (backend !== preferred) {
        cachedGpuInfo = {
          backend,
          deviceLabel: backend === "cpu" ? "CPU (fallback)" : gpuInfo().deviceLabel,
          kind: backend === "cpu" ? "cpu" : gpuInfo().kind,
        };
      }
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "ASR runtime install failed"));
}

async function withInstallLock(run: (signal: AbortSignal) => Promise<AsrStatus>): Promise<AsrStatus> {
  const backend = preferredGpuBackend();
  if (!resolveAsrBinaryAsset(process.platform, process.arch, backend)) {
    throw new Error("ASR is not supported on this platform");
  }

  // Serialize install/reinstall so concurrent IPC (voice warm + confirm) cannot race.
  const prev = installQueue;
  let releaseQueue!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  installQueue = prev.then(() => gate, () => gate);
  await prev.catch(() => undefined);

  installBusy = true;
  lastError = null;
  installAbort = new AbortController();
  const signal = installAbort.signal;
  ensureDirs();
  broadcastProgress({
    phase: "binary",
    receivedBytes: 0,
    totalBytes: estimatePhaseBytes("binary"),
    message: `Starting ASR install (${backend})…`,
  });

  try {
    const status = await run(signal);
    broadcastProgress({
      phase: "done",
      receivedBytes: 0,
      totalBytes: null,
      message: "ASR ready",
    });
    return status;
  } catch (err) {
    if (isInstallCancelledError(err, signal)) {
      lastError = null;
      broadcastProgress({
        phase: "error",
        receivedBytes: 0,
        totalBytes: null,
        message: ASR_INSTALL_CANCELLED,
      });
      throw new Error(ASR_INSTALL_CANCELLED);
    }
    lastError = err instanceof Error ? err.message : String(err);
    broadcastProgress({
      phase: "error",
      receivedBytes: 0,
      totalBytes: null,
      message: lastError,
    });
    throw err;
  } finally {
    installBusy = false;
    installAbort = null;
    releaseQueue();
  }
}

async function installAsr(): Promise<AsrStatus> {
  return withInstallLock(async (signal) => {
    await ensureRuntime(signal);
    // Model (mirror order follows downloadMirror preference)
    if (!existsSync(modelPath())) {
      await downloadFile(
        asrModelUrlsForMirror(currentDownloadMirror(), app.getLocale()),
        modelPath(),
        "model",
        signal,
      );
    }
    return getStatus();
  });
}

async function installAsrFromUrl(url: string): Promise<AsrStatus> {
  const normalized = normalizeAsrModelUrl(url);
  return withInstallLock(async (signal) => {
    await ensureRuntime(signal);
    await downloadFile([normalized], modelPath(), "model", signal);
    return getStatus();
  });
}

async function importAsrModel(sourcePath: string): Promise<AsrStatus> {
  assertAsrGgufPath(sourcePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`Model file not found: ${sourcePath}`);
  }
  const st = statSync(sourcePath);
  if (!st.isFile() || st.size <= 0) {
    throw new Error("Invalid model file");
  }

  return withInstallLock(async (signal) => {
    await ensureRuntime(signal);
    broadcastProgress({
      phase: "model",
      receivedBytes: 0,
      totalBytes: st.size,
      message: `Importing ${basename(sourcePath)}…`,
    });
    const dest = modelPath();
    const tmp = `${dest}.part`;
    rmSync(tmp, { force: true });
    copyFileSync(sourcePath, tmp);
    rmSync(dest, { force: true });
    renameSync(tmp, dest);
    broadcastProgress({
      phase: "model",
      receivedBytes: st.size,
      totalBytes: st.size,
      message: "Local model imported",
    });
    return getStatus();
  });
}

async function pickAsrModelFile(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const opts = {
    title: "Select SenseVoiceSmall GGUF model",
    properties: ["openFile" as const],
    filters: [{ name: "GGUF model", extensions: ["gguf"] }],
  };
  const result = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts);
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0]!;
}

async function reinstallAsrRuntime(): Promise<AsrStatus> {
  return withInstallLock(async (signal) => {
    clearCudaDisable();
    const backend = preferredGpuBackend();
    rmSync(runtimeDir(), { recursive: true, force: true });
    mkdirSync(runtimeDir(), { recursive: true });
    await installRuntimeBackend(backend, signal);
    return getStatus();
  });
}

async function pickAsrRuntimeArchive(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const opts = {
    title: "Select CrispASR runtime archive",
    properties: ["openFile" as const],
    filters: [
      { name: "Runtime archive", extensions: ["zip", "gz", "tgz"] },
      { name: "ZIP", extensions: ["zip"] },
      { name: "tar.gz", extensions: ["gz", "tgz"] },
    ],
  };
  const result = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts);
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0]!;
}

async function importAsrRuntime(sourcePath: string): Promise<AsrStatus> {
  const kind = assertAsrRuntimeArchivePath(sourcePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`Runtime archive not found: ${sourcePath}`);
  }
  const st = statSync(sourcePath);
  if (!st.isFile() || st.size <= 0) {
    throw new Error("Invalid runtime archive");
  }

  return withInstallLock(async () => {
    const backend = preferredGpuBackend();
    broadcastProgress({
      phase: "extract",
      receivedBytes: 0,
      totalBytes: st.size,
      message: `Importing runtime ${basename(sourcePath)}…`,
    });
    rmSync(runtimeDir(), { recursive: true, force: true });
    mkdirSync(runtimeDir(), { recursive: true });
    try {
      await extractArchive(sourcePath, runtimeDir(), kind);
      writeFileSync(backendMarkerPath(), `${backend}\n`, "utf8");
      ensureRuntimeExecutables();
      const bin = resolvedBinary();
      if (!bin) throw new Error("ASR binary not found in archive");
      try {
        chmodSync(bin, 0o755);
      } catch {
        // windows
      }
    } catch (err) {
      rmSync(runtimeDir(), { recursive: true, force: true });
      mkdirSync(runtimeDir(), { recursive: true });
      throw err;
    }
    return getStatus();
  });
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

function wavBytesFromPcm(pcm: Int16Array, sampleRate: number): Buffer {
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
  return buffer;
}

function writeWavPcm16(filePath: string, pcm: Int16Array, sampleRate: number): void {
  writeFileSync(filePath, wavBytesFromPcm(pcm, sampleRate));
}

async function waitForInferSlot(maxMs = 60_000): Promise<void> {
  const start = Date.now();
  while (inferBusy) {
    if (Date.now() - start > maxMs) throw new Error("ASR is busy");
    await new Promise((r) => setTimeout(r, 40));
  }
}

/** Blacklist CUDA and swap runtime to Vulkan after a native crash. */
async function recoverFromCudaCrash(detail: string): Promise<void> {
  const prefs = readPrefs();
  writePrefs({
    ...prefs,
    disableCuda: true,
    // Keep explicit vulkan/cpu picks; bump auto/cuda toward vulkan via disableCuda.
    gpuPreference: prefs.gpuPreference === "cuda" ? "auto" : prefs.gpuPreference || "auto",
  });
  const detected = detectAsrGpuInfo();
  cachedGpuInfo = {
    backend: "vulkan",
    deviceLabel: /vulkan/i.test(detected.deviceLabel)
      ? detected.deviceLabel
      : `${detected.deviceLabel} · Vulkan`,
    kind: detected.kind === "cpu" ? "discrete" : detected.kind,
    vulkanDeviceId: detected.vulkanDeviceId,
  };

  if (runtimeMatchesBackend("vulkan")) return;

  if (installBusy) {
    throw new Error(
      `ASR_CUDA_CRASH|${detail}|CUDA runtime crashed; Vulkan fallback install is busy — retry in a moment`,
    );
  }

  installBusy = true;
  installAbort = new AbortController();
  const signal = installAbort.signal;
  try {
    broadcastProgress({
      phase: "binary",
      receivedBytes: 0,
      totalBytes: estimatePhaseBytes("binary"),
      message: "CUDA crashed — switching to Vulkan runtime…",
    });
    rmSync(runtimeDir(), { recursive: true, force: true });
    mkdirSync(runtimeDir(), { recursive: true });
    await installRuntimeBackend("vulkan", signal);
    broadcastProgress({
      phase: "done",
      receivedBytes: 0,
      totalBytes: null,
      message: "Vulkan runtime ready",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`ASR_CUDA_CRASH|${detail}|Vulkan fallback failed: ${msg}`);
  } finally {
    installBusy = false;
    installAbort = null;
  }
}

function shouldFallbackCuda(err: unknown): boolean {
  if (installedBackend() !== "cuda" && preferredGpuBackend() !== "cuda") return false;
  const msg = err instanceof Error ? err.message : String(err);
  const code = parseAsrExitCode(msg);
  return isAsrNativeCrashExitCode(code) || /ASR exited with code\s+3221225477/i.test(msg);
}

async function spawnTranscribeAttempt(
  modelFile: string,
  wavPath: string,
  outBase: string,
  outTxtPath: string,
  backend: AsrGpuBackend,
  deviceId?: number,
): Promise<string> {
  const status = getStatus();
  if (!status.binaryPath) {
    throw new Error("ASR runtime is not ready for this GPU — open Settings to install/update");
  }
  ensureRuntimeExecutables();
  const args = [
    "--backend",
    "sensevoice",
    "-m",
    modelFile,
    "-f",
    wavPath,
    "-t",
    String(streamThreadCount()),
    "--gpu-backend",
    backend,
    "-np",
    "-l",
    "zh",
    "-otxt",
    "-of",
    outBase,
  ];
  if (backend === "vulkan" && deviceId != null && Number.isFinite(deviceId)) {
    args.push("-dev", String(deviceId));
  }

  const { stdout, stderr, code } = await new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
  }>((resolve, reject) => {
    const child = spawn(status.binaryPath!, args, {
      windowsHide: true,
      cwd: dirname(status.binaryPath!),
      env: streamChildEnv(status.binaryPath!),
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error("ASR timed out (90s) — first run loads the model, please retry"));
    }, 90_000);
    child.stdout.on("data", (d) => {
      out += String(d);
    });
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout: out, stderr: err, code: exitCode });
    });
  });

  const text = readTranscriptFile(outTxtPath) || pickTranscript(stdout, stderr);
  if (text) return text;

  if (code === 0) throw new Error("ASR returned empty transcript");

  const raw = (stderr.trim() || stdout.trim() || `ASR exited with code ${code}`);
  if (isAsrDiagnosticOnlyMessage(raw) || /^ggml_vulkan:/im.test(raw)) {
    throw new Error(
      `ASR_GPU_INIT_FAILED|${backend}|device=${deviceId ?? "auto"}|ASR exited with code ${code}`,
    );
  }
  throw new Error(raw.includes("exited with code") ? raw : `${raw}\nASR exited with code ${code}`);
}

async function spawnTranscribeOnce(
  modelFile: string,
  wavPath: string,
  outBase: string,
  outTxtPath: string,
): Promise<string> {
  const preferred = preferredGpuBackend();
  const attempts: Array<{ backend: AsrGpuBackend; deviceId?: number }> = [];

  if (preferred === "vulkan") {
    const primary = gpuInfo().vulkanDeviceId;
    if (primary != null) attempts.push({ backend: "vulkan", deviceId: primary });
    // Also try default device 0 if different — some drivers remap indices.
    if (primary !== 0) attempts.push({ backend: "vulkan", deviceId: 0 });
    attempts.push({ backend: "cpu" });
  } else {
    attempts.push({ backend: preferred });
    // Metal/CUDA can fail at runtime; same binary often still works on CPU.
    if (preferred === "metal" || preferred === "cuda") {
      attempts.push({ backend: "cpu" });
    }
  }

  let lastErr: unknown = null;
  for (const attempt of attempts) {
    try {
      // Unique -of base per attempt so a failed run cannot leave a stale txt.
      const stamp = `${outBase}-${attempt.backend}${attempt.deviceId ?? "x"}`;
      const txt = `${stamp}.txt`;
      try {
        return await spawnTranscribeAttempt(
          modelFile,
          wavPath,
          stamp,
          txt,
          attempt.backend,
          attempt.deviceId,
        );
      } finally {
        try {
          rmSync(txt, { force: true });
        } catch {
          // ignore
        }
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "ASR failed"));
}

/**
 * Normalize IPC-delivered PCM (Int16Array / Uint8Array / ArrayBuffer) into a
 * single Int16Array view without copying when possible.
 */
function toInt16Pcm(pcm: unknown): Int16Array {
  if (pcm instanceof Int16Array) return pcm;
  if (pcm instanceof Uint8Array) {
    return new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  }
  if (pcm instanceof ArrayBuffer) {
    return new Int16Array(pcm);
  }
  throw new Error("ASR received invalid PCM payload");
}

/**
 * Transcribe WAV PCM through a cloud ASR API.
 *
 * Supported formats:
 * - openai-multipart: POST {baseUrl}/audio/transcriptions (multipart file + model)
 * - openai-json:      POST {baseUrl}/audio/transcriptions (JSON with base64 data URL)
 * - chat:             POST {baseUrl}/chat/completions with an input_audio message
 *                     (Xiaomi MiMo style; sends api-key + Bearer headers)
 * - custom:           POST {endpoint} exactly as configured (multipart)
 */
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
    form.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
    form.append("model", model);
    body = form;
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else if (style === "chat") {
    const base = cloud.baseUrl.trim().replace(/\/+$/, "");
    url = `${base}/chat/completions`;
    headers["Content-Type"] = "application/json";
    // Xiaomi MiMo uses the `api-key` header; Bearer is sent too for
    // OpenAI-style gateways that expose the same chat endpoint.
    headers["api-key"] = apiKey;
    headers["Authorization"] = `Bearer ${apiKey}`;
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
    headers["Authorization"] = `Bearer ${apiKey}`;
    if (style === "openai-json") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({
        file: `data:audio/wav;base64,${wav.toString("base64")}`,
        model,
      });
    } else {
      const form = new FormData();
      form.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
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
  // HTTP 200 but nothing recognized (silence / too short / no speech):
  // return an empty string so the UI can show a friendly "no speech"
  // hint instead of a scary error.
  if (style === "chat") {
    return typeof data.choices?.[0]?.message?.content === "string"
      ? data.choices[0].message.content.trim()
      : "";
  }
  const text = typeof data.text === "string" ? data.text.trim() : "";
  return text;
}

/** Send a short silence sample to verify the cloud API config. */
export async function testAsrCloud(): Promise<{ ok: boolean; message: string }> {
  const prefs = readCloudPrefs();
  const cloud = prefs.cloud;
  if (!isCloudConfigured(cloud)) {
    return { ok: false, message: "Cloud ASR is not configured" };
  }
  try {
    const silence = new Int16Array(1600); // 0.1s @ 16k
    const text = await transcribeViaCloudApi(silence, 16000, cloud!);
    return { ok: true, message: text || "OK" };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // Chat-style ASR (e.g. Xiaomi MiMo) returns an empty transcript for
    // near-silent test audio even when the connection works ? count that as OK.
    if (cloud?.apiStyle === "chat" && raw.includes("empty transcript")) {
      return { ok: true, message: "OK" };
    }
    return { ok: false, message: raw };
  }
}

export async function transcribePcm(pcm: Int16Array, sampleRate: number): Promise<string> {
  const prefs = readPrefs();
  if (!prefs.enabled) throw new Error("ASR is disabled in settings");
  if (installBusy) throw new Error("ASR install in progress");
  // Cloud backend: no local model needed.
  const cloudPrefs = readCloudPrefs();
  if (cloudPrefs.backend === "cloud" && isCloudConfigured(cloudPrefs.cloud)) {
    return transcribeViaCloudApi(pcm, sampleRate, cloudPrefs.cloud!);
  }

  let status = getStatus();
  if (!status.modelPath || !existsSync(status.modelPath)) {
    throw new Error("ASR model is not installed");
  }
  if (!status.binaryPath || !runtimeMatchesPreferred()) {
    throw new Error("ASR runtime is not ready for this GPU — open Settings to install/update");
  }

  await waitForInferSlot();
  inferBusy = true;
  lastError = null;
  const stamp = Date.now();
  const wavPath = join(asrRoot(), "tmp", `utt-${stamp}.wav`);
  const outBase = join(asrRoot(), "tmp", `utt-${stamp}-out`);
  const outTxtPath = `${outBase}.txt`;
  try {
    const pcm16 = toInt16Pcm(pcm);
    if (pcm16.byteLength === 0) {
      throw new Error("ASR received empty audio");
    }
    writeWavPcm16(wavPath, pcm16, sampleRate || 16000);

    try {
      return await spawnTranscribeOnce(status.modelPath, wavPath, outBase, outTxtPath);
    } catch (err) {
      if (!shouldFallbackCuda(err)) throw err;
      const detail = err instanceof Error ? err.message : String(err);
      inferBusy = false;
      try {
        await recoverFromCudaCrash(detail);
      } finally {
        await waitForInferSlot();
        inferBusy = true;
      }
      status = getStatus();
      if (!status.binaryPath || !runtimeMatchesPreferred()) {
        throw new Error(`ASR_CUDA_CRASH|${detail}|Vulkan runtime not ready after fallback`);
      }
      return await spawnTranscribeOnce(status.modelPath!, wavPath, outBase, outTxtPath);
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    inferBusy = false;
    for (const p of [wavPath, outTxtPath]) {
      try {
        rmSync(p, { force: true });
      } catch {
        // ignore
      }
    }
  }
}

function isAsrLogLine(line: string): boolean {
  return (
    /^(\[|INFO|WARN|ERROR|DEBUG|TRACE|loading|ggml|llama|whisper|mel|encode|decode|tokens|system|main:|clip:|asr:)/i.test(
      line,
    ) ||
    /crispasr[_-]|gpu[_ -]?backend|preferred\s+gpu|using\s+preferred|Vulkan\d*|CUDA|Metal|ggml_|llama_/i.test(
      line,
    ) ||
    /^\d+(\.\d+)?(ms|s|%|MB|MiB|GB)\b/i.test(line) ||
    /^[=*-]{3,}/.test(line)
  );
}

function sanitizeTranscript(text: string): string {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !isAsrLogLine(l));
  return scrubAsrHallucination(lines.join(" ").replace(/\s+/g, " ").trim());
}

function readTranscriptFile(path: string): string {
  try {
    if (!existsSync(path)) return "";
    return sanitizeTranscript(readFileSync(path, "utf8"));
  } catch {
    return "";
  }
}

function pickTranscript(stdout: string, stderr: string): string {
  // Prefer stdout; never fall back to raw logs (stderr often has GPU init spam).
  const fromOut = sanitizeTranscript(stdout);
  if (fromOut) return fromOut;
  const fromErr = sanitizeTranscript(stderr);
  if (fromErr) return fromErr;
  return "";
}

function broadcastStreamEvent(event: AsrStreamEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.asr.streamEvent, event);
  }
}

/** chmod +x extracted binaries on macOS/Linux (zip/tar often drops execute bit). */
function ensureRuntimeExecutables(): void {
  if (process.platform === "win32") return;
  const root = runtimeDir();
  if (!existsSync(root)) return;
  const stack = [root];
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
      const lower = name.toLowerCase();
      if (
        lower === "crispasr" ||
        lower.startsWith("crispasr") ||
        lower.includes("qwen3-asr") ||
        lower.includes("sensevoice") ||
        (!lower.includes(".") && st.isFile())
      ) {
        try {
          chmodSync(full, 0o755);
        } catch {
          // ignore
        }
      }
    }
  }
}

function streamThreadCount(): number {
  const n = cpus().length || 4;
  // Apple Silicon: leave headroom for UI; Windows GPU builds can use a bit more.
  if (process.platform === "darwin") return Math.max(2, Math.min(6, n));
  return Math.max(2, Math.min(8, n));
}

function streamChildEnv(binaryPath: string): NodeJS.ProcessEnv {
  const binDir = dirname(binaryPath);
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (process.platform === "win32") {
    env.PATH = `${binDir};${env.PATH ?? ""}`;
  } else if (process.platform === "darwin") {
    // CrispASR macos tarball may ship dylibs next to the binary
    const prev = env.DYLD_LIBRARY_PATH ?? "";
    env.DYLD_LIBRARY_PATH = prev ? `${binDir}:${prev}` : binDir;
    // Avoid Homebrew/path surprises when spawning from Electron.app
    env.PATH = `/usr/bin:/bin:/usr/sbin:/sbin:${env.PATH ?? ""}`;
  } else {
    const prev = env.LD_LIBRARY_PATH ?? "";
    env.LD_LIBRARY_PATH = prev ? `${binDir}:${prev}` : binDir;
  }
  return env;
}

function killStreamChild(): void {
  const child = streamChild;
  streamChild = null;
  streamStdoutBuf = "";
  streamReady = false;
  streamStderrTail = "";
  if (!child) return;

  try {
    child.stdin.end();
  } catch {
    // ignore
  }

  const pid = child.pid;
  if (process.platform === "win32" && pid) {
    try {
      execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      return;
    } catch {
      // fall through
    }
  }

  try {
    child.kill(process.platform === "win32" ? undefined : "SIGTERM");
  } catch {
    // ignore
  }
  if (process.platform !== "win32") {
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 600);
  }
}

function handleStreamStdout(chunk: string): void {
  streamStdoutBuf += chunk.replace(/\r/g, "");
  let nl = streamStdoutBuf.indexOf("\n");
  while (nl >= 0) {
    const line = streamStdoutBuf.slice(0, nl).trim();
    streamStdoutBuf = streamStdoutBuf.slice(nl + 1);
    nl = streamStdoutBuf.indexOf("\n");
    if (!line || !line.startsWith("{")) continue;
    try {
      const obj = JSON.parse(line) as {
        type?: string;
        utterance_id?: number;
        text?: string;
      };
      if (obj.type === "partial" && typeof obj.text === "string") {
        const text = sanitizeTranscript(obj.text);
        if (!text) continue;
        if (!streamReady) {
          streamReady = true;
          broadcastStreamEvent({ type: "ready" });
        }
        broadcastStreamEvent({
          type: "partial",
          utteranceId: Number(obj.utterance_id ?? 0),
          text,
        });
      } else if (obj.type === "final" && typeof obj.text === "string") {
        const text = sanitizeTranscript(obj.text);
        if (!streamReady) {
          streamReady = true;
          broadcastStreamEvent({ type: "ready" });
        }
        if (!text) continue;
        broadcastStreamEvent({
          type: "final",
          utteranceId: Number(obj.utterance_id ?? 0),
          text,
        });
      } else if (obj.type === "silence") {
        if (!streamReady) {
          streamReady = true;
          broadcastStreamEvent({ type: "ready" });
        }
        broadcastStreamEvent({ type: "silence" });
      }
    } catch {
      // ignore malformed lines
    }
  }
}

async function startAsrStream(): Promise<AsrStatus> {
  const prefs = readPrefs();
  if (!prefs.enabled) throw new Error("ASR is disabled in settings");
  if (installBusy) throw new Error("ASR install in progress");

  const status = getStatus();
  if (!status.modelPath || !existsSync(status.modelPath)) {
    throw new Error("ASR model is not installed");
  }
  if (!status.binaryPath || !runtimeMatchesPreferred()) {
    throw new Error("ASR runtime is not ready for this GPU — open Settings to install/update");
  }

  if (streamChild && !streamChild.killed) {
    // Reusing a warm resident stream — tell new subscribers it is ready so
    // dictation can start pushing immediately (no model reload).
    broadcastStreamEvent({ type: "ready" });
    return getStatus();
  }

  await waitForInferSlot();
  inferBusy = true;
  lastError = null;
  killStreamChild();
  ensureRuntimeExecutables();

  const backend = preferredGpuBackend();
  // First streaming profile: short windows + prefix finals (simple & snappy).
  // Keep VAD so silent windows are not decoded into junk/loops.
  const streamStepMs = process.platform === "darwin" ? "700" : "800";
  const streamLengthMs = process.platform === "darwin" ? "3500" : "4000";
  const finalSilenceMs = process.platform === "darwin" ? "350" : "380";

  const args = [
    "--backend",
    "sensevoice",
    "-m",
    status.modelPath!,
    "--stream",
    "--stream-json",
    "--gpu-backend",
    backend,
    "-t",
    String(streamThreadCount()),
    "-np",
    "-l",
    "zh",
    "--vad",
    "--vad-model",
    "auto",
    "--vad-threshold",
    "0.6",
    "--vad-min-speech-duration-ms",
    "280",
    "--vad-min-silence-duration-ms",
    "220",
    "--vad-speech-pad-ms",
    "60",
    "--stream-step",
    streamStepMs,
    "--stream-length",
    streamLengthMs,
    "--stream-keep",
    "200",
    "--stream-final-on-silence-ms",
    finalSilenceMs,
    "--stream-final-mode",
    "redecode",
  ];
  const vulkanDeviceId = gpuInfo().vulkanDeviceId;
  if (backend === "vulkan" && vulkanDeviceId != null) {
    args.push("-dev", String(vulkanDeviceId));
  }

  const child = spawn(status.binaryPath!, args, {
    windowsHide: true,
    cwd: dirname(status.binaryPath!),
    env: streamChildEnv(status.binaryPath!),
    stdio: ["pipe", "pipe", "pipe"],
  });
  streamChild = child;
  streamStdoutBuf = "";
  streamReady = false;
  streamStderrTail = "";

  // Keep stdin binary (PCM s16le) — do not setEncoding on stdin.
  // Must handle stdin errors or closed-pipe writes become uncaught "write EOF".
  child.stdin.on("error", (err) => {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPIPE" || code === "EOF" || /EOF|EPIPE/i.test(err.message)) {
      return;
    }
    lastError = err.message;
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d: string) => handleStreamStdout(String(d)));
  child.stderr.on("data", (d: string) => {
    const msg = String(d);
    streamStderrTail = `${streamStderrTail}${msg}`.slice(-4000);
    // First useful log after model load — mark ready so UI can keep pushing
    if (
      !streamReady &&
      /stream|listening|ready|vad|ggml_vulkan|ggml_metal|metal|cuda|load/i.test(msg)
    ) {
      streamReady = true;
      broadcastStreamEvent({ type: "ready" });
    }
  });
  child.on("error", (err) => {
    lastError = err.message;
    broadcastStreamEvent({ type: "error", message: err.message });
    inferBusy = false;
    streamChild = null;
    streamReady = false;
  });
  child.on("close", (code) => {
    if (streamChild === child) {
      streamChild = null;
      streamReady = false;
      inferBusy = false;
      if (code && code !== 0) {
        if (isAsrNativeCrashExitCode(code) && installedBackend() === "cuda") {
          const detail = `ASR stream exited with code ${code}`;
          void recoverFromCudaCrash(detail)
            .then(() => {
              lastError = "ASR_CUDA_CRASH|stream|Switched to Vulkan — tap the mic again";
              broadcastStreamEvent({
                type: "error",
                message: lastError,
              });
              broadcastStreamEvent({ type: "ended" });
            })
            .catch((err) => {
              lastError = err instanceof Error ? err.message : String(err);
              broadcastStreamEvent({ type: "error", message: lastError });
              broadcastStreamEvent({ type: "ended" });
            });
          return;
        }
        const detail = `ASR stream exited with code ${code}`;
        const failMsg =
          isAsrDiagnosticOnlyMessage(streamStderrTail) || /ggml_vulkan:/i.test(streamStderrTail)
            ? `ASR_GPU_INIT_FAILED|${backend}|stream|${detail}`
            : detail;
        lastError = failMsg;
        broadcastStreamEvent({ type: "error", message: failMsg });
      }
      broadcastStreamEvent({ type: "ended" });
    }
  });

  // Soft ready after spawn so mic can start pushing while the model warms up
  // Mac Metal first load is often slower — wait a bit longer before soft-ready.
  const softReadyMs = process.platform === "darwin" ? 2500 : 1500;
  setTimeout(() => {
    if (streamChild === child && !streamReady) {
      streamReady = true;
      broadcastStreamEvent({ type: "ready" });
    }
  }, softReadyMs);

  return getStatus();
}

function pushAsrStreamPcm(pcmBase64: string): void {
  const child = streamChild;
  const stdin = child?.stdin;
  if (!child || !stdin || stdin.destroyed || !stdin.writable) return;
  try {
    const buf = Buffer.from(pcmBase64, "base64");
    if (buf.length === 0) return;
    stdin.write(buf, (err) => {
      if (!err) return;
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPIPE" || code === "EOF" || /EOF|EPIPE/i.test(err.message)) return;
      lastError = err.message;
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/EOF|EPIPE/i.test(msg)) return;
    lastError = msg;
  }
}

async function stopAsrStream(): Promise<AsrStatus> {
  const child = streamChild;
  if (!child) {
    inferBusy = false;
    return getStatus();
  }
  try {
    child.stdin.end();
  } catch {
    // ignore
  }
  // Give process a moment to flush finals, then force-kill
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      killStreamChild();
      inferBusy = false;
      broadcastStreamEvent({ type: "ended" });
      resolve();
    }, 800);
    child.once("close", () => {
      clearTimeout(t);
      if (streamChild === child) {
        streamChild = null;
        streamReady = false;
      }
      inferBusy = false;
      resolve();
    });
  });
  return getStatus();
}

export function registerAsrIpc(): void {
  ensureDirs();
  registerWakeHotkey();
  app.on("will-quit", () => {
    unregisterWakeHotkey();
  });

  ipcMain.handle(IpcChannels.asr.status, () => getStatus());
  ipcMain.handle(IpcChannels.asr.setEnabled, (_e, enabled: boolean) => {
    const prefs = readPrefs();
    writePrefs({
      ...prefs,
      enabled: Boolean(enabled),
    });
    return getStatus();
  });
  ipcMain.handle(IpcChannels.asr.setGpuPreference, (_e, preference: string) => {
    return setGpuPreference(String(preference ?? "auto"));
  });
  ipcMain.handle(IpcChannels.asr.setDownloadMirror, (_e, mirror: string) => {
    return setDownloadMirror(String(mirror ?? "auto"));
  });
  ipcMain.handle(IpcChannels.asr.setWakeHotkey, (_e, accel: string) => {
    return setWakeHotkey(String(accel ?? ""));
  });
  ipcMain.handle(IpcChannels.asr.setResidentModel, (_e, enabled: boolean) => {
    return setResidentModel(Boolean(enabled));
  });
  ipcMain.handle(IpcChannels.asr.setWakeEnabled, (_e, enabled: boolean) => {
    const prefs = readPrefs();
    writePrefs({
      ...prefs,
      wakeEnabled: Boolean(enabled),
    });
    return getStatus();
  });
  ipcMain.handle(IpcChannels.asr.setWakeWords, (_e, raw: string) => {
    return setWakeWords(String(raw ?? ""));
  });
  ipcMain.handle(IpcChannels.asr.install, async () => installAsr());
  ipcMain.handle(IpcChannels.asr.installFromUrl, async (_e, url: string) => installAsrFromUrl(url));
  ipcMain.handle(IpcChannels.asr.pickModel, async () => pickAsrModelFile());
  ipcMain.handle(IpcChannels.asr.importModel, async (_e, filePath: string) => importAsrModel(filePath));
  ipcMain.handle(IpcChannels.asr.reinstallRuntime, async () => reinstallAsrRuntime());
  ipcMain.handle(IpcChannels.asr.pickRuntimeArchive, async () => pickAsrRuntimeArchive());
  ipcMain.handle(IpcChannels.asr.importRuntime, async (_e, filePath: string) => importAsrRuntime(filePath));
  ipcMain.handle(IpcChannels.asr.cancelInstall, () => cancelAsrInstall());
  ipcMain.handle(IpcChannels.asr.uninstall, async () => {
    await stopAsrStream();
    return uninstallAsr();
  });
  ipcMain.handle(
    IpcChannels.asr.transcribe,
    async (_e, payload: AsrTranscribePayload) => {
      return transcribePcm(payload.pcm, payload.sampleRate);
    },
  );
  ipcMain.handle(IpcChannels.asr.setBackend, (_e, backend: string) => {
    const next: AsrBackendKind = backend === "local" || backend === "cloud" ? backend : null;
    writeCloudPrefs({ ...readCloudPrefs(), backend: next });
    return getStatus();
  });
  ipcMain.handle(IpcChannels.asr.getCloudConfig, () => {
    const prefs = readCloudPrefs();
    const cloud = prefs.cloud
      ? { ...prefs.cloud, apiStyle: inferCloudApiStyle(prefs.cloud) }
      : null;
    return { backend: prefs.backend ?? null, cloud };
  });
  ipcMain.handle(IpcChannels.asr.setCloudConfig, (_e, cloud: AsrCloudConfig) => {
    const style = inferCloudApiStyle(cloud);
    const sanitized: AsrCloudConfig = {
      providerName: String(cloud?.providerName ?? "").slice(0, 80),
      baseUrl: String(cloud?.baseUrl ?? "").trim(),
      apiKey: String(cloud?.apiKey ?? "").trim(),
      model: String(cloud?.model ?? "").trim(),
      apiStyle: style,
      endpoint: String(cloud?.endpoint ?? "").trim(),
      language: String(cloud?.language ?? "").trim().slice(0, 16),
    };
    writeCloudPrefs({ ...readCloudPrefs(), cloud: sanitized });
    return getStatus();
  });
  ipcMain.handle(IpcChannels.asr.testCloud, async () => testAsrCloud());

  ipcMain.handle(IpcChannels.asr.streamStart, async () => startAsrStream());
  ipcMain.handle(IpcChannels.asr.streamPush, (_e, payload: { pcmBase64: string }) => {
    pushAsrStreamPcm(payload.pcmBase64);
  });
  ipcMain.handle(IpcChannels.asr.streamStop, async () => stopAsrStream());
}
