# Desktop UX / ASR / Pi Env Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the four approved behaviors from `docs/superpowers/specs/2026-07-28-desktop-ux-asr-pi-env-design.md`: pane keep-alive, shared `~/.pi/agent` with CLI, inline composer chips, resident ASR + multi wake-word.

**Architecture:** Keep existing Electron main / utilityProcess agent-worker / Vue renderer split. Prefer hide-over-destroy for layout; reuse `getAgentDir()` for Pi config; replace composer textarea with a small contenteditable surface synced to the composer store; extend existing CrispASR stream path for wake listening.

**Tech Stack:** Electron 39, Vue 3, Pinia, splitpanes, `@earendil-works/pi-coding-agent`, CrispASR stream IPC, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-28-desktop-ux-asr-pi-env-design.md`
- Images stay **outside** the rich-text surface; only file/url/element tags are inline.
- Wake cue audio is fixed to existing `qipao.mp3` (no picker).
- Wake matching: case-insensitive substring; multiple words via comma/newline.
- Resident listen default **off**; hotkey remains alongside voice wake.
- Agent config root is only `getAgentDir()` (`~/.pi/agent` or `PI_CODING_AGENT_DIR`).
- Do not commit unless the user explicitly asks (user rule overrides “frequent commits” in this plan — mark commit steps as optional).
- Reply / UI copy in zh-CN where user-facing.

## File map

| Area | Primary files |
|------|----------------|
| Panes | `src/renderer/src/components/SplitRoot.vue` |
| Pi env | `src/main/agent-worker-host.ts`, `src/main/pi-env.ts`, `src/main/skills-host.ts`, `src/main/plugins-host.ts`, `src/agent-worker/runtime.ts`, optional `src/main/pi-path-env.ts` |
| Composer | `src/renderer/src/components/Composer.vue`, new `src/renderer/src/components/ComposerRichEditor.vue`, `src/renderer/src/stores/composer.ts`, `src/renderer/src/utils/composer-tags.ts`, tests under `tests/renderer/` |
| ASR | `src/shared/asr.ts`, `src/main/asr-host.ts`, `src/preload/index.ts`, `src/shared/protocol.ts`, `src/renderer/src/stores/asr.ts`, `src/renderer/src/components/AsrSettings.vue`, `src/renderer/src/components/Composer.vue`, `src/renderer/src/stores/notify.ts` (reuse sound), i18n `en.ts` / `zh-CN.ts`, tests `tests/shared/` |

---

### Task 1: Left/right pane collapse keep-alive

**Files:**
- Modify: `src/renderer/src/components/SplitRoot.vue`
- Test: manual + optional smoke note in PR; no unit test required if splitpanes needs DOM

**Interfaces:**
- Consumes: `layout.leftCollapsed`, `layout.rightCollapsed`, `layout.leftSize`, `layout.centerSize`, `layout.rightSize`, toggle helpers
- Produces: panes always mounted; collapse only changes size/CSS

- [ ] **Step 1: Remove remount key and `v-if` unmounts**

In `SplitRoot.vue`:
- Delete `splitKey` computed and `:key="splitKey"` on outer `Splitpanes`.
- Keep left `Pane` always; when `leftCollapsed`, set `:size="0"` (or very small) and add class `pane-collapsed` instead of `v-if="!layout.leftCollapsed"`.
- Keep right `Pane` always; when `rightCollapsed`, size `0` + `pane-collapsed` instead of `v-if`.
- When left collapsed, main pane size `100`; when right collapsed, chat pane size `100` of inner split (same as today).

Example structure:

```vue
<Splitpanes class="panes" @resized="onOuterResized">
  <Pane
    :size="layout.leftCollapsed ? 0 : outerLeftSize"
    :min-size="layout.leftCollapsed ? 0 : PANE_MIN"
    :max-size="layout.leftCollapsed ? 0 : PANE_MAX"
    :class="{ 'pane-collapsed': layout.leftCollapsed }"
  >
    <SessionSidebar />
  </Pane>
  <Pane :size="layout.leftCollapsed ? 100 : outerMainSize" :min-size="layout.leftCollapsed ? 100 : 100 - PANE_MAX">
    <Splitpanes class="panes inner" @resized="onInnerResized">
      <Pane
        :size="layout.rightCollapsed ? 100 : innerPair.chat"
        :min-size="CHAT_MIN"
        :max-size="layout.rightCollapsed ? 100 : PANE_MAX"
      >
        <ChatPanel />
      </Pane>
      <Pane
        :size="layout.rightCollapsed ? 0 : innerPair.right"
        :min-size="layout.rightCollapsed ? 0 : PANE_MIN"
        :max-size="layout.rightCollapsed ? 0 : PANE_MAX"
        :class="{ 'pane-collapsed': layout.rightCollapsed }"
      >
        <RightPane />
      </Pane>
    </Splitpanes>
  </Pane>
</Splitpanes>
```

- [ ] **Step 2: CSS hide collapsed panes (no pointer events)**

```css
:deep(.pane-collapsed) {
  overflow: hidden !important;
  pointer-events: none;
  visibility: hidden;
}
```

Keep expand rails when collapsed (existing tooltips).

- [ ] **Step 3: Guard resize handlers**

`onOuterResized` / `onInnerResized` already return early when collapsed — keep that. Do not persist size `0` as the user’s remembered left/right width (only update sizes when the corresponding side is expanded).

- [ ] **Step 4: Verify manually**

Run: `npm run dev`  
Expected: collapse left → session list gone visually; expand → same selection/scroll. Collapse right → terminal tab still has same pty after re-expand (no recreate flash).

- [ ] **Step 5: Commit (optional — only if user asked)**

```bash
git add src/renderer/src/components/SplitRoot.vue
git commit -m "fix: keep side panes mounted when collapsed"
```

---

### Task 2: Share global Pi CLI agent environment

**Files:**
- Create: `src/main/pi-path-env.ts`
- Modify: `src/main/agent-worker-host.ts`
- Modify: `src/main/index.ts` (call path enrichment once at startup if needed)
- Modify: `src/main/plugins-host.ts` (surface diagnostics if easy)
- Modify: `src/main/skills-host.ts` (already uses `getAgentDir()` — verify only)
- Test: `tests/main/pi-path-env.test.ts` (pure path helpers)

**Interfaces:**
- Consumes: `getAgentDir()` from `@earendil-works/pi-coding-agent`, `process.env`
- Produces: `augmentPathForPiCli(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv` — PATH includes common npm/bun/pnpm global bin dirs on win/mac/linux without removing existing PATH

- [ ] **Step 1: Write failing test for PATH augmentation**

Create `tests/main/pi-path-env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { augmentPathForPiCli } from "../../src/main/pi-path-env";

describe("augmentPathForPiCli", () => {
  it("preserves existing PATH entries", () => {
    const env = augmentPathForPiCli({ PATH: "C:\\\\existing" });
    expect(env.PATH?.split(/;|:/).some((p) => p.includes("existing"))).toBe(true);
  });

  it("does not clear HOME/USERPROFILE", () => {
    const env = augmentPathForPiCli({
      PATH: "/usr/bin",
      HOME: "/Users/test",
      USERPROFILE: "C:\\\\Users\\\\test",
    });
    expect(env.HOME).toBe("/Users/test");
    expect(env.USERPROFILE).toBe("C:\\\\Users\\\\test");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

Run: `npx vitest run tests/main/pi-path-env.test.ts`  
Expected: FAIL cannot find module

- [ ] **Step 3: Implement `pi-path-env.ts`**

```ts
import { homedir } from "node:os";
import path from "node:path";

/** Ensure Electron workers can resolve npm/pnpm/bun like an interactive shell. */
export function augmentPathForPiCli(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const home = env.HOME || env.USERPROFILE || homedir();
  const sep = process.platform === "win32" ? ";" : ":";
  const key = process.platform === "win32" ? "Path" : "PATH";
  // Prefer PATH; on Windows Electron may expose Path
  const current =
    env.PATH || env.Path || process.env.PATH || process.env.Path || "";
  const extras: string[] = [];
  if (process.platform === "win32") {
    const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    extras.push(
      path.join(appData, "npm"),
      path.join(local, "bun", "bin"),
      path.join(home, "AppData", "Roaming", "npm"),
    );
  } else {
    extras.push(
      path.join(home, ".bun", "bin"),
      path.join(home, ".local", "share", "pnpm"),
      "/usr/local/bin",
      "/opt/homebrew/bin",
    );
  }
  const parts = current.split(sep).filter(Boolean);
  for (const e of extras) {
    if (e && !parts.includes(e)) parts.push(e);
  }
  const next = { ...env, PATH: parts.join(sep) };
  if (process.platform === "win32") next.Path = next.PATH;
  return next;
}
```

- [ ] **Step 4: Pass augmented env into utilityProcess.fork**

In `agent-worker-host.ts`:

```ts
import { augmentPathForPiCli } from "./pi-path-env";

const child = utilityProcess.fork(workerScriptPath(), [], {
  cwd,
  serviceName: `pi-agent-${path.basename(cwd).slice(0, 8) || "ws"}`,
  stdio: "pipe",
  env: augmentPathForPiCli({ ...process.env }),
});
```

Confirm `runtime.ts` still uses `getAgentDir()` with no override.

- [ ] **Step 5: Plugins list — expose missing path in UI already; ensure list uses getAgentDir()**

In `plugins-host.ts` / `skills-host.ts`, no agentDir hardcode. If `listPlugins` returns `missing`, `installedPath` should still show expected managed path under `join(getAgentDir(), "npm", "node_modules", name)` when possible (only if trivial; do not rewrite package manager).

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/main/pi-path-env.test.ts`  
Expected: PASS

Manual: open Extensions settings with workspace — packages from `~/.pi/agent/settings.json` should show `installed` when present under `~/.pi/agent/npm/node_modules`.

- [ ] **Step 7: Commit (optional)**

```bash
git add src/main/pi-path-env.ts src/main/agent-worker-host.ts tests/main/pi-path-env.test.ts
git commit -m "fix: enrich agent-worker PATH so Pi packages resolve like CLI"
```

---

### Task 3: Inline chips inside composer rich editor

**Files:**
- Create: `src/renderer/src/components/ComposerRichEditor.vue`
- Create: `tests/renderer/composer-rich-serialize.test.ts`
- Create: `src/renderer/src/utils/composer-rich.ts` (serialize/parse helpers — keep Vue component thin)
- Modify: `src/renderer/src/components/Composer.vue` (replace draft `NInput` + outer chip list with `ComposerRichEditor`)
- Modify: `src/renderer/src/stores/composer.ts` only if needed for caret insert APIs

**Interfaces:**
- Consumes: `composer.draft`, `composer.chips`, `addFileTag`, `addUrlTag`, `removeChip`, `setDraft`
- Produces:
  - `serializeRichEditor(root: HTMLElement): { draft: string; chipOrder: string[] }`
  - `chipToken(id: string): string` internal marker if needed — prefer DOM chips with `data-chip-id`, draft text = text nodes only joined with spaces/newlines matching UX

Design rule: chips are atomic inline elements inside one `contenteditable` div; text nodes hold `draft`. On input/blur, sync text → `composer.draft` and chip order from DOM. Store still owns chip objects by id.

- [ ] **Step 1: Failing test for wake-free serialize helper**

`src/renderer/src/utils/composer-rich.ts` + test:

```ts
import { describe, expect, it } from "vitest";
import { matchWakeWords, parseWakeWords } from "../../src/shared/asr-wake"; // Task 4 — DO NOT import yet
```

Wait — keep Task 3 pure. Test:

```ts
import { describe, expect, it } from "vitest";
import { extractDraftFromRichHtml, chipIdsFromRichHtml } from "../../src/renderer/src/utils/composer-rich";

describe("composer-rich", () => {
  it("extracts text without chip labels duplicated", () => {
    const html = `hello<span data-chip-id="c1" data-chip-kind="file">src/a.ts</span>world`;
    expect(extractDraftFromRichHtml(html).replace(/\s+/g, " ").trim()).toBe("hello world");
  });
});
```

Prefer working on a temp `document` in happy-dom/jsdom if available; if renderer tests lack DOM, implement pure string helpers:

```ts
export function extractDraftFromRichHtml(html: string): string {
  return html
    .replace(/<span[^>]*data-chip-id="[^"]*"[^>]*>.*?<\/span>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ");
}
```

- [ ] **Step 2: Run test FAIL then implement helpers PASS**

Run: `npx vitest run tests/renderer/composer-rich-serialize.test.ts`

- [ ] **Step 3: Build `ComposerRichEditor.vue`**

Props: none required if it reads composer store; or `disabled: boolean`.
Emits: optional `keydown` bubbling for Enter-to-send.

Behavior:
- Root: `.rich-surface[contenteditable="true"]`
- Render chips as `<span contenteditable="false" class="chip" data-chip-id data-chip-kind>` with remove button
- On `input`, sync draft text from DOM; do not destroy chips on normal typing
- `addFileTag` / paste path: insert chip span at caret (use `window.getSelection()`)
- Backspace on/just after chip removes that chip via `composer.removeChip`
- Expose `focus()` / `focusEnd()` for Composer mic/send flows (replace `draftInput` refs)

Visual: chips sit **inside** the bordered editor box with text (same background as current `.rich-editor`).

- [ ] **Step 4: Wire Composer.vue**

Remove the v-for `CitationCard` above `NInput` inside `.editor-flow`. Keep image attachments above the rich surface. Replace `NInput` with:

```vue
<ComposerRichEditor
  ref="richEditor"
  :disabled="voiceActive || voicePending"
  @keydown="onKeydown"
/>
```

Update `focusDraft` / `focusDraftAtEnd` to call rich editor methods. Keep `snapshotComposerPayload` using store `draft` + `chips`.

- [ ] **Step 5: Typecheck + targeted tests**

Run: `npm run typecheck`  
Run: `npx vitest run tests/renderer/composer-rich-serialize.test.ts tests/renderer/chat-reducer.test.ts`  
Expected: PASS

Manual: paste path / add file from files tree → chip appears inside editor; type around it; send still works.

- [ ] **Step 6: Commit (optional)**

```bash
git add src/renderer/src/components/ComposerRichEditor.vue src/renderer/src/utils/composer-rich.ts src/renderer/src/components/Composer.vue tests/renderer/composer-rich-serialize.test.ts
git commit -m "feat: inline path/url chips inside composer rich editor"
```

---

### Task 4: Resident ASR model + multi wake-word

**Files:**
- Create: `src/shared/asr-wake.ts`
- Create: `tests/shared/asr-wake.test.ts`
- Modify: `src/shared/asr.ts` (`AsrStatus` + prefs fields)
- Modify: `src/shared/protocol.ts` (IPC: `setResident`, `setWakeWords`, maybe reuse stream events)
- Modify: `src/main/asr-host.ts`
- Modify: `src/preload/index.ts` + `env.d.ts`
- Modify: `src/renderer/src/stores/asr.ts`
- Modify: `src/renderer/src/components/AsrSettings.vue`
- Modify: `src/renderer/src/components/Composer.vue` (wake from voice; play cue; skip cold start when resident)
- Modify: `src/renderer/src/i18n/zh-CN.ts`, `en.ts`
- Modify: `src/renderer/src/stores/notify.ts` or small helper to play `qipao.mp3` on wake

**Interfaces:**
- Prefs (`asr-prefs.json`): `residentModel: boolean` (default false), `wakeWords: string` (raw textarea; default `"小皮\nhey pi"`)
- `parseWakeWords(raw: string): string[]` — split on `,` / newline / `，`；trim；drop empty
- `matchWakeWords(transcript: string, words: string[]): string | null` — case-insensitive includes; return matched word or null
- Main: when `residentModel && enabled && installed`, keep stream (or dedicated wake stream) alive; on final/partial match → send `asr:wake` **or** new `asr:voiceWake` — Composer already listens to `onWake`; prefer emitting same `asr:wake` after playing is renderer-side
- Cue: renderer plays `/assets/sounds/qipao.mp3` (existing) on wake before opening UI
- Pause wake loop while `voiceActive` / dictation; resume after

- [ ] **Step 1: Failing tests for wake word parsing/matching**

```ts
import { describe, expect, it } from "vitest";
import { matchWakeWords, parseWakeWords } from "../../src/shared/asr-wake";

describe("asr-wake", () => {
  it("parses comma and newlines", () => {
    expect(parseWakeWords("小皮, hey pi\n唤醒")).toEqual(["小皮", "hey pi", "唤醒"]);
  });

  it("matches case-insensitive substring", () => {
    expect(matchWakeWords("Okay Hey PI please", ["hey pi"])).toBe("hey pi");
    expect(matchWakeWords("你好小皮在吗", ["小皮"])).toBe("小皮");
    expect(matchWakeWords("hello", ["小皮"])).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `asr-wake.ts` until PASS**

- [ ] **Step 3: Extend prefs + status + IPC**

`Prefs` / `AsrStatus`:
```ts
residentModel: boolean;
wakeWords: string; // raw
```

IPC handlers:
- `asr:setResidentModel(enabled: boolean)`
- `asr:setWakeWords(raw: string)`

On app ready / pref enable: if resident → `ensureRuntimeLoaded()` + start wake listen (reuse `startAsrStream` + mic capture in main **or** renderer background capture pushing PCM — prefer **renderer** MediaRecorder/ScriptProcessor pushing to existing `streamPush`, main only matches text from `streamEvent`, to avoid duplicating mic permission paths).

Recommended wake pipeline (renderer-owned mic):
1. `asr.residentModel` true → Composer/App starts background `startVoiceRecord`-like capture in low-duty mode OR dedicated `startWakeListen()` that only `streamPush`es and watches `streamEvent` finals.
2. On match → play qipao → call existing `onMicClick()` / dictation entry; stop background push until dictation ends.

If background capture is too heavy to share with dictation, stop wake capture before dictation and restart after.

- [ ] **Step 4: AsrSettings UI**

Add:
- Switch: 常驻模型加载 (+ privacy hint: 开启后将持续使用麦克风进行本地唤醒检测)
- Textarea: 唤醒词（每行或逗号分隔）

Wire to store setters.

- [ ] **Step 5: Composer / App lifecycle**

On mount + when prefs change: if resident on and ASR ready, start wake listen; else stop.  
`ensureAsrReady` when resident already warm: skip install hitch.  
Hotkey `onAsrWake` unchanged.

- [ ] **Step 6: Tests + typecheck**

Run: `npx vitest run tests/shared/asr-wake.test.ts`  
Run: `npm run typecheck`  
Run: `npm test`  
Expected: all PASS

Manual: enable resident, set wake word, speak word → cue → dictation UI; hotkey still works; disable resident → mic stops.

- [ ] **Step 7: Commit (optional)**

```bash
git add src/shared/asr-wake.ts tests/shared/asr-wake.test.ts src/shared/asr.ts src/shared/protocol.ts src/main/asr-host.ts src/preload/index.ts src/renderer/src/stores/asr.ts src/renderer/src/components/AsrSettings.vue src/renderer/src/components/Composer.vue src/renderer/src/i18n/zh-CN.ts src/renderer/src/i18n/en.ts
git commit -m "feat: resident ASR model with multi wake-word listening"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Inline chips inside editor | Task 3 |
| Images outside editor | Task 3 (explicit non-move) |
| Pane collapse no unmount | Task 1 |
| Share `~/.pi/agent` / PATH for packages | Task 2 |
| Resident model + always-on mic from launch when on | Task 4 |
| Multi wake words substring | Task 4 |
| qipao cue | Task 4 |
| Hotkey alongside | Task 4 |
| Pref default off + privacy copy | Task 4 |

## Self-review notes

- No TipTap; contenteditable + store sync only.
- Commit steps optional per user git rules.
- Wake listening prefers extending existing stream IPC rather than a second ASR binary.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-28-desktop-ux-asr-pi-env.md`.**

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — implement in this session with checkpoints  

Which approach?
