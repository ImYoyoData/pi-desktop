import type { PiDesktopApi } from "../shared/api";

export type RendererElectronApi = {
  process: { versions: Record<string, string | undefined> };
};

declare global {
  interface Window {
    electron: RendererElectronApi;
    api: PiDesktopApi;
  }
}

export {};
