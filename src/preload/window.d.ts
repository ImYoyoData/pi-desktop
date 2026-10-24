import type { PiDesktopApi } from "../shared/api";
import type { ElectronAPI } from "@electron-toolkit/preload";

declare global {
  interface Window {
    electron: ElectronAPI;
    api: PiDesktopApi;
  }
}

export {};
