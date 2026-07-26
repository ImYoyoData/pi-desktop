/** Map raw LLM / network errors to short Chinese (or English) UI copy. */

const RULES: { re: RegExp; zh: string; en: string }[] = [
  { re: /api[_ ]?key|invalid.?key|unauthorized|401|authentication|鉴权|密钥/i, zh: "API Key 无效或未配置，请到模型设置中检查。", en: "Invalid or missing API key. Check Model Settings." },
  { re: /403|forbidden|permission denied/i, zh: "没有访问该模型的权限。", en: "Permission denied for this model." },
  { re: /429|rate.?limit|too many requests|overloaded|配额|限流/i, zh: "请求过于频繁或配额不足，请稍后重试。", en: "Rate limited or quota exceeded. Try again later." },
  { re: /ENOTFOUND|EAI_AGAIN|getaddrinfo|DNS/i, zh: "无法解析服务器地址，请检查网络或代理。", en: "Cannot resolve server address. Check network or proxy." },
  { re: /ECONNREFUSED|ECONNRESET|EPIPE|socket hang up|network|fetch failed|Failed to fetch|ERR_NETWORK|ENETUNREACH|EHOSTUNREACH|disconnected|断网|网络/i, zh: "网络连接失败，请检查网络后重试。", en: "Network connection failed. Check your network and retry." },
  { re: /ETIMEDOUT|timeout|timed out|超时/i, zh: "请求超时，请稍后重试。", en: "Request timed out. Please retry." },
  { re: /context.?length|context.?overflow|too many tokens|maximum context|上下文/i, zh: "上下文过长，请压缩上下文或新开会话。", en: "Context too long. Compact context or start a new session." },
  { re: /model.?not.?found|unknown model|不支持的模型/i, zh: "模型不可用，请更换模型。", en: "Model unavailable. Choose another model." },
  { re: /aborted|AbortError|已取消/i, zh: "已取消请求。", en: "Request cancelled." },
  { re: /500|502|503|504|bad gateway|service unavailable|internal server/i, zh: "模型服务暂时不可用，请稍后重试。", en: "Model service temporarily unavailable. Retry later." },
];

export function formatLlmError(raw: string, locale: "zh-CN" | "en" = "zh-CN"): string {
  const text = raw.trim();
  if (!text) {
    return locale === "zh-CN" ? "请求失败" : "Request failed";
  }
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      return locale === "zh-CN" ? rule.zh : rule.en;
    }
  }
  // Keep original detail but prefix a generic line for long English dumps
  if (locale === "zh-CN" && /^[A-Za-z0-9_:[\]"'.,\s/-]{20,}$/.test(text) && text.length > 80) {
    return `调用失败：${text.slice(0, 160)}${text.length > 160 ? "…" : ""}`;
  }
  return text;
}
