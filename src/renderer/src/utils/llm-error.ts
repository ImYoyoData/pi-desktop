/** Map raw LLM / network errors to short UI copy in the active locale. */

import type { UiLocale } from "@renderer/i18n";

type Rule = {
  test: (text: string) => boolean;
  "zh-CN": string;
  "zh-TW": string;
  ja: string;
  en: string;
};

const RULES: Rule[] = [
  {
    test: (t) => /api[_ ]?key|invalid.?key|unauthorized|401|authentication/i.test(t) || t.includes("鉴权") || t.includes("密钥"),
    "zh-CN": "API Key 无效或未配置，请到模型设置中检查。",
    "zh-TW": "API Key 無效或未設定，請到模型設定中檢查。",
    ja: "API キーが無効か未設定です。モデル設定を確認してください。",
    en: "Invalid or missing API key. Check Model Settings.",
  },
  {
    test: (t) => /403|forbidden|permission denied/i.test(t),
    "zh-CN": "没有访问该模型的权限。",
    "zh-TW": "沒有存取該模型的權限。",
    ja: "このモデルへのアクセス権がありません。",
    en: "Permission denied for this model.",
  },
  {
    test: (t) => /429|rate.?limit|too many requests|overloaded/i.test(t) || t.includes("配额") || t.includes("限流"),
    "zh-CN": "请求过于频繁或配额不足，请稍后重试。",
    "zh-TW": "請求過於頻繁或額度不足，請稍後重試。",
    ja: "リクエストが多すぎるか割り当てを超えています。しばらくして再試行してください。",
    en: "Rate limited or quota exceeded. Try again later.",
  },
  {
    test: (t) => /ENOTFOUND|EAI_AGAIN|getaddrinfo|DNS/i.test(t),
    "zh-CN": "无法解析服务器地址，请检查网络或代理。",
    "zh-TW": "無法解析伺服器位址，請檢查網路或代理。",
    ja: "サーバーアドレスを解決できません。ネットワークまたはプロキシーを確認してください。",
    en: "Cannot resolve server address. Check network or proxy.",
  },
  {
    test: (t) =>
      /ECONNREFUSED|ECONNRESET|EPIPE|socket hang up|network|fetch failed|Failed to fetch|ERR_NETWORK|ENETUNREACH|EHOSTUNREACH|disconnected/i.test(
        t,
      ) ||
      t.includes("断网") ||
      t.includes("网络"),
    "zh-CN": "网络连接失败，请检查网络后重试。",
    "zh-TW": "網路連線失敗，請檢查網路後重試。",
    ja: "ネットワーク接続に失敗しました。ネットワークを確認して再試行してください。",
    en: "Network connection failed. Check your network and retry.",
  },
  {
    test: (t) => /ETIMEDOUT|ESOCKETTIMEDOUT|timeout|timed out|deadline exceeded/i.test(t) || t.includes("超时"),
    "zh-CN": "模型响应超时，请稍后重试。",
    "zh-TW": "模型回應逾時，請稍後重試。",
    ja: "モデルの応答がタイムアウトしました。しばらくして再試行してください。",
    en: "Model response timed out. Please retry.",
  },
  {
    test: (t) =>
      /no response from model|empty response from (?:the )?model|model\b[^.]{0,40}\b(?:hung|stalled|silent)\b/i.test(
        t,
      ),
    "zh-CN": "模型未返回有效内容，请稍后重试或更换模型。",
    "zh-TW": "模型未回傳有效內容，請稍後重試或更換模型。",
    ja: "モデルから有効な応答がありません。再試行するかモデルを切り替えてください。",
    en: "Model returned no usable response. Retry or switch models.",
  },
  {
    test: (t) => /context.?length|context.?overflow|too many tokens|maximum context/i.test(t) || t.includes("上下文"),
    "zh-CN": "上下文过长，请压缩上下文或新开会话。",
    "zh-TW": "上下文過長，請壓縮上下文或新增工作階段。",
    ja: "コンテキストが長すぎます。圧縮するか新しいセッションを開始してください。",
    en: "Context too long. Compact context or start a new session.",
  },
  {
    test: (t) => /model.?not.?found|unknown model|model.*(unavailable|not available)/i.test(t) || t.includes("不支持的模型"),
    "zh-CN": "模型不可用，请更换模型。",
    "zh-TW": "模型無法使用，請更換模型。",
    ja: "モデルを利用できません。別のモデルを選んでください。",
    en: "Model unavailable. Choose another model.",
  },
  {
    test: (t) =>
      /PI_MODEL_NO_VISION|image_url|unknown variant.*image|does not accept images|does not support image/i.test(
        t,
      ) || t.includes("不支持图片"),
    "zh-CN": "当前模型不支持图片。请切换到支持视觉的模型，或去掉图片后再发送。",
    "zh-TW": "目前模型不支援圖片。請切換到支援視覺的模型，或移除圖片後再傳送。",
    ja: "現在のモデルは画像に対応していません。視覚対応モデルに切り替えるか、画像を外して送信してください。",
    en: "Current model does not accept images. Switch to a vision-capable model, or remove images and send again.",
  },
  {
    test: (t) => /overloaded|capacity|upstream.*(error|fail)|provider.*(error|fail)/i.test(t),
    "zh-CN": "模型服务繁忙或上游异常，请稍后重试。",
    "zh-TW": "模型服務繁忙或上游異常，請稍後重試。",
    ja: "モデルサービスが混雑しているか上流でエラーが発生しています。しばらくして再試行してください。",
    en: "Model provider busy or upstream error. Retry later.",
  },
  {
    test: (t) => /aborted|AbortError/i.test(t) || t.includes("已取消") || t.includes("已停止"),
    "zh-CN": "已停止生成",
    "zh-TW": "已停止產生",
    ja: "生成を停止しました",
    en: "Generation stopped",
  },
  {
    test: (t) => /worker unresponsive|worker.?stuck|Worker 无响应/i.test(t),
    "zh-CN": "该会话的 Worker 无响应。可终止或仅重启此会话。",
    "zh-TW": "此工作階段的 Worker 無回應。可終止或僅重新啟動此工作階段。",
    ja: "このセッションの Worker が応答していません。終了するか、このセッションだけを再起動できます。",
    en: "This session’s Worker is unresponsive. Terminate or restart this session only.",
  },
  {
    test: (t) =>
      /\b5(?:0[0-9]|2[0-7])\b|bad gateway|service unavailable|internal server/i.test(t),
    "zh-CN": "模型服务暂时不可用，请稍后重试。",
    "zh-TW": "模型服務暫時無法使用，請稍後重試。",
    ja: "モデルサービスを一時的に利用できません。しばらくして再試行してください。",
    en: "Model service temporarily unavailable. Retry later.",
  },
];

const REQUEST_FAILED: Record<UiLocale, string> = {
  "zh-CN": "请求失败",
  "zh-TW": "要求失敗",
  ja: "リクエストに失敗しました",
  en: "Request failed",
};

const LONG_DUMP_PREFIX: Record<"zh-CN" | "zh-TW", string> = {
  "zh-CN": "调用失败：",
  "zh-TW": "呼叫失敗：",
};

export function formatLlmError(raw: string, locale: UiLocale = "zh-CN"): string {
  let text = raw.trim();
  // Electron IPC wraps worker errors: Error invoking remote method 'x': Error: <actual>
  text = text.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "").trim();
  if (!text) {
    return REQUEST_FAILED[locale];
  }
  for (const rule of RULES) {
    if (rule.test(text)) {
      return rule[locale];
    }
  }
  // Keep original detail but prefix a generic line for long English dumps
  if (
    (locale === "zh-CN" || locale === "zh-TW") &&
    /^[A-Za-z0-9_:[\]"'.,\s/-]{20,}$/.test(text) &&
    text.length > 80
  ) {
    return `${LONG_DUMP_PREFIX[locale]}${text.slice(0, 160)}${text.length > 160 ? "…" : ""}`;
  }
  return text;
}
