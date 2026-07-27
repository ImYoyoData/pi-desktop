export type PreviewResult =
  | { kind: "text"; path: string; content: string; truncated?: boolean }
  | { kind: "markdown"; path: string; content: string; truncated?: boolean }
  | { kind: "image"; path: string; dataUrl: string; mediaSrc?: string }
  | { kind: "video"; path: string; mediaSrc: string }
  | { kind: "audio"; path: string; mediaSrc: string }
  | { kind: "unsupported"; path: string; reason?: "binary" | "type" }
  | { kind: "error"; message: string; path?: string };
