/**
 * JSON.stringify 的安全版本：IPC（结构化克隆）可以携带 BigInt 与循环引用，
 * 直接 stringify 会抛错并让调用方（渲染路径）中断。
 */
export function safeStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(
      value,
      (_key, current) => {
        if (typeof current === "bigint") return current.toString();
        if (current && typeof current === "object") {
          if (seen.has(current as object)) return "[Circular]";
          seen.add(current as object);
        }
        return current;
      },
      space,
    );
    return json ?? "";
  } catch {
    return "";
  }
}
