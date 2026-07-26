import { ElectronAPI } from "@electron-toolkit/preload";
import type { PiDesktopApi } from "./index";

declare global {
  interface Window {
    electron: ElectronAPI;
    api: PiDesktopApi;
  }
}

export {};
