/** Pi package catalog (https://pi.dev/packages) */

export const PI_PACKAGES_CATALOG_URL = "https://pi.dev/packages";

export type PiPackageType = "extension" | "skill" | "theme" | "prompt" | "";

export type PiPackageListItem = {
  name: string;
  description: string;
  path: string;
  /** Relative age label from catalog when present (e.g. "15m ago"). */
  updatedLabel?: string;
};

export type PiPackageListResult = {
  ok: boolean;
  items: PiPackageListItem[];
  totalHint: string | null;
  /** 1-based page that was fetched. */
  page: number;
  /** True when the catalog has another page after this one. */
  hasMore: boolean;
  error: string | null;
  sourceUrl: string;
};

/** Catalog page size observed on pi.dev/packages (HTML scrape). */
export const PI_PACKAGES_PAGE_SIZE = 50;

/** Whether another catalog page exists after the current fetch. */
export function piPackagesHasMore(
  totalHint: string | null,
  page: number,
  itemCount: number,
): boolean {
  if (totalHint) {
    // e.g. "51-100 / 5364" or "1-50 / 5364"
    const m = totalHint.match(/(\d+)\s*[-–]\s*(\d+)\s*\/\s*(\d+)/);
    if (m) {
      const end = Number(m[2]);
      const total = Number(m[3]);
      if (Number.isFinite(end) && Number.isFinite(total)) return end < total;
    }
    const slash = totalHint.match(/\/\s*(\d+)/);
    if (slash) {
      const total = Number(slash[1]);
      if (Number.isFinite(total)) return page * PI_PACKAGES_PAGE_SIZE < total;
    }
  }
  return itemCount >= PI_PACKAGES_PAGE_SIZE;
}

export type PiPackageInstallResult = {
  ok: boolean;
  command: string;
  log: string;
  error: string | null;
};

export function piInstallCommand(packageName: string): string {
  const name = packageName.trim();
  return `pi install npm:${name}`;
}

/** 插件的本地/最新版本与可更新状态（按 source 与 scope 定位插件列表行）。 */
export type PluginVersionInfo = {
  source: string;
  scope: "global" | "project";
  /** 本地安装版本（未知时为 null）。 */
  currentVersion: string | null;
  /** npm 最新版本（未知或非 npm 源时为 null）。 */
  latestVersion: string | null;
  /** 是否有可用更新。 */
  hasUpdate: boolean;
};
