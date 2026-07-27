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
  error: string | null;
  sourceUrl: string;
};

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
