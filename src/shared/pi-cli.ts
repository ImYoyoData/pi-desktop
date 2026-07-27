/** Pi CLI presence / install helpers shared with renderer. */

export const PI_CLI_PACKAGE = "@earendil-works/pi-coding-agent";
export const PI_INSTALL_URL = "https://pi.dev/";
export const PI_DOCS_INSTALL_URL = "https://pi.dev/docs/latest";
export const PI_INSTALL_SH = "https://pi.dev/install.sh";
export const PI_INSTALL_PS1 = "https://pi.dev/install.ps1";

export type PiCliInstallMethod = "bun" | "pnpm" | "npm" | "powershell" | "curl";

export type PiCliStatus = {
  installed: boolean;
  /** Absolute path to `pi` when found. */
  path: string | null;
  version: string | null;
  platform: NodeJS.Platform;
  /** Methods available on this machine (detected before install). */
  availableMethods: PiCliInstallMethod[];
  /** Preferred method we will try first. */
  preferredMethod: PiCliInstallMethod | null;
};

export type PiCliInstallProgress = {
  phase: "detect" | "install" | "verify" | "done" | "error";
  method: PiCliInstallMethod | null;
  message: string;
};

export type PiCliInstallResult = {
  ok: boolean;
  method: PiCliInstallMethod | null;
  status: PiCliStatus;
  log: string;
  error: string | null;
  /** True when an interactive system console/terminal was opened for the official installer. */
  openedExternal?: boolean;
};
