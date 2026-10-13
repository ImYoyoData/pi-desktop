/**
 * Message-list 行整形 —— 纯函数，使折叠 / 分组规则不必挂载 Vue 即可单测。
 *
 * 这些函数在流式期间每个 tick 都会重算，全部保持 O(n) 单遍或双遍扫描。
 */

import type { ChatMessage } from "../stores/chat-reducer";
import {
  buildWorkSectionSpans,
  finalAnswerRowIds,
  type WorkSectionRow,
} from "./tool-group";
import { ASK_USER_TOOL_NAME } from "../../../shared/ask-user";

export type UserMessage = Extract<ChatMessage, { role: "user" }>;

export type WorkSectionMembership = {
  groupId: string;
  leadId: string;
  isLead: boolean;
  items: ChatMessage[];
};

function toRow(msg: ChatMessage): WorkSectionRow {
  return {
    id: msg.id,
    role: msg.role,
    toolName: msg.role === "tool" ? msg.toolName : "",
    hasText: msg.role === "assistant" ? Boolean(msg.text) : false,
    hasThinking: msg.role === "assistant" ? Boolean(msg.thinking) : false,
  };
}

/** 工具调用行 / 无正文的思考行：属于过程，历史轮里会被裁掉。 */
function isProcessRow(msg: ChatMessage): boolean {
  return (
    msg.role === "tool" ||
    (msg.role === "assistant" && Boolean(msg.thinking) && !msg.text)
  );
}

/** 过程行本身也算“可见输出”——它会占据自己的折叠块并终止前一块的折叠。 */
function isVisibleRow(msg: ChatMessage): boolean {
  return (msg.role === "assistant" && Boolean(msg.text)) || isProcessRow(msg);
}

/** 交互式工具必须留在可见行里（它等用户作答），不能随历史过程行一起裁掉。 */
function isKeepVisibleTool(msg: ChatMessage): boolean {
  return msg.role === "tool" && msg.toolName === ASK_USER_TOOL_NAME;
}

/** 最新一轮（最后一个 user 消息）的起始下标；没有 user 消息返回 -1。 */
export function latestTurnStartIndex(messages: readonly ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

/**
 * 历史裁剪：最新一轮之前的工具 / 纯思考行不再渲染，历史只留用户提问与最终回答，
 * 读起来像一串问答（Codex 风格）。
 */
export function displayMessageRows(
  all: readonly ChatMessage[],
  turnStart: number,
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < all.length; i++) {
    const msg = all[i]!;
    if (i <= turnStart && !isKeepVisibleTool(msg) && isProcessRow(msg)) continue;
    out.push(msg);
  }
  return out;
}

/**
 * Copilot work section：连续的过���行（两个回答正文之间的工具与思考）折成一个
 * 可折叠分组，ask_user 这类交互工具打断分组并保持独立。
 */
export function buildWorkSectionMembership(
  displayed: readonly ChatMessage[],
): Map<string, WorkSectionMembership> {
  const map = new Map<string, WorkSectionMembership>();
  const spans = buildWorkSectionSpans(
    displayed.map(toRow),
    (row) => row.toolName === ASK_USER_TOOL_NAME,
  );
  for (const span of spans) {
    const items = displayed.slice(span.start, span.end);
    for (let i = 0; i < span.ids.length; i++) {
      map.set(span.ids[i]!, {
        groupId: span.groupId,
        leadId: span.ids[0]!,
        isLead: i === 0,
        items,
      });
    }
  }
  return map;
}

/**
 * 折叠判定（Copilot `isHidden`）：过程行只有在它之后真的渲染出了可见内容时才折起。
 * 严格按出现顺序——先折的块不会被后折的块压住；分组按整体判定，
 * 组内任意一行之后出现可见输出，整组一起折。
 */
export function buildSettledRowIds(
  displayed: readonly ChatMessage[],
  membership: Map<string, WorkSectionMembership>,
): Set<string> {
  const settled = new Set<string>();
  const n = displayed.length;
  // hasVisibleAfter[i] = (i, n) 区间内是否存在可见行。
  const hasVisibleAfter = new Array<boolean>(n + 1).fill(false);
  for (let i = n - 1; i >= 0; i--) {
    hasVisibleAfter[i] = hasVisibleAfter[i + 1] || isVisibleRow(displayed[i]!);
  }
  const indexById = new Map<string, number>();
  for (let i = 0; i < n; i++) indexById.set(displayed[i]!.id, i);
  const groupEndById = new Map<string, number>();
  for (const [id, m] of membership) {
    if (!m.isLead) continue;
    const leadIdx = indexById.get(id);
    if (leadIdx != null) groupEndById.set(m.groupId, leadIdx + m.items.length);
  }
  for (let i = 0; i < n; i++) {
    const msg = displayed[i]!;
    if (!isProcessRow(msg)) continue;
    const m = membership.get(msg.id);
    let boundary = i + 1;
    if (m) {
      const end = groupEndById.get(m.groupId);
      if (end != null) boundary = Math.max(boundary, end);
    }
    if (boundary < n && hasVisibleAfter[boundary]) settled.add(msg.id);
  }
  return settled;
}

/** 每轮最后一个命中行的 id（轮以 user 消息分隔）；该轮没有命中行则为 null。 */
export function lastIdPerRound(
  msgs: readonly ChatMessage[],
  match: (msg: ChatMessage) => boolean,
): (string | null)[] {
  const ids: (string | null)[] = [];
  let last: string | null = null;
  for (const msg of msgs) {
    if (msg.role === "user") {
      ids.push(last);
      last = null;
      continue;
    }
    if (match(msg)) last = msg.id;
  }
  ids.push(last);
  return ids;
}

/** 每轮的最终回答行（该轮最后一条带正文的 assistant）。 */
export function buildFinalAnswerIds(displayed: readonly ChatMessage[]): Set<string> {
  return finalAnswerRowIds(displayed.map(toRow));
}

/** 非 user 行 → 它所属轮的 user 消息；操作栏的还原检查点 / 派生对话需要它。 */
export function buildRoundUserByRow(
  messages: readonly ChatMessage[],
): Map<string, UserMessage> {
  const map = new Map<string, UserMessage>();
  let current: UserMessage | null = null;
  for (const msg of messages) {
    if (msg.role === "user") current = msg;
    else if (current) map.set(msg.id, current);
  }
  return map;
}