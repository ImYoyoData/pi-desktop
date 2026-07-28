# Pi Desktop UX / ASR / Pi 环境共用 — Design

**Date:** 2026-07-28  
**Status:** Draft for review  
**Approach:** 方案 1（分四块小改，行为对齐产品描述）

## Goal

Fix four independent but concurrent product gaps:

1. Composer tags must live **inside** a rich-text editing surface (not a separate strip above the textarea).
2. Left/right pane collapse must **hide layout only** — no unmount/reload.
3. In-app Pi SDK must share the user’s **global Pi CLI environment** (config, extensions, skills, auth, models).
4. ASR: optional **resident model + always-on mic**, multi wake-word → cue sound → dictation UI; hotkey remains.

## Non-goals

- TipTap/ProseMirror migration for composer (deferred).
- Separate ASR daemon process (deferred).
- Custom wake-cue audio picker (reuse `qipao.mp3` only).
- Fuzzy/phonetic wake matching beyond case-insensitive substring.
- Changing agent prompt wire protocol beyond existing `@path` / URL / citation serialization.

---

## 1. Composer inline tags (rich text surface)

### Problem

File/URL/element tags are rendered as siblings beside `NInput` in a flex/flow container. Visually and structurally they sit **outside** the editable field. Users expect chips **inside** the editor, like a rich-text document.

### Behavior

- Path copy, URL paste, and “add from list” insert **inline chips inside the editable surface**.
- Chips and plain text share one caret/selection model (chip is an atomic inline unit: backspace removes whole chip).
- **Images stay outside** the rich-text surface as attachments (binary); only file/url/element tags are in-document.
- Send / queue / edit-message paths keep today’s semantics: chips serialize to attachment tags + agent text (`@path`, URLs, citations) without breaking chat bubbles.

### Implementation sketch

- Replace textarea-only draft with a `contenteditable` (or equivalent lightweight surface) that hosts:
  - inline chip nodes (non-editable spans with data attributes), and
  - text nodes for the draft.
- Mirror state into the existing composer store (`draft` + `chips`) so queue/send/edit keep working.
- Preserve paste handlers that turn paths/URLs into chips at the caret.

### Success

- Adding a file path shows a chip **inside** the editor box, not above a blank textarea.
- Typing continues after/around chips; delete chip with one backspace on it.

---

## 2. Left/right pane collapse without unmount

### Problem

`SplitRoot` uses `v-if` on side panes and a `:key` derived from collapse flags, which destroys `SessionSidebar` / `RightPane` (and terminals/previews) on every hide.

### Behavior

- Collapse = layout hide only (size ≈ 0 or CSS hide + no pointer events).
- Components stay mounted; terminals, preview media, browser view, file tree state survive.
- Expand rail buttons remain when a side is collapsed.
- Split size persistence unchanged when panes are visible.

### Implementation sketch

- Remove collapse-driven `:key` remounts.
- Keep both side panes in the tree; adjust pane sizes / CSS instead of `v-if`.
- Ensure browser/terminal “visible” props still pause expensive work when collapsed (already partly present) without tearing down the tab host.

### Success

- Hide left then show: session list scroll/selection preserved.
- Hide right then show: terminal scrollback and preview tab still alive without recreate.

---

## 3. Share global Pi CLI environment

### Problem

Product intent is one shared user environment with Pi CLI. Code already calls `getAgentDir()` → `~/.pi/agent` (or `PI_CODING_AGENT_DIR`), but Electron utilityProcess / PATH / package resolution can diverge so extensions/skills configured for CLI do not reliably load in Desktop.

### Behavior

- Single config root: `getAgentDir()` only — never a Desktop-private agent dir.
- Same `settings.json` packages, `skills/`, `auth.json`, `models.json`, managed `npm/` + `git/` installs as CLI.
- Skills & Extensions settings UI lists that same environment; missing packages show diagnosable path/error.
- Agent sessions load the same resource set CLI would for that cwd + agentDir.

### Implementation sketch

- Audit agent-worker spawn env (HOME/USERPROFILE, PATH so `npm`/`pnpm`/`bun` resolution matches interactive shell where feasible).
- Ensure `createAgentSessionServices({ cwd, agentDir: getAgentDir() })` and settings/plugins hosts never override agentDir.
- Surface loader diagnostics (extension load failures) instead of silent empty lists.
- Verify against real `~/.pi/agent/settings.json` packages under `npm/node_modules`.

### Success

- Packages listed in CLI/`settings.json` appear and resolve in Desktop Extensions.
- Skills from global/project/package sources available to the running agent the same as CLI for that workspace.

---

## 4. Resident ASR model + multi wake-word

### Confirmed product choices

| Item | Choice |
|------|--------|
| Mode | Always-on mic when resident enabled |
| Start | App launch after “常驻模型加载” is on; toggle off anytime in Speech settings |
| Wake words | Multiple; comma or newline separated; case-insensitive **substring** match on any |
| Cue | Play existing `qipao.mp3` (not configurable) |
| After wake | Existing dictation UI (Enter confirm / Esc cancel) |
| Hotkey | Remains available alongside voice wake |

### Behavior

- New pref: **常驻模型加载** (`residentModel` / similar) in ASR settings + `asr-prefs.json`.
- When enabled and ASR otherwise ready (enabled + installed):
  - Warm/load CrispASR at startup (or on pref enable).
  - Keep a background listen/transcribe loop for wake detection only.
- On wake-word hit: play `qipao.mp3` → open dictation UI (same as mic/hotkey path). Background wake loop pauses while dictating; resumes after cancel/confirm.
- When disabled: stop background mic and allow releasing the resident runtime to save resources.
- Mic button / hotkey: if resident already warm, skip cold-start stall; if not resident, keep current `ensureAsrReady` path.

### Privacy / safety

- Pref default **off**.
- Settings copy must state that always-on listening sends audio to the local ASR runtime while enabled.
- No cloud wake service in this design.

### Success

- With resident on: first mic click / hotkey shows UI without long hitch.
- Saying a configured wake word plays cue and opens dictation.
- Hotkey still works with resident on.
- Turning pref off stops background listening.

---

## Delivery order

1. Pane keep-alive (smallest, high UX win).
2. Pi global env audit/fix.
3. Composer inline chips.
4. Resident ASR + wake words (largest).

## Open questions

None blocking after product confirmation (方案 1 + images outside editor + ASR choices A/B/A/A).

## Out of scope follow-ups

- Custom wake sound files.
- Phonetic / edit-distance wake matching.
- TipTap composer.
- Notarized mac wake entitlements beyond existing mic entitlement.
