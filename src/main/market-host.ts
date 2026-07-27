import { ipcMain } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { IpcChannels } from "../shared/protocol";
import {
  PI_PACKAGES_CATALOG_URL,
  piInstallCommand,
  type PiPackageInstallResult,
  type PiPackageListItem,
  type PiPackageListResult,
  type PiPackageType,
} from "../shared/pi-market";

async function resolvePiPath(): Promise<string | null> {
  const home = homedir();
  const names =
    process.platform === "win32"
      ? [
          join(home, ".bun", "bin", "pi.exe"),
          join(home, "AppData", "Roaming", "npm", "pi.cmd"),
          join(home, "AppData", "Local", "pnpm", "pi.CMD"),
          join(home, "AppData", "Local", "pnpm", "pi.exe"),
        ]
      : [
          join(home, ".bun", "bin", "pi"),
          join(home, ".local", "share", "pnpm", "pi"),
          join(home, ".npm-global", "bin", "pi"),
          "/usr/local/bin/pi",
          "/opt/homebrew/bin/pi",
        ];
  for (const p of names) {
    if (existsSync(p)) return p;
  }
  // Fall back to PATH lookup via `where`/`which` is heavier; try bare `pi`.
  return process.platform === "win32" ? "pi.cmd" : "pi";
}

function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCatalogHtml(html: string): { items: PiPackageListItem[]; totalHint: string | null } {
  const items: PiPackageListItem[] = [];
  const seen = new Set<string>();

  // Main grid cards: <h3 class="packages-name"><a ...>name</a></h3><p class="packages-desc">...</p>
  const cardRe =
    /class="packages-name"\s*>\s*<a\s+[^>]*href="\/packages\/([^"?#]+)[^"]*"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>\s*<p\s+class="packages-desc">([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html)) !== null) {
    const name = decodeURIComponent(m[1]!).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    items.push({
      name,
      description: decodeHtml(m[3] ?? ""),
      path: `/packages/${name}`,
    });
  }

  // Recent strip fallback
  const recentRe =
    /<a\s+[^>]*href="\/packages\/([^"?#]+)[^"]*"[^>]*class="[^"]*packages-recent-item[^"]*"[^>]*>\s*<strong>([\s\S]*?)<\/strong>\s*<span>([\s\S]*?)<\/span>(?:\s*<small>([\s\S]*?)<\/small>)?/gi;
  while ((m = recentRe.exec(html)) !== null) {
    const name = decodeURIComponent(m[1]!).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    items.push({
      name,
      description: decodeHtml(m[3] ?? ""),
      path: `/packages/${name}`,
      updatedLabel: m[4] ? decodeHtml(m[4]) : undefined,
    });
  }

  const totalMatch = html.match(/class="packages-count"[^>]*>([^<]+)</i);
  return {
    items,
    totalHint: totalMatch?.[1]?.trim() ?? null,
  };
}

export async function listPiPackages(opts?: {
  query?: string;
  type?: PiPackageType;
}): Promise<PiPackageListResult> {
  const params = new URLSearchParams();
  const q = opts?.query?.trim();
  if (q) params.set("name", q);
  if (opts?.type) params.set("type", opts.type);
  const sourceUrl = params.toString()
    ? `${PI_PACKAGES_CATALOG_URL}?${params.toString()}`
    : PI_PACKAGES_CATALOG_URL;

  try {
    const res = await fetch(sourceUrl, {
      headers: {
        Accept: "text/html",
        "User-Agent": "pi-desktop",
      },
    });
    if (!res.ok) {
      return {
        ok: false,
        items: [],
        totalHint: null,
        error: `HTTP ${res.status}`,
        sourceUrl,
      };
    }
    const html = await res.text();
    const { items, totalHint } = parseCatalogHtml(html);
    return { ok: true, items, totalHint, error: null, sourceUrl };
  } catch (err) {
    return {
      ok: false,
      items: [],
      totalHint: null,
      error: err instanceof Error ? err.message : String(err),
      sourceUrl,
    };
  }
}

export async function installPiPackage(packageName: string): Promise<PiPackageInstallResult> {
  const name = packageName.trim();
  if (!name || /[\s;|&<>]/.test(name)) {
    return { ok: false, command: "", log: "", error: "Invalid package name" };
  }
  const command = piInstallCommand(name);
  const piPath = await resolvePiPath();
  if (!piPath) {
    return { ok: false, command, log: "", error: "Pi CLI not found — install Pi first" };
  }

  return new Promise((resolve) => {
    const args = ["install", `npm:${name}`];
    const child = spawn(piPath, args, {
      windowsHide: true,
      shell: process.platform === "win32",
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve({ ok: false, command, log, error: "Install timed out" });
    }, 180_000);
    child.stdout?.on("data", (d) => {
      log += String(d);
    });
    child.stderr?.on("data", (d) => {
      log += String(d);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, command, log, error: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, command, log, error: null });
      } else {
        resolve({
          ok: false,
          command,
          log,
          error: `Exit code ${code ?? 1}`,
        });
      }
    });
  });
}

export function registerMarketIpc(): void {
  ipcMain.handle(
    IpcChannels.market.list,
    (_event, opts?: { query?: string; type?: PiPackageType }) => listPiPackages(opts),
  );
  ipcMain.handle(IpcChannels.market.install, (_event, packageName: string) =>
    installPiPackage(packageName),
  );
}
