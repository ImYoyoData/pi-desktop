/**
 * Pure path logic for finding a bundled cloudflared binary.
 *
 * Kept free of Electron so it can be unit tested — the packaged-app bugs here
 * were subtle and expensive (see the notes on `pickCloudflaredPath`), and they
 * only reproduce inside an Electron runtime.
 */

export type BinaryLayout = {
  platform: string;
  arch: string;
  /** electron-builder extraResources root: `<install>/resources`. */
  resourcesPath?: string;
  /** Executable path of the running app (`<install>/PiDesktop.exe`). */
  execPath: string;
  /** Directory of the compiled bundle (`<repo>/out/main` in dev). */
  bundleDir: string;
};

export function cloudflaredFileName(platform: string): string {
  return platform === "win32" ? "cloudflared.exe" : "cloudflared";
}

/**
 * Candidate paths for the bundled binary, most specific first.
 *
 * Two layouts occur in practice:
 * - our prefetch writes `resources/cloudflared/<version>/<arch>/<file>`
 * - electron-builder FLATTENS the `${arch}` directory when copying
 *   extraResources, landing the file at `resources/cloudflared/<version>/<file>`
 * Both are searched. In dev the checkout is found by walking up from the bundle.
 */
export function cloudflaredCandidates(version: string, layout: BinaryLayout): string[] {
  const file = cloudflaredFileName(layout.platform);
  const variants: string[][] = [
    ["resources", "cloudflared", version, layout.arch, file],
    ["resources", "cloudflared", version, file],
  ];
  const roots: string[] = [];
  if (layout.resourcesPath) {
    roots.push(layout.resourcesPath, joinPosix(layout.resourcesPath, ".."));
  }
  roots.push(joinPosix(layout.execPath, ".."));
  let dir = layout.bundleDir;
  for (let depth = 0; depth < 4; depth += 1) {
    dir = joinPosix(dir, "..");
    roots.push(dir);
  }
  const out: string[] = [];
  for (const root of roots) {
    for (const variant of variants) out.push(joinPosix(root, ...variant));
  }
  return [...new Set(out)];
}

/**
 * Minimal path join + normalise (avoids importing node:path so the module stays
 * pure and testable). Collapsing `.`/`..` matters: the walk-up roots otherwise
 * produce strings like `C:\App\resources\..\resources\...`, which resolve but make
 * the candidate list (also used for error diagnostics) misleading.
 */
function joinPosix(base: string, ...parts: string[]): string {
  const usesBackslash = base.includes("\\");
  const combined = [base, ...parts].join("/").replace(/\\/gu, "/");
  // Split the Windows drive prefix off BEFORE segment handling, otherwise "C:"
  // is treated as a normal segment and gets duplicated into `C:\C:\...`.
  const drive = /^([a-z]:)(?=\/|$)/iu.exec(combined)?.[1] ?? "";
  let rest = drive ? combined.slice(drive.length) : combined;
  const absolute = rest.startsWith("/");
  const out: string[] = [];
  for (const segment of rest.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!absolute && !drive) out.push("..");
      continue;
    }
    out.push(segment);
  }
  const sep = usesBackslash ? "\\" : "/";
  const body = out.join(sep);
  if (drive) return `${drive}${sep}${body}`;
  return absolute ? `${sep}${body}` : body;
}

/**
 * True when `candidate` is a path we could actually spawn.
 *
 * The `.asar` rejection is the important part: Electron patches `fs` so paths
 * INSIDE an asar archive report as existing (and `statSync` returns the archive's
 * own size), but a file inside the archive cannot be executed. Without this check
 * a packaged build "finds" `<install>\resources\app.asar\resources\…\cloudflared.exe`
 * and then dies with ENOENT at spawn time — which is exactly what happened.
 */
export function isSpawnablePath(candidate: string, stat: (p: string) => { isFile(): boolean; size: number }): boolean {
  if (!candidate) return false;
  if (candidate.includes(".asar")) return false;
  const segments = candidate.split(/[\\/]+/u);
  if (segments.includes("app.asar") || segments.includes("app.asar.unpacked")) return false;
  try {
    const info = stat(candidate);
    return info.isFile() && info.size > 1_000_000;
  } catch {
    return false;
  }
}

/** First spawnable candidate, or null when this build ships no binary. */
export function pickCloudflaredPath(
  version: string,
  layout: BinaryLayout,
  stat: (p: string) => { isFile(): boolean; size: number },
): string | null {
  for (const candidate of cloudflaredCandidates(version, layout)) {
    if (isSpawnablePath(candidate, stat)) return candidate;
  }
  return null;
}
