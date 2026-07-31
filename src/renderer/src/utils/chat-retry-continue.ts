/**
 * Retry-after-error should continue the turn, not wipe the transcript.
 */

import type { ChatMessage } from "../stores/chat-reducer";

/** Drop the error bubble (and anything after it); keep prior user/assistant/tool rows. */
export function dropErrorKeepHistory(
  messages: ChatMessage[],
  errorMessageId: string,
): ChatMessage[] | null {
  const errIdx = messages.findIndex((m) => m.id === errorMessageId && m.role === "error");
  if (errIdx < 0) return null;
  return messages.slice(0, errIdx);
}

/** True when the failed turn already produced assistant/tool content after the last user. */
export function turnHasProgressBeforeError(
  messages: ChatMessage[],
  errorMessageId: string,
): boolean {
  const errIdx = messages.findIndex((m) => m.id === errorMessageId && m.role === "error");
  if (errIdx < 0) return false;
  let userIdx = -1;
  for (let i = errIdx - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      userIdx = i;
      break;
    }
  }
  if (userIdx < 0) return false;
  for (let i = userIdx + 1; i < errIdx; i++) {
    const role = messages[i]!.role;
    if (role === "assistant" || role === "tool") return true;
  }
  return false;
}

export function findUserBeforeError(
  messages: ChatMessage[],
  errorMessageId: string,
): Extract<ChatMessage, { role: "user" }> | null {
  const errIdx = messages.findIndex((m) => m.id === errorMessageId && m.role === "error");
  if (errIdx < 0) return null;
  for (let i = errIdx - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === "user") return msg;
  }
  return null;
}
