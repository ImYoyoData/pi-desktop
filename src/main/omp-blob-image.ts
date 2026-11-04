import fs from "node:fs";
import path from "node:path";
import { ompAgentDir } from "./omp-dir";

const BLOB_PREFIX = "blob:sha256:";
const HASH_RE = /^[a-f0-9]{64}$/;
const CACHE_BYTES = 16 * 1024 * 1024;

const cache = new Map<string, string>();
let cacheBytes = 0;
let blobsDirOverride: string | null = null;

export function isOmpBlobRef(value: string): boolean {
  return (
    value.startsWith(BLOB_PREFIX) && HASH_RE.test(value.slice(BLOB_PREFIX.length))
  );
}

/** worker ready 时上报的 SDK 实际 blob 目录；默认环境与本地推导一致，但 XDG/profile 下不同。 */
export function setOmpBlobsDir(dir: string): void {
  const trimmed = dir.trim();
  blobsDirOverride = trimmed || null;
}

/** 先试 worker 上报的目录，再按 SDK 的环境规则兜底（hash 内容寻址，多目录尝试安全）。 */
function blobDirs(): string[] {
  const dirs: string[] = [];
  if (blobsDirOverride) dirs.push(blobsDirOverride);
  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim();
  if (agentDir) dirs.push(path.join(path.resolve(agentDir), "blobs"));
  const xdgData = process.env.XDG_DATA_HOME?.trim();
  if (xdgData && (process.platform === "linux" || process.platform === "darwin")) {
    dirs.push(path.join(xdgData, "omp", "blobs"));
  }
  dirs.push(path.join(ompAgentDir(), "blobs"));
  return [...new Set(dirs)];
}

/** omp 把图片外置成 `blob:sha256:<hash>`，这里读回 base64；缺失或引用非法返回 null。 */
export function readOmpBlobBase64(ref: string): string | null {
  if (!isOmpBlobRef(ref)) return null;
  const hash = ref.slice(BLOB_PREFIX.length);
  const hit = cache.get(hash);
  if (hit !== undefined) return hit;
  let bytes: Buffer | null = null;
  for (const dir of blobDirs()) {
    try {
      bytes = fs.readFileSync(path.join(dir, hash));
      break;
    } catch {
      // 换下一个候选目录
    }
  }
  if (!bytes) return null;
  const base64 = bytes.toString("base64");
  if (base64.length <= CACHE_BYTES) {
    for (const [key, value] of cache) {
      if (cacheBytes + base64.length <= CACHE_BYTES) break;
      cache.delete(key);
      cacheBytes -= value.length;
    }
    cache.set(hash, base64);
    cacheBytes += base64.length;
  }
  return base64;
}

/** worker 事件里的用户图片可能是 blob 引用，就地还原成 base64 再交给渲染层。 */
export function hydrateOmpEventImages(event: Record<string, unknown>): void {
  if (
    event.type !== "message_start" &&
    event.type !== "message_update" &&
    event.type !== "message_end"
  ) {
    return;
  }
  const message = event.message as
    | { role?: unknown; content?: unknown }
    | undefined;
  if (!message || message.role !== "user" || !Array.isArray(message.content)) {
    return;
  }
  for (const part of message.content) {
    if (!part || typeof part !== "object") continue;
    const image = part as { type?: unknown; data?: unknown };
    if (image.type !== "image" || typeof image.data !== "string") continue;
    const base64 = readOmpBlobBase64(image.data);
    if (base64) image.data = base64;
  }
}
