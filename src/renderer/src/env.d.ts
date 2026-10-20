/// <reference types="vite/client" />
/// <reference types="electron" />

declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        webview: React.DetailedHTMLProps<
          React.HTMLAttributes<Electron.WebviewTag>,
          Electron.WebviewTag
        > & {
          src?: string;
          allowpopups?: boolean | string;
        };
      }
    }
  }
}

declare module "*.mp3" {
  const src: string;
  export default src;
}
