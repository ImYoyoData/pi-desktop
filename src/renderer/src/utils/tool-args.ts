/** 工具参数的小型读取器：给 tool-diff / structured-text 共用，避免模块环。 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function clipText(text: string, max = 64): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function toolPathFromArgs(args: unknown): string | null {
  if (!isRecord(args)) return null;
  const path = args.path ?? args.file_path ?? args.filePath;
  return typeof path === "string" && path.trim() ? path.trim() : null;
}

export function toolCommandFromArgs(args: unknown): string | null {
  if (!isRecord(args)) return null;
  const command = args.command ?? args.cmd;
  return typeof command === "string" && command.trim() ? command.trim() : null;
}
