/// <reference types="vite/client" />
/// <reference types="electron" />

import type { PiDesktopApi } from "../../preload/index";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: Electron.WebviewHTMLAttributes & {
        src?: string;
        allowpopups?: boolean | string;
        class?: string;
        ref?: unknown;
      };
    }
  }

  interface Window {
    api: PiDesktopApi;
  }
}

declare module "vue" {
  export interface GlobalComponents {
    webview: Electron.WebviewHTMLAttributes;
  }
}

declare module "*.mp3" {
  const src: string;
  export default src;
}
