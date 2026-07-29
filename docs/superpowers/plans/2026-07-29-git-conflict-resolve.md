# Git Conflict Resolve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-hunk Ours/Theirs conflict resolution in the Changes tab, with confirm-to-stage and abort-merge.

**Architecture:** Pure renderer parser (`conflict-markers.ts`) drives a Vue resolve panel; main process exposes `conflictContent` / `resolveConflict` / `checkoutConflictSide` / `abortMerge` via existing dugite `git-host` + IPC. Conflict files (`code === "C"`) swap the right pane from `ChangesDiffEditor` to `ChangesConflictResolve`.

**Tech Stack:** Electron main (dugite), Vue 3 + Naive UI, Vitest, existing `IpcChannels.git` / `window.api.git` patterns.

**Spec:** `docs/superpowers/specs/2026-07-29-git-conflict-resolve-design.md`

## Global Constraints

- Paths must stay inside workspace + repo root (same `isWithin` / `toGitPath` as `getGitFileDiff`).
- Text files only; reject binary / over `TEXT_PREVIEW_MAX_BYTES` (1.5 MiB).
- i18n: every user-visible string in both `zh-CN.ts` and `en.ts`.
- Commit to `dev` only when user asks; do not push `main` / release.
- No Cursor git attribution trailers.
- YAGNI: no base (`:1`) view, no “both sides”, no free-edit merge editor, no rebase `--continue`.

## File map

| File | Responsibility |
|------|----------------|
| `src/renderer/src/utils/conflict-markers.ts` | Parse markers; apply choices; build preview |
| `tests/renderer/conflict-markers.test.ts` | Unit tests for parser |
| `src/shared/git-types.ts` | Shared result types for conflict IPC |
| `src/main/git-host.ts` | `getConflictContent`, `resolveConflictPath`, `checkoutConflictSide`, `abortMerge` |
| `tests/main/git-host-dugite.test.ts` | Merge-conflict smoke tests |
| `src/shared/protocol.ts` | New `IpcChannels.git.*` keys |
| `src/main/git-ipc.ts` | Handlers |
| `src/preload/index.ts` | `window.api.git.*` |
| `src/renderer/src/components/ChangesConflictResolve.vue` | Per-block UI + confirm |
| `src/renderer/src/components/ChangesTab.vue` | Route C files; abort banner |
| `src/renderer/src/i18n/zh-CN.ts` / `en.ts` | Copy |

---

### Task 1: `conflict-markers` parser (TDD)

**Files:**
- Create: `src/renderer/src/utils/conflict-markers.ts`
- Test: `tests/renderer/conflict-markers.test.ts`

**Interfaces:**
- Produces:
  - `export type ConflictChoice = "ours" | "theirs" | "unset"`
  - `export type ConflictSegment = { kind: "text"; text: string } | { kind: "conflict"; id: number; ours: string; theirs: string }`
  - `export type ParseConflictResult = { ok: true; segments: ConflictSegment[] } | { ok: false; reason: "no_markers" | "malformed" }`
  - `export function parseConflictMarkers(content: string): ParseConflictResult`
  - `export function applyConflictChoices(segments: ConflictSegment[], choices: Record<number, ConflictChoice>): string | null` — returns `null` if any conflict id is missing or `unset`
  - `export function previewConflictContent(segments: ConflictSegment[], choices: Record<number, ConflictChoice>): string` — unset blocks rendered as `<<<<<<<\n${ours}=======\n${theirs}>>>>>>>\n` style placeholder for UI preview (keep markers so unresolved is obvious)
  - `export function conflictIds(segments: ConflictSegment[]): number[]`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  applyConflictChoices,
  parseConflictMarkers,
  previewConflictContent,
} from "../../src/renderer/src/utils/conflict-markers";

describe("conflict-markers", () => {
  it("parses multiple conflict blocks with surrounding text", () => {
    const input = [
      "head",
      "<<<<<<< HEAD",
      "a",
      "=======",
      "b",
      ">>>>>>> branch",
      "mid",
      "<<<<<<< HEAD",
      "c",
      "=======",
      "d",
      ">>>>>>> branch",
      "tail",
      "",
    ].join("\n");
    const parsed = parseConflictMarkers(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.segments.filter((s) => s.kind === "conflict")).toHaveLength(2);
    expect(applyConflictChoices(parsed.segments, { 0: "ours", 1: "theirs" })).toBe(
      ["head", "a", "mid", "d", "tail", ""].join("\n"),
    );
  });

  it("returns no_markers when file has no conflict markers", () => {
    expect(parseConflictMarkers("plain\n").ok).toBe(false);
  });

  it("returns malformed when separator missing", () => {
    const input = "<<<<<<< HEAD\nonly\n>>>>>>> x\n";
    const parsed = parseConflictMarkers(input);
    expect(parsed).toEqual({ ok: false, reason: "malformed" });
  });

  it("ignores diff3 base section between ||||||| and =======", () => {
    const input = [
      "<<<<<<< HEAD",
      "ours",
      "||||||| merged common",
      "base",
      "=======",
      "theirs",
      ">>>>>>> branch",
      "",
    ].join("\n");
    const parsed = parseConflictMarkers(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const c = parsed.segments.find((s) => s.kind === "conflict");
    expect(c && c.kind === "conflict" && c.ours).toBe("ours\n");
    expect(c && c.kind === "conflict" && c.theirs).toBe("theirs\n");
  });

  it("preview keeps markers for unset choices", () => {
    const input = ["<<<<<<< H", "o", "=======", "t", ">>>>>>> B", ""].join("\n");
    const parsed = parseConflictMarkers(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const preview = previewConflictContent(parsed.segments, { 0: "unset" });
    expect(preview).toContain("<<<<<<<");
    expect(preview).toContain("=======");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run tests/renderer/conflict-markers.test.ts`  
Expected: FAIL (module not found / exports missing)

- [ ] **Step 3: Implement parser**

Implement line-based scan:

- Start marker: line matches `/^<<<<<<</`
- Optional base: lines after start until `/^|||||||/`, then discard until `/^=======/`
- Else ours until `/^=======/`
- Theirs until `/^>>>>>>>/`
- Assign increasing `id` 0..n-1 to conflict segments
- Preserve exact line endings by joining with `\n` and restoring trailing newline if input ends with `\n` (normalize input with `content.split(/\r?\n/)` then join `\n` for consistency; document Windows CRLF → LF on resolve)

```ts
export type ConflictChoice = "ours" | "theirs" | "unset";
// ... types as in Interfaces ...

export function parseConflictMarkers(content: string): ParseConflictResult {
  const lines = content.split(/\r?\n/);
  // strip trailing empty from split if content ends with newline — keep last "" as empty line segment carefully
  // implement scanner; on incomplete block return { ok: false, reason: "malformed" }
  // if zero conflict segments return { ok: false, reason: "no_markers" }
}

export function applyConflictChoices(
  segments: ConflictSegment[],
  choices: Record<number, ConflictChoice>,
): string | null {
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.kind === "text") {
      parts.push(seg.text);
      continue;
    }
    const choice = choices[seg.id];
    if (choice !== "ours" && choice !== "theirs") return null;
    parts.push(choice === "ours" ? seg.ours : seg.theirs);
  }
  return parts.join("");
}

export function previewConflictContent(
  segments: ConflictSegment[],
  choices: Record<number, ConflictChoice>,
): string {
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.kind === "text") {
      parts.push(seg.text);
      continue;
    }
    const choice = choices[seg.id] ?? "unset";
    if (choice === "ours") parts.push(seg.ours);
    else if (choice === "theirs") parts.push(seg.theirs);
    else {
      parts.push(`<<<<<<<\n${seg.ours}=======\n${seg.theirs}>>>>>>>\n`);
    }
  }
  return parts.join("");
}

export function conflictIds(segments: ConflictSegment[]): number[] {
  return segments.filter((s) => s.kind === "conflict").map((s) => (s as { id: number }).id);
}
```

Store `text` / `ours` / `theirs` **including trailing `\n` on each logical line group** so `join("")` reconstructs the file.

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/renderer/conflict-markers.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit** (only if user asked to commit this slice)

```bash
git add src/renderer/src/utils/conflict-markers.ts tests/renderer/conflict-markers.test.ts
git commit -m "feat: add conflict marker parser for Changes resolve UI"
```

---

### Task 2: Main-process conflict APIs + dugite tests

**Files:**
- Modify: `src/shared/git-types.ts`
- Modify: `src/main/git-host.ts`
- Modify: `tests/main/git-host-dugite.test.ts`

**Interfaces:**
- Produces (in `git-types.ts`):

```ts
export type GitConflictContentResult =
  | {
      supported: true;
      working: string;
      ours: string;
      theirs: string;
      labels: { ours: string; theirs: string };
    }
  | { supported: false; reason?: "too_large" | "binary" | "not_found" | "not_repo" };
```

- Produces (in `git-host.ts`):
  - `getConflictContent(cwd, relativePath): Promise<GitConflictContentResult>`
  - `resolveConflictPath(cwd, relativePath, content): Promise<GitOpResult>`
  - `checkoutConflictSide(cwd, relativePath, side: "ours" | "theirs"): Promise<GitOpResult>`
  - `abortMerge(cwd): Promise<GitOpResult>`

- [ ] **Step 1: Add types to `git-types.ts`**

Add `GitConflictContentResult` as above.

- [ ] **Step 2: Write failing dugite tests** (append to `tests/main/git-host-dugite.test.ts`)

```ts
it("resolveConflictPath clears merge conflict after writing merged content", async () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), "pi-git-ca-"));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), "pi-git-cb-"));
  temps.push(a, b);

  expect((await initRepo(a)).ok).toBe(true);
  fs.writeFileSync(path.join(a, "f.txt"), "base\n", "utf8");
  // use system git or dugite via runGit helper already in file
  await runGit(a, ["add", "f.txt"]);
  await runGit(a, ["commit", "-m", "base"]);

  await runGit(a, ["checkout", "-b", "feature"]);
  fs.writeFileSync(path.join(a, "f.txt"), "feature\n", "utf8");
  await runGit(a, ["add", "f.txt"]);
  await runGit(a, ["commit", "-m", "feature"]);

  await runGit(a, ["checkout", "master"]); // or main — detect default branch
  fs.writeFileSync(path.join(a, "f.txt"), "mainline\n", "utf8");
  await runGit(a, ["add", "f.txt"]);
  await runGit(a, ["commit", "-m", "mainline"]);

  await runGit(a, ["merge", "feature"]); // expect conflict exit — catch

  const content = await getConflictContent(a, "f.txt");
  expect(content.supported).toBe(true);
  if (!content.supported) return;
  expect(content.working).toContain("<<<<<<<");
  expect(content.ours).toContain("mainline");
  expect(content.theirs).toContain("feature");

  const resolved = await resolveConflictPath(a, "f.txt", "merged\n");
  expect(resolved.ok).toBe(true);
  const status = await getWorkspaceGitStatus(a);
  expect(status.files.every((f) => f.code !== "C")).toBe(true);
}, 60_000);

it("checkoutConflictSide stages ours", async () => {
  // same setup abbreviated — or share helper makeConflictRepo()
  // after conflict: await checkoutConflictSide(dir, "f.txt", "ours")
  // expect no C in status; file equals ours content
}, 60_000);

it("abortMerge restores clean state", async () => {
  // after conflict: await abortMerge(dir)
  // expect isGitRepository; no conflict files; MERGE_HEAD gone
}, 60_000);
```

Detect default branch after `initRepo` via `git rev-parse --abbrev-ref HEAD` rather than hardcoding `master`/`main`.

- [ ] **Step 3: Run tests — expect FAIL**

Run: `npx vitest run tests/main/git-host-dugite.test.ts`  
Expected: FAIL (exports missing)

- [ ] **Step 4: Implement git-host functions**

```ts
export async function getConflictContent(
  cwd: string,
  relativePath: string,
): Promise<GitConflictContentResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return { supported: false, reason: "not_repo" };
  const resolvedFilePath = path.resolve(cwd, relativePath);
  if (!isWithin(cwd, resolvedFilePath) || !isWithin(repositoryRoot, resolvedFilePath)) {
    return { supported: false, reason: "not_found" };
  }
  const repoRelative = toGitPath(path.relative(repositoryRoot, resolvedFilePath));
  // read working file with size/null-byte checks like getGitFileDiff
  // ours: git show :2:repoRelative (allow fail → "")
  // theirs: git show :3:repoRelative
  // labels.ours: current branch name or "HEAD"
  // labels.theirs: try name-rev MERGE_HEAD / REBASE_HEAD, else "theirs"
  return { supported: true, working, ours, theirs, labels };
}

export async function resolveConflictPath(
  cwd: string,
  relativePath: string,
  content: string,
): Promise<GitOpResult> {
  // validate path; writeFileSync utf8; git add -- path
}

export async function checkoutConflictSide(
  cwd: string,
  relativePath: string,
  side: "ours" | "theirs",
): Promise<GitOpResult> {
  // git checkout --ours|--theirs -- path; git add -- path
}

export async function abortMerge(cwd: string): Promise<GitOpResult> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return fail("not_repo", "Not a git repository");
  const gitDir = (await git(repositoryRoot, ["rev-parse", "--git-dir"])).trim();
  const absGitDir = path.isAbsolute(gitDir) ? gitDir : path.join(repositoryRoot, gitDir);
  const rebasing =
    fs.existsSync(path.join(absGitDir, "rebase-merge")) ||
    fs.existsSync(path.join(absGitDir, "rebase-apply"));
  const result = await gitAllowFail(
    repositoryRoot,
    rebasing ? ["rebase", "--abort"] : ["merge", "--abort"],
  );
  if (!result.ok) return fail(result.code, result.message);
  return { ok: true };
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `npx vitest run tests/main/git-host-dugite.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit** (if user asked)

```bash
git add src/shared/git-types.ts src/main/git-host.ts tests/main/git-host-dugite.test.ts
git commit -m "feat: git-host conflict content, resolve, checkout side, abort"
```

---

### Task 3: IPC + preload + protocol

**Files:**
- Modify: `src/shared/protocol.ts` — add under `git`:
  - `conflictContent: "git:conflictContent"`
  - `resolveConflict: "git:resolveConflict"`
  - `checkoutConflictSide: "git:checkoutConflictSide"`
  - `abortMerge: "git:abortMerge"`
- Modify: `src/main/git-ipc.ts` — import new host fns; register handlers matching preload
- Modify: `src/preload/index.ts` — expose:

```ts
conflictContent: (relativePath: string) =>
  ipcRenderer.invoke(IpcChannels.git.conflictContent, relativePath) as Promise<GitConflictContentResult>,
resolveConflict: (payload: { relativePath: string; content: string }) =>
  ipcRenderer.invoke(IpcChannels.git.resolveConflict, payload) as Promise<GitOpResultShape>,
checkoutConflictSide: (payload: { relativePath: string; side: "ours" | "theirs" }) =>
  ipcRenderer.invoke(IpcChannels.git.checkoutConflictSide, payload) as Promise<GitOpResultShape>,
abortMerge: () =>
  ipcRenderer.invoke(IpcChannels.git.abortMerge) as Promise<GitOpResultShape>,
```

**Interfaces:**
- Consumes: Task 2 host exports
- Produces: `window.api.git.conflictContent|resolveConflict|checkoutConflictSide|abortMerge`

- [ ] **Step 1: Wire protocol + ipc + preload**

Handlers must `requireRoot()` like existing git IPC; invalid args → `noWorkspace()` / `{ supported: false }`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` (or project’s equivalent script from `package.json`)  
Expected: no errors related to new git API

- [ ] **Step 3: Commit** (if user asked)

```bash
git add src/shared/protocol.ts src/main/git-ipc.ts src/preload/index.ts
git commit -m "feat: expose git conflict resolve IPC to renderer"
```

---

### Task 4: `ChangesConflictResolve.vue` + i18n

**Files:**
- Create: `src/renderer/src/components/ChangesConflictResolve.vue`
- Modify: `src/renderer/src/i18n/zh-CN.ts`, `en.ts`

**Interfaces:**
- Consumes: `parseConflictMarkers`, `applyConflictChoices`, `previewConflictContent`, `conflictIds`, `ConflictChoice`
- Consumes: parent passes `filePath`, `working`, `labels: { ours: string; theirs: string }`
- Emits: `resolve(content: string)`, `accept-side(side: "ours" | "theirs")`

Props:

```ts
defineProps<{
  filePath: string;
  working: string;
  labels: { ours: string; theirs: string };
}>();
defineEmits<{
  resolve: [content: string];
  "accept-side": [side: "ours" | "theirs"];
}>();
```

i18n keys (add both locales):

- `changesConflictAcceptOurs` / `changesConflictAcceptTheirs`
- `changesConflictAllOurs` / `changesConflictAllTheirs`
- `changesConflictConfirm` / `changesConflictBlock` (e.g. “块 {n}/{total}”)
- `changesConflictPrev` / `changesConflictNext`
- `changesConflictNoMarkers` / `changesConflictMalformed`
- `changesConflictAbort` / `changesConflictAborted` / `changesConflictResolved`
- `changesConflictBannerAction` (optional; banner uses abort label)

- [ ] **Step 1: Add i18n strings**

Chinese examples:
- 采用当前 / 采用传入 / 全部用当前 / 全部用传入 / 确认解决 / 块 {n}/{total} / 上一块 / 下一块 / 无文本冲突标记，请使用全部用当前或传入 / 冲突标记损坏 / 放弃合并 / 已放弃合并 / 已解决冲突

- [ ] **Step 2: Build Vue component**

Behavior:
1. On mount / `working` watch: `parseConflictMarkers(working)`.
2. If `no_markers`: show hint + only enable「全部用当前/传入」(emit `accept-side`).
3. If `malformed`: show error + same whole-file buttons.
4. If ok: init `choices` all `unset`; `activeId` = first conflict id.
5. Toolbar: All ours / All theirs → set every choice then either emit resolve immediately **or** only fill choices (spec: shortcut can call `checkoutConflictSide` via emit `accept-side` — **prefer emit `accept-side`** so main uses git checkout, matching staged index).
6. Per-block: buttons set `choices[activeId]`; Prev/Next change `activeId`.
7. Preview: `<pre class="conflict-preview">` with `previewConflictContent`; highlight active block with CSS class wrapping is optional — MVP: scrollable pre is enough.
8. Confirm enabled iff `applyConflictChoices(...) !== null`; click emits `resolve(content)`.

- [ ] **Step 3: Manual smoke in story-less UI** — parent wiring in Task 5; for now ensure component compiles.

- [ ] **Step 4: Commit** (if user asked)

```bash
git add src/renderer/src/components/ChangesConflictResolve.vue src/renderer/src/i18n/zh-CN.ts src/renderer/src/i18n/en.ts
git commit -m "feat: add ChangesConflictResolve panel UI"
```

---

### Task 5: Wire `ChangesTab.vue`

**Files:**
- Modify: `src/renderer/src/components/ChangesTab.vue`

**Interfaces:**
- Consumes: Task 3 APIs + Task 4 component

- [ ] **Step 1: State + load path**

```ts
const conflictPayload = ref<null | {
  working: string;
  labels: { ours: string; theirs: string };
}>(null);

async function loadDiff(relativePath: string): Promise<void> {
  selectedPath.value = relativePath;
  const file = files.value.find((f) => f.relativePath === relativePath);
  if (file && (file.status === "conflict" || file.code === "C")) {
    const result = await window.api.git.conflictContent(relativePath);
    if (result.supported) {
      conflictPayload.value = { working: result.working, labels: result.labels };
      patch.value = null;
      return;
    }
    conflictPayload.value = null;
    // fall through to normal diff if unsupported
  } else {
    conflictPayload.value = null;
  }
  // existing diff load...
}
```

- [ ] **Step 2: Handlers**

```ts
async function onConflictResolve(content: string): Promise<void> {
  if (!selectedPath.value) return;
  await runOp(t.changesConflictResolved, () =>
    window.api.git.resolveConflict({ relativePath: selectedPath.value!, content }),
  );
}

async function onConflictAcceptSide(side: "ours" | "theirs"): Promise<void> {
  if (!selectedPath.value) return;
  await runOp(t.changesConflictResolved, () =>
    window.api.git.checkoutConflictSide({ relativePath: selectedPath.value!, side }),
  );
}

async function onAbortMerge(): Promise<void> {
  if (!window.confirm(t.changesConflictAbort + "?")) return;
  await runOp(t.changesConflictAborted, () => window.api.git.abortMerge());
}
```

- [ ] **Step 3: Template**

- Banner: add Abort button next to conflict count text.
- Diff pane: if `conflictPayload && selectedPath`, render:

```vue
<ChangesConflictResolve
  :file-path="selectedPath"
  :working="conflictPayload.working"
  :labels="conflictPayload.labels"
  @resolve="onConflictResolve"
  @accept-side="onConflictAcceptSide"
/>
```

Else existing diff UI.

- [ ] **Step 4: Typecheck + targeted tests**

Run:
- `npx vitest run tests/renderer/conflict-markers.test.ts tests/main/git-host-dugite.test.ts`
- `npm run typecheck`

Expected: all pass

- [ ] **Step 5: Commit** (if user asked)

```bash
git add src/renderer/src/components/ChangesTab.vue
git commit -m "feat: wire conflict resolve pane into Changes tab"
```

---

### Task 6: Acceptance checklist

- [ ] Conflict file with markers: per-block choose → confirm → no `C`, file content correct, staged.
- [ ] All ours / all theirs via checkout side works without markers path.
- [ ] Confirm disabled until all blocks chosen.
- [ ] Abort merge clears conflicts (or clear error toast).
- [ ] Non-conflict files still use normal diff + discard/restore.
- [ ] zh / en strings present for new keys.

---

## Spec coverage (self-review)

| Spec item | Task |
|-----------|------|
| Per-block ours/theirs | 1, 4, 5 |
| Confirm write + git add | 2, 5 |
| All ours / all theirs | 2 (`checkoutConflictSide`), 4–5 |
| Abort merge/rebase | 2, 5 |
| No markers fallback | 4 |
| Labels ours/theirs | 2 `getConflictContent` |
| IPC surface | 3 |
| Unit + dugite tests | 1, 2 |
| Non-goals respected | Global Constraints |

## Placeholder / type consistency check

- Choice type consistently `"ours" | "theirs" | "unset"`.
- Side checkout payload uses `"ours" | "theirs"` only.
- API names: `conflictContent`, `resolveConflict`, `checkoutConflictSide`, `abortMerge` match protocol keys.
- Host fn `resolveConflictPath` vs IPC `resolveConflict` — intentional rename at IPC boundary.
