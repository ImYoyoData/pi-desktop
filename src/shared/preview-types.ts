export type PreviewResult =
  | { kind: "text"; path: string; content: string; truncated?: boolean }
  | { kind: "markdown"; path: string; content: string; truncated?: boolean }
  | { kind: "image"; path: string; dataUrl: string }
  | { kind: "unsupported"; path: string }
  | { kind: "error"; message: string; path?: string };
