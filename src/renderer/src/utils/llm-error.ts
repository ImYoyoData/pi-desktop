/** Map raw LLM / network errors to short Chinese (or English) UI copy. */

type Rule = { test: (text: string) => boolean; zh: string; en: string };

const RULES: Rule[] = [
  {
    test: (t) => /api[_ ]?key|invalid.?key|unauthorized|401|authentication/i.test(t) || t.includes("鉴权") || t.includes("密钥"),
    zh: "API Key 无效或未配置，请到模型设置中检查。",
    en: "Invalid or missing API key. Check Model Settings.",
  },
  {
    test: (t) => /403|forbidden|permission denied/i.test(t),
    zh: "没有访问该模型的权限。",
    en: "Permission denied for this model.",
  },
  {
    test: (t) => /429|rate.?limit|too many requests|overloaded/i.test(t) || t.includes("配额") || t.includes("限流"),
    zh: "请求过于频繁或配额不足，请稍后重试。",
    en: "Rate limited or quota exceeded. Try again later.",
  },
  {
    test: (t) => /ENOTFOUND|EAI_AGAIN|getaddrinfo|DNS/i.test(t),
    zh: "无法解析服务器地址，请检查网络或代理。",
    en: "Cannot resolve server address. Check network or proxy.",
  },
  {
    test: (t) =>
      /ECONNREFUSED|ECONNRESET|EPIPE|socket hang up|network|fetch failed|Failed to fetch|ERR_NETWORK|ENETUNREACH|EHOSTUNREACH|disconnected/i.test(
        t,
      ) ||
      t.includes("断网") ||
      t.includes("网络"),
    zh: "网络连接失败，请检查网络后重试。",
    en: "Network connection failed. Check your network and retry.",
  },
  {
    test: (t) => /ETIMEDOUT|timeout|timed out/i.test(t) || t.includes("超时"),
    zh: "请求超时，请稍后重试。",
    en: "Request timed out. Please retry.",
  },
  {
    test: (t) => /context.?length|context.?overflow|too many tokens|maximum context/i.test(t) || t.includes("上下文"),
    zh: "上下文过长，请压缩上下文或新开会话。",
    en: "Context too long. Compact context or start a new session.",
  },
  {
    test: (t) => /model.?not.?found|unknown model/i.test(t) || t.includes("不支持的模型"),
    zh: "模型不可用，请更换模型。",
    en: "Model unavailable. Choose another model.",
  },
  {
    test: (t) => /aborted|AbortError/i.test(t) || t.includes("已取消"),
    zh: "已取消请求。",
    en: "Request cancelled.",
  },
  {
    test: (t) => /500|502|503|504|bad gateway|service unavailable|internal server/i.test(t),
    zh: "模型服务暂时不可用，请稍后重试。",
    en: "Model service temporarily unavailable. Retry later.",
  },
];

export function formatLlmError(raw: string, locale: "zh-CN" | "en" = "zh-CN"): string {
  const text = raw.trim();
  if (!text) {
    return locale === "zh-CN" ? "请求失败" : "Request failed";
  }
  for (const rule of RULES) {
    if (rule.test(text)) {
      return locale === "zh-CN" ? rule.zh : rule.en;
    }
  }
  // Keep original detail but prefix a generic line for long English dumps
  if (locale === "zh-CN" && /^[A-Za-z0-9_:[\]"'.,\s/-]{20,}$/.test(text) && text.length > 80) {
    return `调用失败：${text.slice(0, 160)}${text.length > 160 ? "…" : ""}`;
  }
  return text;
}
