/**
 * JSON.stringify 的安全版本：IPC（结构化克隆）可以携带 BigInt 与循环引用，
 * 直接 stringify 会抛错并让调用方（渲染路径）中断。
 */
function sanitizeValue(value: unknown, ancestors: Set<object>): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  const obj = value as object;
  if (ancestors.has(obj)) return "[Circular]";
  ancestors.add(obj);
  try {
    if (Array.isArray(obj)) return obj.map((item) => sanitizeValue(item, ancestors));
    const toJSON = (obj as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") {
      const replaced = (toJSON as () => unknown).call(obj);
      return replaced === obj ? "[Circular]" : sanitizeValue(replaced, ancestors);
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(obj)) {
      out[key] = sanitizeValue(item, ancestors);
    }
    return out;
  } finally {
    ancestors.delete(obj);
  }
}

export function safeStringify(value: unknown, space?: number): string {
  try {
    return JSON.stringify(sanitizeValue(value, new Set()), null, space) ?? "";
  } catch {
    return "";
  }
}

