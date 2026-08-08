# lan-web desktop parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phone lan-web reuses desktop MessageList + real-time WS chat, synced model/thinking, faster sidebar, ASR cancel >4s.

**Architecture:** Vite aliases `@renderer` → desktop sources; shim `window.api`; Pinia stores; `reduceChatEvent` for stream; lan-console `getSessionState`.

## Task 1: Backend getSessionState
- [ ] Add WS handler in `lan-console.ts`
- [ ] Prefer `trySend(get_state)`, fallback `send` when opening session

## Task 2: Build/shim
- [ ] Update `lan-web/vite.config.ts` aliases + deps
- [ ] Add `lan-web/src/shim-api.ts`, wire in `main.ts` with Pinia

## Task 3: MessageList + stream
- [ ] Export `applyLanEvent` from chat store
- [ ] Host MessageList in App; hydrate history; apply WS events; stop live history polling

## Task 4: UX
- [ ] Prefetch/cache sessions; instant drawer
- [ ] Sync model/thinking from getSessionState
- [ ] ASR cancel after 4s converting
