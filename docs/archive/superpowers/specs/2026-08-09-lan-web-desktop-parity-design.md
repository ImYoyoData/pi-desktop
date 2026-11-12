# lan-web desktop parity design

## Goal
Phone LAN console matches desktop chat: MessageList (thinking/tool/MD), WS streaming, model/thinking sync, fast sidebar, ASR cancel after 4s.

## Approach
Reuse desktop renderer components (`MessageList`, cards, `MarkdownView`) via Vite aliases + Pinia + `window.api` stub. Stream via `reduceChatEvent` on WS `AgentEvent` (no history polling for live turns). `getSessionState` over WS syncs model/thinking with the live worker.

## Out of scope
Full ask_user/permission UI, rich composer attachments, TTS install.
