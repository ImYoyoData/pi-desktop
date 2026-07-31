import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  PI_DESKTOP_NODE_PATH_ENV,
  PI_DESKTOP_PI_CLI_PATH_ENV,
  PI_SUBAGENT_PI_BINARY_ENV,
  PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT_ENV,
} from "../shared/pi-subagent-env";

export {
  PI_DESKTOP_NODE_PATH_ENV,
  PI_DESKTOP_PI_CLI_PATH_ENV,
  PI_SUBAGENT_PI_BINARY_ENV,
  PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT_ENV,
} from "../shared/pi-subagent-env";

const PI_CLI_REL = path.join(
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
  "dist",
  "cli.js",
);

/** True when path lives inside an Electron asar archive (system Node cannot exec it). */
export function isInsideElectronAsar(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return /(^|\/)[^/]+\.asar(\/|$)/i.test(normalized);
}

/** Ensure Electron workers can resolve npm/pnpm/bun like an interactive shell. */
export function augmentPathForPiCli(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const home = env.HOME || env.USERPROFILE || homedir();
  const sep = process.platform === "win32" ? ";" : ":";
  // Prefer PATH; on Windows Electron may expose Path
  const current =
    env.PATH || env.Path || process.env.PATH || process.env.Path || "";
  const extras: string[] = [];
  if (process.platform === "win32") {
    const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    extras.push(
      path.join(appData, "npm"),
      path.join(local, "pnpm"),
      path.join(local, "bun", "bin"),
      path.join(home, "AppData", "Roaming", "npm"),
    );
  } else {
    extras.push(
      path.join(home, ".bun", "bin"),
      path.join(home, ".local", "share", "pnpm"),
      // pnpm on macOS commonly uses ~/Library/pnpm
      path.join(home, "Library", "pnpm"),
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/opt/homebrew/opt/node/bin",
    );
  }
  const parts = current.split(sep).filter(Boolean);
  for (const e of extras) {
    if (e && !parts.includes(e)) parts.push(e);
  }
  const next = { ...env, PATH: parts.join(sep) };
  if (process.platform === "win32") next.Path = next.PATH;
  return next;
}

function isElectronBinary(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const base = path.basename(filePath);
  if (/electron/i.test(base)) return true;
  // Packaged macOS: .../Pi Desktop.app/Contents/MacOS/Pi Desktop
  if (/\.app\/Contents\/MacOS\//i.test(normalized)) return true;
  // Never treat this Electron process itself as a Node binary.
  if (
    typeof process.versions.electron === "string" &&
    path.resolve(filePath) === path.resolve(process.execPath)
  ) {
    return true;
  }
  return false;
}

function acceptNodeBinary(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  if (!existsSync(filePath)) return undefined;
  if (isElectronBinary(filePath)) return undefined;
  return filePath;
}

/** Process-lifetime cache — avoid sync where/which on every session open/create. */
let cachedSystemNode: { key: string; value: string | undefined } | null = null;

function systemNodeCacheKey(env: NodeJS.ProcessEnv): string {
  const override = env[PI_DESKTOP_NODE_PATH_ENV]?.trim() ?? "";
  const pathVar = env.PATH || env.Path || "";
  return `${override}\0${pathVar}`;
}

/** Resolve a real Node.js binary (not Electron) for spawning Pi CLI / subagents. */
export function resolveSystemNodeExecutable(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const override = env[PI_DESKTOP_NODE_PATH_ENV]?.trim();
  if (override) {
    if (isElectronBinary(override)) return undefined;
    return acceptNodeBinary(override) ?? (existsSync(override) ? override : undefined);
  }

  const cacheKey = systemNodeCacheKey(env);
  if (cachedSystemNode?.key === cacheKey) {
    return cachedSystemNode.value;
  }

  const resolved = resolveSystemNodeExecutableUncached(env);
  cachedSystemNode = { key: cacheKey, value: resolved };
  return resolved;
}

/** Test helper — clear process-lifetime node resolution cache. */
export function clearSystemNodeExecutableCache(): void {
  cachedSystemNode = null;
}

function resolveSystemNodeExecutableUncached(
  env: NodeJS.ProcessEnv,
): string | undefined {
  const home = env.HOME || env.USERPROFILE || homedir();
  // Prefer cheap existsSync probes before shelling out to where/which (can block
  // the Electron main process for seconds and stall sessions:open IPC).
  const candidates =
    process.platform === "win32"
      ? [
          path.join("C:", "nvm4w", "nodejs", "node.exe"),
          path.join(env.ProgramFiles || "C:\\Program Files", "nodejs", "node.exe"),
          path.join(
            env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
            "nodejs",
            "node.exe",
          ),
        ]
      : [
          "/usr/local/bin/node",
          "/opt/homebrew/bin/node",
          "/opt/homebrew/opt/node/bin/node",
          path.join(home, ".local", "share", "fnm", "aliases", "default", "bin", "node"),
          path.join(home, ".nvm", "current", "bin", "node"),
          path.join(home, ".volta", "bin", "node"),
        ];

  for (const c of candidates) {
    const hit = acceptNodeBinary(c);
    if (hit) return hit;
  }

  const lookupEnv = augmentPathForPiCli(env);
  try {
    if (process.platform === "win32") {
      const out = execFileSync("where.exe", ["node"], {
        encoding: "utf8",
        env: lookupEnv,
        windowsHide: true,
        timeout: 1500,
      });
      for (const line of out.split(/\r?\n/)) {
        const hit = acceptNodeBinary(line.trim());
        if (hit) return hit;
      }
    } else {
      const out = execFileSync("which", ["node"], {
        encoding: "utf8",
        env: lookupEnv,
        timeout: 1500,
      });
      for (const line of out.split(/\n/)) {
        const hit = acceptNodeBinary(line.trim());
        if (hit) return hit;
      }
    }
  } catch {
    // fall through
  }

  // Last resort: if this process itself is Node (unit tests / non-Electron), use it.
  return acceptNodeBinary(process.execPath);
}

export function packageRootFromPiCli(cliPath: string): string {
  // …/pi-coding-agent/dist/cli.js → package root
  return path.resolve(path.dirname(cliPath), "..");
}

/** Resolve @earendil-works/pi-coding-agent dist/cli.js from app roots or common installs. */
export function resolvePiCodingAgentCliPath(
  searchRoots: string[],
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const override = env[PI_DESKTOP_PI_CLI_PATH_ENV]?.trim();
  if (override && existsSync(override)) return override;

  for (const root of searchRoots) {
    if (!root) continue;
    const candidate = path.join(root, PI_CLI_REL);
    if (existsSync(candidate)) return candidate;
  }

  const home = env.HOME || env.USERPROFILE || homedir();
  const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const globalCandidates =
    process.platform === "win32"
      ? [
          path.join(local, "pnpm", "global", "5", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"),
          path.join(
            env.APPDATA || path.join(home, "AppData", "Roaming"),
            "npm",
            "node_modules",
            "@earendil-works",
            "pi-coding-agent",
            "dist",
            "cli.js",
          ),
        ]
      : [
          path.join(
            home,
            ".local",
            "share",
            "pnpm",
            "global",
            "5",
            "node_modules",
            "@earendil-works",
            "pi-coding-agent",
            "dist",
            "cli.js",
          ),
          path.join(
            home,
            "Library",
            "pnpm",
            "global",
            "5",
            "node_modules",
            "@earendil-works",
            "pi-coding-agent",
            "dist",
            "cli.js",
          ),
          path.join(
            home,
            ".npm-global",
            "lib",
            "node_modules",
            "@earendil-works",
            "pi-coding-agent",
            "dist",
            "cli.js",
          ),
          "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
          "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
        ];

  for (const c of globalCandidates) {
    if (existsSync(c)) return c;
  }

  // Parse package-manager shims for an absolute cli.js path
  if (process.platform === "win32") {
    const shims = [
      path.join(local, "pnpm", "pi.CMD"),
      path.join(local, "pnpm", "pi.cmd"),
      path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "npm", "pi.cmd"),
    ];
    for (const shim of shims) {
      const extracted = extractCliPathFromWindowsShim(shim);
      if (extracted) return extracted;
    }
  } else {
    const shims = [
      path.join(home, "Library", "pnpm", "pi"),
      path.join(home, ".local", "share", "pnpm", "pi"),
      path.join(home, ".bun", "bin", "pi"),
      "/usr/local/bin/pi",
      "/opt/homebrew/bin/pi",
    ];
    for (const shim of shims) {
      const extracted = extractCliPathFromUnixShim(shim);
      if (extracted) return extracted;
    }
  }

  return undefined;
}

function extractCliPathFromWindowsShim(shimPath: string): string | undefined {
  if (!existsSync(shimPath)) return undefined;
  try {
    const body = readFileSync(shimPath, "utf8");
    const m = body.match(
      /["']([^"']*[@]earendil-works[\\/]+pi-coding-agent[\\/]+dist[\\/]+cli\.js)["']/i,
    );
    if (m?.[1]) {
      const abs = path.resolve(path.dirname(shimPath), m[1]);
      // Shim may use %~dp0-relative or absolute; prefer absolute match from body
      if (existsSync(m[1])) return m[1];
      if (existsSync(abs)) return abs;
    }
    // Relative to shim dir: "%~dp0\global\5\.pnpm\...\cli.js"
    const rel = body.match(
      /%~dp0[\\/]+((?:global|node_modules)[^"'\r\n]*cli\.js)/i,
    );
    if (rel?.[1]) {
      const abs = path.join(path.dirname(shimPath), rel[1].replace(/\//g, path.sep));
      if (existsSync(abs)) return abs;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** pnpm/npm unix shims embed `…/pi-coding-agent/dist/cli.js` in the exec line. */
function extractCliPathFromUnixShim(shimPath: string): string | undefined {
  if (!existsSync(shimPath)) return undefined;
  try {
    const body = readFileSync(shimPath, "utf8");
    const m = body.match(
      /((?:\/|~)[^'"\s]*@earendil-works\/pi-coding-agent\/dist\/cli\.js)/,
    );
    if (m?.[1]) {
      let candidate = m[1];
      if (candidate.startsWith("~/")) {
        candidate = path.join(homedir(), candidate.slice(2));
      }
      if (existsSync(candidate)) return candidate;
    }
    // basedir-relative: "$basedir/global/5/.pnpm/…/cli.js"
    const rel = body.match(
      /\$basedir\/((?:global|node_modules)[^'"\s]*cli\.js)/,
    );
    if (rel?.[1]) {
      const abs = path.join(path.dirname(shimPath), rel[1]);
      if (existsSync(abs)) return abs;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export interface BuildAgentWorkerEnvOptions {
  searchRoots?: string[];
}

/**
 * Env for the agent utilityProcess so pi-subagents can spawn real Pi children.
 * Sets PI_DESKTOP_* for the worker-side execPath/argv fix; also sets package root
 * for child inheritance. Clears Windows .cmd PI_SUBAGENT_PI_BINARY overrides that
 * spawn() cannot run without shell:true.
 *
 * Packaged builds: system Node cannot execute scripts inside app.asar — if the only
 * CLI is asar-hosted, omit PI_DESKTOP_NODE_PATH so the worker applies Electron-as-Node
 * *after* boot (never set ELECTRON_RUN_AS_NODE on utilityProcess.fork env — that
 * breaks parentPort IPC and causes sessions:open "reply was never sent").
 */
export function buildAgentWorkerEnv(
  env: NodeJS.ProcessEnv,
  options: BuildAgentWorkerEnvOptions = {},
): NodeJS.ProcessEnv {
  const next = augmentPathForPiCli({ ...env });
  // utilityProcess must boot as a normal Electron utility process. Stripping this
  // also guards against a polluted parent env. Worker sets it post-boot for children.
  delete next.ELECTRON_RUN_AS_NODE;

  const searchRoots = options.searchRoots ?? [];
  let nodePath = resolveSystemNodeExecutable(next);
  let cliPath = resolvePiCodingAgentCliPath(searchRoots, next);

  // Prefer a real-filesystem CLI when pairing with system Node.
  if (cliPath && isInsideElectronAsar(cliPath) && nodePath) {
    const filesystemCli = resolvePiCodingAgentCliPath([], next);
    if (filesystemCli && !isInsideElectronAsar(filesystemCli)) {
      cliPath = filesystemCli;
    } else {
      // Electron-as-Node can read asar; system Node cannot.
      nodePath = undefined;
    }
  }

  if (nodePath) {
    next[PI_DESKTOP_NODE_PATH_ENV] = nodePath;
  } else {
    delete next[PI_DESKTOP_NODE_PATH_ENV];
  }
  if (cliPath) {
    next[PI_DESKTOP_PI_CLI_PATH_ENV] = cliPath;
    next[PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT_ENV] = packageRootFromPiCli(cliPath);
  }

  // Windows .cmd/.bat cannot be spawn()'d without shell:true (EINVAL). pi-subagents
  // uses spawn without shell, so clear a shim override when we can use node+cli
  // or Electron-as-Node with an explicit CLI script.
  const binary = next[PI_SUBAGENT_PI_BINARY_ENV]?.trim();
  if (binary && cliPath && /\.(cmd|bat)$/i.test(binary)) {
    delete next[PI_SUBAGENT_PI_BINARY_ENV];
  }

  return next;
}
