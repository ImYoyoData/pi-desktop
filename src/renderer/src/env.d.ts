/// <reference types="vite/client" />
/// <reference types="electron" />

declare namespace JSX {
  interface IntrinsicElements {
    webview: Electron.WebviewHTMLAttributes & {
      src?: string;
      allowpopups?: boolean | string;
      class?: string;
      ref?: unknown;
    };
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
