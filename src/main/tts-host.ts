import { app, BrowserWindow, ipcMain } from "electron";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  readdirSync,
  statSync,
  chmodSync,
} from "fs";
import { dirname, join } from "path";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { pathToFileURL } from "url";
import { IpcChannels } from "../shared/protocol";
import {
  resolveTtsBinaryAsset,
  sanitizeTtsText,
  splitTtsChunks,
  TTS_RUNTIME_DISK_MB,
  TTS_VOICE_DISK_MB,
  TTS_VOICE_JSON,
  TTS_VOICE_JSON_URLS,
  TTS_VOICE_LABEL,
  TTS_VOICE_ONNX,
  TTS_VOICE_ONNX_URLS,
  ttsRuntimeArchiveName,
  type TtsInstallProgress,
  type TtsSpeakResult,
  type TtsStatus,
} from "../shared/tts";

const execFileAsync = promisify(execFile);
const PREFS_FILE = "prefs.json";

type Prefs = {
  /** Auto-speak on turn complete — default off. */
  enabled: boolean;
};

let installBusy = false;
let speakingBusy = false;
let speakGen = 0;
let installAbort: AbortController | null = null;
let speakChild: ReturnType<typeof spawn> | null = null;
let playChild: ReturnType<typeof spawn> | null = null;

function broadcastSpeaking(speaking: boolean): void {
  speakingBusy = speaking;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(IpcChannels.tts.speaking, { speaking });
    } catch {
      // ignore
    }
  }
}

function killProc(child: ReturnType<typeof spawn> | null): void {
  if (!child) return;
  try {
    child.kill();
  } catch {
    // ignore
  }
}

function ttsRoot(): string {
  return join(app.getPath("userData"), "tts");
}

function prefsPath(): string {
  return join(ttsRoot(), PREFS_FILE);
}

function voiceDir(): string {
  return join(ttsRoot(), "voices");
}

function voiceOnnxPath(): string {
  return join(voiceDir(), TTS_VOICE_ONNX);
}

function voiceJsonPath(): string {
  return join(voiceDir(), TTS_VOICE_JSON);
}

function runtimeDir(): string {
  return join(ttsRoot(), "runtime");
}

function tmpDir(): string {
  return join(ttsRoot(), "tmp");
}

function ensureDirs(): void {
  mkdirSync(voiceDir(), { recursive: true });
  mkdirSync(runtimeDir(), { recursive: true });
  mkdirSync(tmpDir(), { recursive: true });
}

function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(readFileSync(prefsPath(), "utf8")) as Prefs;
    return { enabled: Boolean(raw.enabled) };
  } catch {
    return { enabled: false };
  }
}

function writePrefs(prefs: Prefs): void {
  ensureDirs();
  writeFileSync(prefsPath(), `${JSON.stringify({ enabled: Boolean(prefs.enabled) }, null, 2)}\n`, "utf8");
}

function broadcastProgress(p: TtsInstallProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(IpcChannels.tts.progress, p);
  }
}

function findBinary(): string | null {
  const asset = resolveTtsBinaryAsset(process.platform, process.arch);
  if (!asset) return null;
  const root = runtimeDir();
  for (const rel of asset.binaryNames) {
    const p = join(root, rel);
    if (existsSync(p)) return p;
  }
  // Deep search once (archive layout may nest)
  try {
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
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
        const base = name.toLowerCase();
        if (base === "piper.exe" || base === "piper") return full;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function isInstalled(): boolean {
  return Boolean(findBinary() && existsSync(voiceOnnxPath()) && existsSync(voiceJsonPath()));
}

function platformSupported(): boolean {
  return resolveTtsBinaryAsset(process.platform, process.arch) != null;
}

function getStatus(): TtsStatus {
  const prefs = readPrefs();
  const bin = findBinary();
  const installed = isInstalled();
  return {
    enabled: prefs.enabled,
    supported: platformSupported(),
    installed,
    voicePath: existsSync(voiceOnnxPath()) ? voiceOnnxPath() : null,
    binaryPath: bin,
    voiceDiskMb: TTS_VOICE_DISK_MB,
    runtimeDiskMb: TTS_RUNTIME_DISK_MB,
    voiceLabel: TTS_VOICE_LABEL,
    installing: installBusy,
    speaking: speakingBusy,
    runtimeArchiveHint: ttsRuntimeArchiveName(process.platform, process.arch),
    lastError: null,
  };
}

function expandDownloadUrls(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: string): void => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  for (const url of urls) {
    if (/^https?:\/\/(github\.com|objects\.githubusercontent\.com)\//i.test(url)) {
      push(`https://gh-proxy.com/${url}`);
      push(`https://mirror.ghproxy.com/${url}`);
      push(`https://ghfast.top/${url}`);
    }
    push(url);
  }
  return out;
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
  broadcastProgress({
    phase,
    receivedBytes: 0,
    totalBytes: phase === "model" ? TTS_VOICE_DISK_MB * 1024 * 1024 : TTS_RUNTIME_DISK_MB * 1024 * 1024,
    message: phase === "model" ? "Downloading TTS voice…" : "Downloading Piper runtime…",
  });
  const res = await fetch(url, {
    signal,
    redirect: "follow",
    headers: {
      "User-Agent": `pi-desktop-tts/${app.getVersion()}`,
      Accept: "*/*",
    },
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const headerTotal = Number(res.headers.get("content-length") || 0);
  let totalBytes =
    headerTotal > 0
      ? headerTotal
      : phase === "model"
        ? TTS_VOICE_DISK_MB * 1024 * 1024
        : TTS_RUNTIME_DISK_MB * 1024 * 1024;
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
      message: phase === "model" ? "Downloading TTS voice…" : "Downloading Piper runtime…",
    });
  };
  reader.on("data", (chunk: Buffer) => {
    received += chunk.length;
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
}

async function downloadFile(
  urls: readonly string[],
  dest: string,
  phase: "binary" | "model",
  signal: AbortSignal,
): Promise<void> {
  const list = expandDownloadUrls([...urls]);
  let lastErr: unknown;
  for (const url of list) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (signal.aborted) throw new Error("Download aborted");
      try {
        await downloadOnce(url, dest, phase, signal);
        return;
      } catch (err) {
        lastErr = err;
        if (signal.aborted) throw err;
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "download failed"));
}

async function extractArchive(archivePath: string, destDir: string, kind: "zip" | "tar.gz"): Promise<void> {
  mkdirSync(destDir, { recursive: true });
  broadcastProgress({
    phase: "extract",
    receivedBytes: 0,
    totalBytes: null,
    message: "Extracting Piper runtime…",
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

async function installRuntime(signal: AbortSignal): Promise<void> {
  const asset = resolveTtsBinaryAsset(process.platform, process.arch);
  if (!asset) throw new Error(`Piper runtime not available for ${process.platform}/${process.arch}`);
  const archivePath = join(
    ttsRoot(),
    `runtime-download.${asset.archive === "zip" ? "zip" : "tar.gz"}`,
  );
  await downloadFile([asset.url], archivePath, "binary", signal);
  rmSync(runtimeDir(), { recursive: true, force: true });
  mkdirSync(runtimeDir(), { recursive: true });
  await extractArchive(archivePath, runtimeDir(), asset.archive);
  rmSync(archivePath, { force: true });
  const bin = findBinary();
  if (!bin) throw new Error("Piper binary not found after extract");
  if (process.platform !== "win32") {
    try {
      chmodSync(bin, 0o755);
    } catch {
      // ignore
    }
  }
}

async function installVoice(signal: AbortSignal): Promise<void> {
  ensureDirs();
  // Voice is OS-agnostic — skip re-download if already present.
  if (!existsSync(voiceOnnxPath())) {
    await downloadFile(TTS_VOICE_ONNX_URLS, voiceOnnxPath(), "model", signal);
  }
  if (!existsSync(voiceJsonPath())) {
    await downloadFile(TTS_VOICE_JSON_URLS, voiceJsonPath(), "model", signal);
  }
}

async function installTts(): Promise<TtsStatus> {
  if (installBusy) throw new Error("TTS install already in progress");
  if (!platformSupported()) throw new Error("TTS not supported on this platform");
  installBusy = true;
  installAbort = new AbortController();
  const signal = installAbort.signal;
  try {
    ensureDirs();
    if (!findBinary()) await installRuntime(signal);
    await installVoice(signal);
    if (!isInstalled()) throw new Error("TTS install incomplete");
    return getStatus();
  } finally {
    installBusy = false;
    installAbort = null;
  }
}

async function uninstallTts(): Promise<TtsStatus> {
  stopSpeak();
  rmSync(voiceDir(), { recursive: true, force: true });
  rmSync(runtimeDir(), { recursive: true, force: true });
  mkdirSync(voiceDir(), { recursive: true });
  mkdirSync(runtimeDir(), { recursive: true });
  return getStatus();
}

/** Strip markdown / code for short spoken replies — implemented in shared/tts. */
function prepareSpeakText(raw: string): string {
  return sanitizeTtsText(raw);
}

function stopSpeak(): void {
  speakGen += 1;
  killProc(speakChild);
  speakChild = null;
  killProc(playChild);
  playChild = null;
  broadcastSpeaking(false);
}

async function synthesizeToWav(text: string): Promise<string> {
  const bin = findBinary();
  if (!bin || !existsSync(voiceOnnxPath())) {
    throw new Error("TTS is not installed");
  }
  ensureDirs();
  const wavPath = join(tmpDir(), `speak-${Date.now()}.wav`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      bin,
      ["--model", voiceOnnxPath(), "--output_file", wavPath, "--quiet"],
      {
        cwd: dirname(bin),
        windowsHide: true,
        stdio: ["pipe", "ignore", "pipe"],
      },
    );
    speakChild = child;
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      if (speakChild === child) speakChild = null;
      reject(err);
    });
    child.on("close", (code) => {
      if (speakChild === child) speakChild = null;
      if (code === 0 && existsSync(wavPath)) resolve();
      else reject(new Error(stderr.trim() || `piper exited ${code}`));
    });
    child.stdin?.write(text, "utf8");
    child.stdin?.end();
  });
  return wavPath;
}

function playWav(wavPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    if (process.platform === "darwin") {
      child = spawn("afplay", [wavPath], { stdio: "ignore" });
    } else if (process.platform === "win32") {
      const ps = `
$p = New-Object System.Media.SoundPlayer '${wavPath.replace(/'/g, "''")}';
$p.PlaySync();
`;
      child = spawn("powershell.exe", ["-NoProfile", "-Command", ps], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      child = spawn("aplay", [wavPath], { stdio: "ignore" });
    }
    playChild = child;
    child.on("error", (err) => {
      if (playChild === child) playChild = null;
      reject(err);
    });
    child.on("close", (code) => {
      if (playChild === child) playChild = null;
      if (code === 0 || code === null) resolve();
      else reject(new Error(`player exited ${code}`));
    });
  });
}

async function speakText(raw: string): Promise<TtsSpeakResult> {
  if (!isInstalled()) return { ok: false, message: "TTS not installed" };
  const text = prepareSpeakText(raw);
  if (!text) return { ok: false, message: "Nothing to speak" };
  // Interrupt any current playback without emitting idle — avoids UI flicker
  // when switching to another message.
  speakGen += 1;
  killProc(speakChild);
  speakChild = null;
  killProc(playChild);
  playChild = null;
  const gen = speakGen;
  broadcastSpeaking(true);

  const chunks = splitTtsChunks(text);
  if (!chunks.length) {
    broadcastSpeaking(false);
    return { ok: false, message: "Nothing to speak" };
  }

  const queue: string[] = [];
  let synthIndex = 0;
  let playIndex = 0;
  let synthDone = false;
  let synthError: Error | null = null;
  let firstWav = "";

  const cleanupPath = (p: string) => {
    try {
      rmSync(p, { force: true });
    } catch {
      // ignore
    }
  };

  const synthesizeOne = async (): Promise<boolean> => {
    if (synthIndex >= chunks.length || gen !== speakGen) return false;
    const piece = chunks[synthIndex]!;
    synthIndex += 1;
    try {
      const wavPath = await synthesizeToWav(piece);
      if (gen !== speakGen) {
        cleanupPath(wavPath);
        return false;
      }
      if (!firstWav) firstWav = wavPath;
      queue.push(wavPath);
      return true;
    } catch (err) {
      synthError = err instanceof Error ? err : new Error(String(err));
      return false;
    }
  };

  // Producer: keep 1–2 chunks ahead so playback starts after the first phrase.
  void (async () => {
    try {
      while (gen === speakGen && synthIndex < chunks.length && !synthError) {
        // Bound queue depth so we don't synth the whole reply before playing.
        while (queue.length - playIndex >= 2 && gen === speakGen && !synthError) {
          await new Promise<void>((r) => setTimeout(r, 40));
        }
        if (gen !== speakGen || synthError) break;
        await synthesizeOne();
      }
    } finally {
      synthDone = true;
    }
  })();

  // Consumer: play as soon as the first wav is ready.
  void (async () => {
    try {
      while (gen === speakGen) {
        if (playIndex < queue.length) {
          const wavPath = queue[playIndex]!;
          playIndex += 1;
          try {
            await playWav(wavPath);
          } catch {
            // ignore single-chunk playback errors
          } finally {
            cleanupPath(wavPath);
          }
          continue;
        }
        if (synthDone || synthError) break;
        await new Promise<void>((r) => setTimeout(r, 40));
      }
    } finally {
      for (const p of queue.slice(playIndex)) cleanupPath(p);
      if (gen === speakGen) broadcastSpeaking(false);
    }
  })();

  // Wait for first chunk so callers learn about synth failures quickly.
  const deadline = Date.now() + 12_000;
  while (gen === speakGen && !firstWav && !synthError && Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 40));
  }
  if (gen !== speakGen) return { ok: false, message: "Stopped" };
  if (synthError) {
    broadcastSpeaking(false);
    return { ok: false, message: (synthError as Error).message };
  }
  if (!firstWav) {
    broadcastSpeaking(false);
    return { ok: false, message: "TTS synthesis timed out" };
  }
  return { ok: true, wavPath: pathToFileURL(firstWav).href };
}

export function registerTtsIpc(): void {
  ensureDirs();

  ipcMain.handle(IpcChannels.tts.status, () => getStatus());
  ipcMain.handle(IpcChannels.tts.setEnabled, (_e, enabled: boolean) => {
    writePrefs({ enabled: Boolean(enabled) });
    return getStatus();
  });
  ipcMain.handle(IpcChannels.tts.install, async () => installTts());
  ipcMain.handle(IpcChannels.tts.uninstall, async () => uninstallTts());
  ipcMain.handle(IpcChannels.tts.speak, async (_e, text: string) => speakText(String(text ?? "")));
  ipcMain.handle(IpcChannels.tts.stop, () => {
    stopSpeak();
    return getStatus();
  });
}
