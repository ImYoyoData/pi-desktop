import { app, BrowserWindow, ipcMain, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { IpcChannels } from "../shared/protocol";
import {
  PI_CLI_PACKAGE,
  PI_DOCS_INSTALL_URL,
  PI_INSTALL_PS1,
  PI_INSTALL_SH,
  PI_INSTALL_URL,
  type PiCliInstallMethod,
  type PiCliInstallProgress,
  type PiCliInstallResult,
  type PiCliStatus,
} from "../shared/pi-cli";

const execFileAsync = promisify(execFile);
const PREFS_FILE = "pi-cli-prefs.json";

type Prefs = {
  /** User dismissed the first-launch prompt (don't ask again). */
  skipped: boolean;
  /** Last successful install timestamp. */
  installedAt: number | null;
};

type MethodResult = { ok: boolean; log: string; openedExternal?: boolean };

let installBusy = false;

function prefsPath(): string {
  return join(app.getPath("userData"), PREFS_FILE);
}

function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(readFileSync(prefsPath(), "utf8")) as Partial<Prefs>;
    return {
      skipped: Boolean(raw.skipped),
      installedAt: typeof raw.installedAt === "number" ? raw.installedAt : null,
    };
  } catch {
    return { skipped: false, installedAt: null };
  }
}

function writePrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...readPrefs(), ...patch };
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(prefsPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function broadcastProgress(progress: PiCliInstallProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.piCli.progress, progress);
  }
}

function looksLikeCommand(out: string): boolean {
  return Boolean(out.trim()) && !/could not find|not found|INFO: Could not/i.test(out);
}

async function resolveCommand(name: string): Promise<string | null> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("where.exe", [name], {
        windowsHide: true,
        timeout: 8000,
      });
      const first = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean);
      if (first && existsSync(first)) return first;
      if (first) return first;
    } else {
      const { stdout } = await execFileAsync("which", [name], {
        timeout: 8000,
      });
      const first = stdout.trim().split(/\n/)[0]?.trim();
      if (first) return first;
    }
  } catch {
    // fall through to known locations
  }

  // Electron inherits a stale PATH — check common global bins after package-manager installs
  const home = app.getPath("home");
  const candidates =
    process.platform === "win32"
      ? [
          join(process.env.APPDATA || join(home, "AppData", "Roaming"), "npm", `${name}.cmd`),
          join(process.env.APPDATA || join(home, "AppData", "Roaming"), "npm", `${name}.exe`),
          join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "bun", "bin", `${name}.exe`),
          join(home, ".bun", "bin", `${name}.exe`),
        ]
      : [
          join(home, ".bun", "bin", name),
          join(home, ".local", "share", "pnpm", name),
          join(home, ".npm-global", "bin", name),
          `/usr/local/bin/${name}`,
          `/opt/homebrew/bin/${name}`,
        ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function runCapture(
  command: string,
  args: string[],
  opts?: { shell?: boolean; timeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: opts?.shell === true,
      env: { ...process.env, ...opts?.env, CI: "1", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve({ code: -1, stdout, stderr: stderr || "timed out" });
    }, opts?.timeoutMs ?? 300_000);
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function probePiVersion(piPath: string): Promise<string | null> {
  try {
    const { stdout, stderr, code } = await runCapture(piPath, ["--version"], {
      timeoutMs: 12_000,
      shell: process.platform === "win32",
    });
    const text = `${stdout}\n${stderr}`.trim();
    if (code !== 0 && !text) return null;
    const m = text.match(/\d+\.\d+\.\d+[\w.-]*/);
    return m?.[0] ?? (looksLikeCommand(text) ? text.split(/\r?\n/)[0]!.trim() : null);
  } catch {
    return null;
  }
}

async function listAvailableMethods(): Promise<PiCliInstallMethod[]> {
  const methods: PiCliInstallMethod[] = [];
  if (await resolveCommand("bun")) methods.push("bun");
  if (await resolveCommand("pnpm")) methods.push("pnpm");
  if (await resolveCommand("npm")) methods.push("npm");
  if (process.platform === "win32") {
    if (await resolveCommand("powershell") || await resolveCommand("pwsh")) {
      methods.push("powershell");
    }
  }
  if (process.platform !== "win32") {
    if (await resolveCommand("curl")) methods.push("curl");
  } else if (await resolveCommand("curl.exe") || await resolveCommand("curl")) {
    // Windows curl can still fetch scripts; prefer powershell for official .ps1
    if (!methods.includes("powershell")) methods.push("curl");
  }
  return methods;
}

export async function getPiCliStatus(): Promise<PiCliStatus> {
  const availableMethods = await listAvailableMethods();
  const preferredMethod = availableMethods[0] ?? null;
  const piPath = await resolveCommand("pi");
  if (!piPath) {
    return {
      installed: false,
      path: null,
      version: null,
      platform: process.platform,
      availableMethods,
      preferredMethod,
    };
  }
  const version = await probePiVersion(piPath);
  return {
    installed: true,
    path: piPath,
    version,
    platform: process.platform,
    availableMethods,
    preferredMethod,
  };
}

async function installWithBun(): Promise<MethodResult> {
  const bun = (await resolveCommand("bun"))!;
  const r = await runCapture(bun, ["add", "-g", PI_CLI_PACKAGE], { timeoutMs: 600_000 });
  return {
    ok: r.code === 0,
    log: `${r.stdout}\n${r.stderr}`.trim(),
  };
}

async function installWithPnpm(): Promise<MethodResult> {
  const pnpm = (await resolveCommand("pnpm"))!;
  const r = await runCapture(pnpm, ["add", "-g", PI_CLI_PACKAGE], { timeoutMs: 600_000 });
  return {
    ok: r.code === 0,
    log: `${r.stdout}\n${r.stderr}`.trim(),
  };
}

async function installWithNpm(): Promise<MethodResult> {
  const npm = (await resolveCommand("npm"))!;
  const r = await runCapture(
    npm,
    ["install", "-g", "--ignore-scripts", "--min-release-age=0", PI_CLI_PACKAGE],
    { timeoutMs: 600_000 },
  );
  return {
    ok: r.code === 0,
    log: `${r.stdout}\n${r.stderr}`.trim(),
  };
}

/**
 * Electron GUI apps have no console. Spawning powershell.exe directly often
 * creates a hidden/orphan process. Use `cmd /c start` (or a .cmd launcher) so
 * Windows allocates a real visible console window.
 */
async function openWindowsInstallerConsole(): Promise<MethodResult> {
  const bat = join(tmpdir(), `pi-desktop-install-${Date.now()}.cmd`);
  const body = [
    "@echo off",
    "title Pi CLI Installer",
    "echo.",
    "echo Installing Pi CLI from pi.dev …",
    "echo.",
    `powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -NoExit -Command "try { irm '${PI_INSTALL_PS1}' | iex } catch { Write-Host $_; Write-Host ''; Read-Host 'Press Enter to close' }"`,
  ].join("\r\n");
  writeFileSync(bat, `${body}\r\n`, "utf8");

  const comspec = process.env.ComSpec || "cmd.exe";
  const started = await new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    // start "title" "path\to\bat" — first quoted arg is the window title
    const child = spawn(comspec, ["/c", "start", "Pi CLI Installer", bat], {
      windowsHide: true,
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.once("error", () => done(false));
    child.once("spawn", () => {
      child.unref();
      done(true);
    });
    setTimeout(() => done(Boolean(child.pid)), 800);
  });

  if (started) {
    return {
      ok: true,
      openedExternal: true,
      log: "Opened a system console with the official pi.dev installer. Finish prompts there, then restart Pi Desktop if needed.",
    };
  }

  // Fallback: let the shell association open the .cmd
  const openErr = await shell.openPath(bat);
  if (!openErr) {
    return {
      ok: true,
      openedExternal: true,
      log: "Opened installer script via shell.openPath. Finish prompts in that window, then restart Pi Desktop if needed.",
    };
  }
  return {
    ok: false,
    openedExternal: false,
    log: `Failed to open system console (${openErr}). Run manually: irm ${PI_INSTALL_PS1} | iex`,
  };
}

async function installWithPowershell(): Promise<MethodResult> {
  if (process.platform !== "win32") {
    return { ok: false, log: "powershell installer is Windows-only" };
  }
  const pwsh = (await resolveCommand("pwsh")) || (await resolveCommand("powershell"));
  if (!pwsh) return { ok: false, log: "powershell not found" };
  return openWindowsInstallerConsole();
}

async function installWithCurl(): Promise<MethodResult> {
  if (process.platform === "win32") {
    return installWithPowershell();
  }

  const curl = await resolveCommand("curl");
  if (!curl) return { ok: false, log: "curl not found" };

  if (process.platform === "darwin") {
    // Prefer a .command launcher + `open` — does not need Automation / Apple Events
    // permission (osascript → Terminal often fails silently on modern macOS).
    const cmdPath = join(tmpdir(), `pi-desktop-install-${Date.now()}.command`);
    const body = [
      "#!/bin/bash",
      'echo "Installing Pi CLI from pi.dev …"',
      `curl -fsSL ${JSON.stringify(PI_INSTALL_SH)} | sh`,
      "echo",
      'read -n1 -r -p "Press any key to close…"',
      "echo",
    ].join("\n");
    writeFileSync(cmdPath, `${body}\n`, { encoding: "utf8", mode: 0o755 });
    try {
      chmodSync(cmdPath, 0o755);
    } catch {
      // mode in writeFileSync may be enough
    }

    const opened = await new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      const child = spawn("open", [cmdPath], { detached: true, stdio: "ignore" });
      child.once("error", () => done(false));
      child.once("spawn", () => {
        child.unref();
        done(true);
      });
      setTimeout(() => done(Boolean(child.pid)), 800);
    });
    if (opened) {
      return {
        ok: true,
        openedExternal: true,
        log: "Opened Terminal with the official pi.dev installer. Finish prompts there, then restart Pi Desktop if needed.",
      };
    }

    // Fallback: AppleScript (may prompt for Automation permission)
    const script = `curl -fsSL ${JSON.stringify(PI_INSTALL_SH)} | sh`;
    const r = await runCapture(
      "osascript",
      [
        "-e",
        'tell application "Terminal" to activate',
        "-e",
        `tell application "Terminal" to do script ${JSON.stringify(script)}`,
      ],
      { timeoutMs: 15_000 },
    );
    if (r.code === 0) {
      return {
        ok: true,
        openedExternal: true,
        log: "Opened Terminal via AppleScript. Finish prompts there, then restart Pi Desktop if needed.",
      };
    }
    return {
      ok: false,
      log:
        `${r.stdout}\n${r.stderr}`.trim() ||
        "Failed to open Terminal.app — allow Automation for Pi Desktop, or install from pi.dev manually",
    };
  }

  // Linux: try common terminals; fall back to non-interactive pipe (may prompt fail)
  const termCandidates = ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"];
  for (const term of termCandidates) {
    const termPath = await resolveCommand(term);
    if (!termPath) continue;
    const opened = await new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      try {
        const child = spawn(
          termPath,
          ["-e", `bash -lc 'curl -fsSL "${PI_INSTALL_SH}" | sh; echo; read -n1 -r -p \"Press any key…\"'`],
          { detached: true, stdio: "ignore" },
        );
        child.once("error", () => done(false));
        child.once("spawn", () => {
          child.unref();
          done(true);
        });
        setTimeout(() => done(Boolean(child.pid)), 800);
      } catch {
        done(false);
      }
    });
    if (opened) {
      return {
        ok: true,
        openedExternal: true,
        log: `Opened ${term} with the official pi.dev installer.`,
      };
    }
  }

  const r = await runCapture("/bin/sh", ["-lc", `'${curl}' -fsSL '${PI_INSTALL_SH}' | sh`], {
    timeoutMs: 600_000,
  });
  return {
    ok: r.code === 0,
    log: `${r.stdout}\n${r.stderr}`.trim(),
  };
}

async function runMethod(method: PiCliInstallMethod): Promise<MethodResult> {
  switch (method) {
    case "bun":
      return installWithBun();
    case "pnpm":
      return installWithPnpm();
    case "npm":
      return installWithNpm();
    case "powershell":
      return installWithPowershell();
    case "curl":
      return installWithCurl();
    default: {
      const _exhaustive: never = method;
      return { ok: false, log: `unknown method: ${_exhaustive}` };
    }
  }
}

export async function installPiCli(): Promise<PiCliInstallResult> {
  if (installBusy) {
    const status = await getPiCliStatus();
    return {
      ok: false,
      method: null,
      status,
      log: "",
      error: "Pi CLI install already in progress",
      openedExternal: false,
    };
  }
  installBusy = true;
  const logs: string[] = [];
  let used: PiCliInstallMethod | null = null;

  try {
    broadcastProgress({ phase: "detect", method: null, message: "Detecting package managers…" });
    const methods = await listAvailableMethods();
    if (!methods.length) {
      const status = await getPiCliStatus();
      broadcastProgress({
        phase: "error",
        method: null,
        message: "No installer found (need bun, pnpm, npm, powershell, or curl)",
      });
      return {
        ok: false,
        method: null,
        status,
        log: "",
        error: `No installer available. See ${PI_INSTALL_URL}`,
        openedExternal: false,
      };
    }

    let lastErr = "";
    for (const method of methods) {
      used = method;
      broadcastProgress({
        phase: "install",
        method,
        message: `Installing with ${method}…`,
      });
      const result = await runMethod(method);
      logs.push(`[${method}]\n${result.log}`);
      if (result.ok) {
        broadcastProgress({ phase: "verify", method, message: "Verifying pi command…" });
        // Refresh PATH may lag on Windows — re-probe a few times (+ known global bins)
        let status = await getPiCliStatus();
        for (let i = 0; i < 5 && !status.installed; i++) {
          await new Promise((r) => setTimeout(r, 400));
          status = await getPiCliStatus();
        }
        if (status.installed) {
          writePrefs({ installedAt: Date.now(), skipped: false });
          broadcastProgress({ phase: "done", method, message: "Pi CLI installed" });
          return {
            ok: true,
            method,
            status,
            log: logs.join("\n\n"),
            error: null,
            openedExternal: Boolean(result.openedExternal),
          };
        }
        // Interactive external installer (powershell/curl) — don't claim PATH is ready
        if (result.openedExternal || method === "powershell" || method === "curl") {
          if (!result.openedExternal) {
            // Method claimed success without actually opening a console — treat as failure
            lastErr = result.log || `${method} did not open an installer window`;
            continue;
          }
          broadcastProgress({
            phase: "done",
            method,
            message: "Finish the installer window, then restart Pi Desktop",
          });
          return {
            ok: true,
            method,
            status,
            log: logs.join("\n\n"),
            error: null,
            openedExternal: true,
          };
        }
        // Package manager succeeded but PATH not visible yet in this process
        writePrefs({ installedAt: Date.now(), skipped: false });
        broadcastProgress({
          phase: "done",
          method,
          message: "Install finished — restart the app if `pi` is not found yet",
        });
        return {
          ok: true,
          method,
          status,
          log: logs.join("\n\n"),
          error: null,
          openedExternal: false,
        };
      }
      lastErr = result.log || `${method} failed`;
    }

    const status = await getPiCliStatus();
    broadcastProgress({ phase: "error", method: used, message: lastErr.slice(0, 240) });
    return {
      ok: false,
      method: used,
      status,
      log: logs.join("\n\n"),
      error: lastErr || "All install methods failed",
      openedExternal: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = await getPiCliStatus();
    broadcastProgress({ phase: "error", method: used, message });
    return {
      ok: false,
      method: used,
      status,
      log: logs.join("\n\n"),
      error: message,
      openedExternal: false,
    };
  } finally {
    installBusy = false;
  }
}

/** Whether to show the first-launch missing-CLI prompt. */
export async function shouldPromptPiCliInstall(): Promise<{
  prompt: boolean;
  status: PiCliStatus;
  skipped: boolean;
}> {
  const prefs = readPrefs();
  const status = await getPiCliStatus();
  if (status.installed) {
    return { prompt: false, status, skipped: prefs.skipped };
  }
  if (prefs.skipped) {
    return { prompt: false, status, skipped: true };
  }
  return { prompt: true, status, skipped: false };
}

export function registerPiCliIpc(): void {
  ipcMain.handle(IpcChannels.piCli.status, async () => getPiCliStatus());
  ipcMain.handle(IpcChannels.piCli.shouldPrompt, async () => shouldPromptPiCliInstall());
  ipcMain.handle(IpcChannels.piCli.install, async () => installPiCli());
  ipcMain.handle(IpcChannels.piCli.skip, () => {
    writePrefs({ skipped: true });
    return readPrefs();
  });
  ipcMain.handle(IpcChannels.piCli.openDocs, async () => {
    await shell.openExternal(PI_DOCS_INSTALL_URL);
  });
  ipcMain.handle(IpcChannels.piCli.openSite, async () => {
    await shell.openExternal(PI_INSTALL_URL);
  });
}
