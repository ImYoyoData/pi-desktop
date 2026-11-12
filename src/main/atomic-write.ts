import fs from "node:fs";
import path from "node:path";

export type AtomicWriteOptions = {
  mode?: number;
  mkdir?: boolean;
};

function tempPath(filePath: string): string {
  return `${filePath}.${process.pid}.${Date.now()}.tmp`;
}

function writeOptions(options: AtomicWriteOptions): { mode?: number } {
  return options.mode === undefined ? {} : { mode: options.mode };
}

function ensureDir(filePath: string, options: AtomicWriteOptions): void {
  if (options.mkdir === false) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

/** 先写临时文件再 rename，避免中途崩溃留下半截文件。 */
export function writeFileAtomicSync(
  filePath: string,
  data: string | Buffer,
  options: AtomicWriteOptions = {},
): void {
  ensureDir(filePath, options);
  const tmp = tempPath(filePath);
  try {
    const base = writeOptions(options);
    if (typeof data === "string") {
      fs.writeFileSync(tmp, data, { ...base, encoding: "utf8" });
    } else {
      fs.writeFileSync(tmp, data, base);
    }
    fs.renameSync(tmp, filePath);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // 清理失败不掩盖原始错误
    }
    throw error;
  }
}

export async function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  ensureDir(filePath, options);
  const tmp = tempPath(filePath);
  try {
    const base = writeOptions(options);
    if (typeof data === "string") {
      await fs.promises.writeFile(tmp, data, { ...base, encoding: "utf8" });
    } else {
      await fs.promises.writeFile(tmp, data, base);
    }
    await fs.promises.rename(tmp, filePath);
  } catch (error) {
    await fs.promises.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function writeJsonAtomicSync(
  filePath: string,
  data: unknown,
  options: AtomicWriteOptions = {},
): void {
  writeFileAtomicSync(filePath, `${JSON.stringify(data, null, 2)}\n`, options);
}
