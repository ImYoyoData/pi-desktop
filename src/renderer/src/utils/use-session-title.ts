import { useChatStore } from "@renderer/stores/chat";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useI18n } from "@renderer/i18n/use-i18n";
import { heuristicSessionTitle } from "@renderer/utils/session-title";

/**
 * 当前会话标题：会话行（名称/首条消息）优先，其次已加载的首条用户消息，
 * 最后回落「新会话」。两个 selector 只返回字符串，流式输出不会带着调用方重渲染。
 */
export function useSessionTitle(): string {
  const t = useI18n();
  const hasSession = useSessionsStore(
    (s) => Boolean(s.activeId) || Boolean(s.draftRoot),
  );
  const rowTitle = useSessionsStore((s) => {
    if (!s.activeId) return "";
    const row = s.sessions.find((r) => r.id === s.activeId);
    const name = row?.name?.trim();
    if (name) return name;
    const first = row?.firstMessage?.trim();
    if (!first || first === "(no messages)") return "";
    return first.length > 56 ? `${first.slice(0, 53)}…` : first;
  });
  const messageTitle = useChatStore((s) => {
    const firstUser = s.activeMessages.find(
      (m) => m.role === "user" && m.text.trim(),
    );
    return firstUser?.role === "user"
      ? heuristicSessionTitle(firstUser.text, 56)
      : "";
  });
  return rowTitle || messageTitle || (hasSession ? t.newSession : "");
}
