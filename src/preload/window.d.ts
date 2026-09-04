import type { PiDesktopApi } from "./index";
import type { ElectronAPI } from "@electron-toolkit/preload";

declare global {
  interface Window {
    electron: ElectronAPI;
    api: PiDesktopApi;
  }
}

export {};
