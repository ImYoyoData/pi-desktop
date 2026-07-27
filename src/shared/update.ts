/** GitHub Releases update check helpers (shared, no Node APIs). */

export type UpdateCheckStatus =
  | "upToDate"
  | "available"
  | "downloaded"
  | "openedBrowser"
  | "error";

export type UpdateCheckResult = {
  status: UpdateCheckStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  assetName: string | null;
  message: string;
};

export type UpdateProgress = {
  phase: "download" | "done" | "error";
  receivedBytes: number;
  totalBytes: number | null;
  message: string;
};

export type GhReleaseAsset = {
  name: string;
  browser_download_url: string;
  size: number;
};

export type GhRelease = {
  tag_name: string;
  name?: string | null;
  body?: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  assets: GhReleaseAsset[];
};

/** Parse `1.2.3` / `v1.2.3` into [major, minor, patch]. */
export function parseSemver(version: string): [number, number, number] | null {
  const m = String(version)
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True when `latest` is strictly newer than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return latest.replace(/^v/i, "") !== current.replace(/^v/i, "");
  for (let i = 0; i < 3; i++) {
    if (a[i]! > b[i]!) return true;
    if (a[i]! < b[i]!) return false;
  }
  return false;
}

/**
 * Pick the best installer asset for the running OS/arch.
 * Prefers NSIS/setup on Windows and DMG on macOS.
 */
export function pickReleaseAsset(
  assets: GhReleaseAsset[],
  platform: NodeJS.Platform,
  arch: string,
): GhReleaseAsset | null {
  const names = assets.map((a) => a.name.toLowerCase());
  const find = (...predicates: ((n: string) => boolean)[]): GhReleaseAsset | null => {
    for (const pred of predicates) {
      const idx = names.findIndex(pred);
      if (idx >= 0) return assets[idx]!;
    }
    return null;
  };

  if (platform === "win32") {
    if (arch === "arm64") {
      return find(
        (n) => n.includes("win-arm64") && n.endsWith("-setup.exe"),
        (n) => n.includes("win-arm64") && n.endsWith(".exe") && !n.includes("blockmap"),
      );
    }
    return find(
      (n) => n.includes("win-x64") && n.endsWith("-setup.exe"),
      (n) => n.includes("win-x64") && n.endsWith(".exe") && !n.includes("blockmap"),
      (n) => n.includes("win") && n.endsWith("-setup.exe") && !n.includes("arm64"),
      (n) => n.includes("win") && n.endsWith(".exe") && !n.includes("arm64") && !n.includes("blockmap"),
    );
  }

  if (platform === "darwin") {
    if (arch === "arm64") {
      return find(
        (n) => n.includes("mac-arm64") && n.endsWith(".dmg"),
        (n) => n.includes("arm64") && n.endsWith(".dmg"),
        (n) => n.includes("mac-arm64") && n.endsWith(".zip"),
      );
    }
    return find(
      (n) => n.includes("mac-x64") && n.endsWith(".dmg"),
      (n) => n.includes("x64") && n.endsWith(".dmg") && n.includes("mac"),
      (n) => n.includes("mac-x64") && n.endsWith(".zip"),
    );
  }

  if (platform === "linux") {
    if (arch === "arm64") {
      return find((n) => n.includes("linux") && n.includes("arm64") && n.endsWith(".AppImage"));
    }
    return find(
      (n) => n.includes("linux") && n.includes("x64") && n.endsWith(".AppImage"),
      (n) => n.endsWith(".AppImage"),
    );
  }

  return null;
}

export function emptyUpdateResult(
  status: UpdateCheckStatus,
  currentVersion: string,
  message: string,
  extra?: Partial<UpdateCheckResult>,
): UpdateCheckResult {
  return {
    status,
    currentVersion,
    latestVersion: null,
    releaseUrl: null,
    releaseName: null,
    releaseNotes: null,
    assetName: null,
    message,
    ...extra,
  };
}
