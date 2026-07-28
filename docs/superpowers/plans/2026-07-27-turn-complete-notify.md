# Turn-complete notify — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Play bundled chime and/or OS notification when a turn completes.

**Architecture:** Renderer prefs + Audio for sound; Main Electron Notification when window unfocused; wire on `prompt_done`.

**Tech Stack:** Electron Notification, HTMLAudioElement, Pinia, localStorage, Vite asset.

## Global Constraints

- Two toggles, both default on
- Foreground: no OS notification
- Bundle `qipao.mp3` only
- Trigger: `prompt_done` only

---

### Task 1: Asset + prefs store

**Files:** `src/renderer/src/assets/sounds/qipao.mp3`, `src/renderer/src/stores/notify.ts`, ambient `*.mp3` types if needed

- [x] Copy sound into assets
- [x] Pinia store: `soundEnabled`, `notifyEnabled`, persist, `playChime()`

### Task 2: Main notify IPC

**Files:** `src/main/notify-host.ts`, `protocol.ts`, `preload`, `index.ts`

- [x] `notify.turnComplete({ title, body })` → notify only if main window not focused

### Task 3: Settings UI + wire prompt_done

**Files:** `NotifySettings.vue`, `TitleBar.vue`, i18n, `stores/chat.ts` or sessions event path

- [x] Settings menu entry
- [x] On `prompt_done`: play + IPC per prefs
- [x] typecheck  
