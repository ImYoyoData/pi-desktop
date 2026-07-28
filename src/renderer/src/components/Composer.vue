<script setup lang="ts">
import { computed, h, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  NButton,
  NDropdown,
  NIcon,
  NImage,
  NModal,
  NPopover,
  NSelect,
  NText,
  NTooltip,
  useMessage,
} from "naive-ui";
import type { DropdownOption } from "naive-ui";
import {
  AddOutline,
  ContractOutline,
  DocumentOutline,
  ExpandOutline,
  FlashOutline,
  MicOutline,
  SendOutline,
  StopOutline,
} from "@vicons/ionicons5";
import ComposerRichEditor from "@renderer/components/ComposerRichEditor.vue";
import AsrInstallProgress from "@renderer/components/AsrInstallProgress.vue";
import VoiceRecordBar from "@renderer/components/VoiceRecordBar.vue";
import SendQueueBar from "@renderer/components/SendQueueBar.vue";
import { useChatStore } from "@renderer/stores/chat";
import { isHttpUrl, useComposerStore } from "@renderer/stores/composer";
import { useSendQueueStore } from "@renderer/stores/send-queue";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { formatAsrInstallError, formatAsrRuntimeError, useAsrStore } from "@renderer/stores/asr";
import { useMediaStore } from "@renderer/stores/media";
import { heuristicSessionTitle } from "@renderer/utils/session-title";
import { startVoiceRecord, type VoiceRecordSession } from "@renderer/utils/pcm-capture";
import { ASR_VOICE_WAKE_EVENT, stopWakeListen } from "@renderer/utils/asr-wake-listen";
import { scrubAsrHallucination } from "../../../shared/asr";
import { formatAcceleratorLabel } from "../../../shared/hotkey";
import {
  composerModePreamble,
  isComposerAgentMode,
  type ComposerAgentMode,
} from "../../../shared/composer-modes";
import { formatLlmError } from "@renderer/utils/llm-error";
import { locale, t } from "@renderer/i18n";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const chat = useChatStore();
const composer = useComposerStore();
const sendQueue = useSendQueueStore();
const sessions = useSessionsStore();
const workspace = useWorkspaceStore();
const asr = useAsrStore();
const media = useMediaStore();
const messageApi = useMessage();
let voiceSession: VoiceRecordSession | null = null;
let voiceConfirming = false;
/** Bumped to ignore late transcription results after cancel/switch. */
let voiceGen = 0;
let offAsrProgress: (() => void) | undefined;
const voiceActive = ref(false);
const voiceLevel = ref(0);
/** True from confirm until transcription finishes ? send button loading. */
const voicePending = ref(false);

type ModelSelectOption =
  | { type: "group"; label: string; key: string; children: { label: string; value: string }[] }
  | { label: string; value: string };

const SESSION_PREFS_KEY = "pi-desktop:session-model-prefs";

type SessionPrefs = {
  models: Record<string, string>;
  thinking: Record<string, ThinkingLevel>;
};

function loadSessionPrefs(): SessionPrefs {
  try {
    const raw = localStorage.getItem(SESSION_PREFS_KEY);
    if (!raw) return { models: {}, thinking: {} };
    const parsed = JSON.parse(raw) as Partial<SessionPrefs>;
    return {
      models: parsed.models && typeof parsed.models === "object" ? parsed.models : {},
      thinking:
        parsed.thinking && typeof parsed.thinking === "object"
          ? (parsed.thinking as Record<string, ThinkingLevel>)
          : {},
    };
  } catch {
    return { models: {}, thinking: {} };
  }
}

const availableModels = ref<ModelSelectOption[]>([]);
const selectedModelKey = ref<string | null>(null);
/** Last applied model key for the active session (`sessionId::provider/id`). */
const appliedModelForSession = ref<string | null>(null);
/** Per-session remembered model (`provider/id`) and thinking level. */
const modelBySession = ref<Record<string, string>>(loadSessionPrefs().models);
const thinkingBySession = ref<Record<string, ThinkingLevel>>(loadSessionPrefs().thinking);
const thinkingLevel = ref<ThinkingLevel>("medium");
const fileInput = ref<HTMLInputElement | null>(null);
const richEditor = ref<{
  focus?: () => void;
  focusEnd?: () => void;
  isCaretAtEnd?: () => boolean;
  getSurface?: () => HTMLElement | null;
  appendTextAtEnd?: (text: string) => void;
  scrollToEnd?: () => void;
} | null>(null);
/** Expanded tall editor (hover affordance top-right). */
const editorExpanded = ref(false);
/** True while we programmatically move the caret during ASR updates. */
let asrCaretGuardUntil = 0;

function armAsrCaretGuard(ms = 120): void {
  asrCaretGuardUntil = Date.now() + ms;
}

function focusDraft(): void {
  richEditor.value?.focus?.();
}

/** Keep focus + caret at end of the draft while dictating. */
function focusDraftAtEnd(): void {
  armAsrCaretGuard();
  richEditor.value?.focusEnd?.();
  richEditor.value?.scrollToEnd?.();
}

/**
 * Stop recording only when the user intentionally moves the caret
 * (mouse reposition or navigation keys) — typing must NOT cancel.
 * Only applies once the draft already has text.
 */
function shouldStopForCaretMove(): boolean {
  if (!voiceActive.value || asr.transcribing) return false;
  if (Date.now() < asrCaretGuardUntil) return false;
  return Boolean(composer.draft.trim());
}

function onDraftCaretClick(): void {
  if (!shouldStopForCaretMove()) return;
  if (richEditor.value?.isCaretAtEnd?.()) return;
  cancelVoice();
}

function onDraftKeyup(e: KeyboardEvent): void {
  const nav = new Set([
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
    "PageUp",
    "PageDown",
  ]);
  if (!nav.has(e.key)) return;
  if (!shouldStopForCaretMove()) return;
  cancelVoice();
}

function persistSessionPrefs(): void {
  localStorage.setItem(
    SESSION_PREFS_KEY,
    JSON.stringify({
      models: modelBySession.value,
      thinking: thinkingBySession.value,
    }),
  );
}

function flatModelOptions(groups: ModelSelectOption[]): { label: string; value: string }[] {
  return groups.flatMap((g) => ("children" in g ? g.children : [g]));
}

function modelKeyFromState(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const model = (data as { model?: unknown }).model;
  if (!model || typeof model !== "object") return null;
  const m = model as { provider?: unknown; id?: unknown };
  if (typeof m.provider !== "string" || typeof m.id !== "string") return null;
  if (!m.provider || !m.id) return null;
  return `${m.provider}/${m.id}`;
}

function thinkingFromState(data: unknown): ThinkingLevel | null {
  if (!data || typeof data !== "object") return null;
  const level = (data as { thinkingLevel?: unknown }).thinkingLevel;
  if (typeof level !== "string") return null;
  const allowed: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
  return (allowed as string[]).includes(level) ? (level as ThinkingLevel) : null;
}

function rememberModel(sessionId: string, key: string): void {
  modelBySession.value = { ...modelBySession.value, [sessionId]: key };
  persistSessionPrefs();
}

function rememberThinking(sessionId: string, level: ThinkingLevel): void {
  thinkingBySession.value = { ...thinkingBySession.value, [sessionId]: level };
  persistSessionPrefs();
}

const thinkingOptions = [
  { label: "Off", value: "off" },
  { label: "Minimal", value: "minimal" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "XHigh", value: "xhigh" },
];

const thinkingMenu = computed<DropdownOption[]>(() =>
  thinkingOptions.map((o) => ({
    label: o.label,
    key: o.value,
    props:
      o.value === thinkingLevel.value
        ? { style: "font-weight: 600; color: var(--accent)" }
        : undefined,
  })),
);

const thinkingLabel = computed(
  () => thinkingOptions.find((o) => o.value === thinkingLevel.value)?.label ?? "Medium",
);

const sessionId = computed(() => sessions.activeId);
const running = computed(() => chat.activeRunning || activeSessionRunning());

function activeSessionRunning(): boolean {
  const id = sessions.activeId;
  if (!id) return false;
  return sessions.sessions.find((s) => s.id === id)?.status === "running";
}

const hasSendContent = computed(() =>
  Boolean(composer.draft.trim() || composer.images.length || composer.chips.length),
);

/** Editing a queued item — Enter/Send commits back to the queue. */
const isEditingQueue = computed(() => Boolean(sendQueue.editingId));
const isEditingPublished = computed(
  () =>
    Boolean(chat.pendingUserEdit) &&
    chat.pendingUserEdit?.sessionId === sessionId.value,
);

/** Show stop while running; show send whenever there is a session (empty → disabled). */
const showPrimaryAction = computed(() => Boolean(sessionId.value));
/** Stop when running with empty composer; otherwise send/queue. */
const primaryIsStop = computed(() => running.value && !hasSendContent.value);

async function readImageFile(file: File): Promise<{
  data: string;
  mimeType: string;
  previewUrl: string;
} | null> {
  if (!file.type.startsWith("image/")) return null;
  if (file.size > 8 * 1024 * 1024) {
    messageApi.warning(t.imageTooLarge);
    return null;
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const base64 = dataUrl.split(",")[1] ?? "";
  return {
    data: base64,
    mimeType: file.type || "image/png",
    previewUrl: URL.createObjectURL(file),
  };
}

function electronFilePath(file: File): string | null {
  let p = (file as File & { path?: string }).path;
  if (typeof p !== "string" || !p.trim()) {
    try {
      p = window.api.files.getPathForFile(file);
    } catch {
      p = "";
    }
  }
  if (typeof p === "string" && p.trim()) return toWorkspaceRelative(p.trim());
  return null;
}

/** Prefer workspace-relative paths for file tags. */
function toWorkspaceRelative(absOrRel: string): string {
  const raw = absOrRel.replace(/\\/g, "/");
  const root = (workspace.root || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root) return raw;
  const fold = (s: string) => (pathCaseInsensitive.value ? s.toLowerCase() : s);
  const rootFold = fold(root);
  const pathFold = fold(raw);
  if (pathFold === rootFold) return "";
  if (pathFold.startsWith(`${rootFold}/`)) return raw.slice(root.length + 1);
  return raw;
}

const pathCaseInsensitive = ref(false);
void window.api.window.platform().then((p) => {
  // Windows + default macOS APFS volumes are case-insensitive.
  pathCaseInsensitive.value = p === "win32" || p === "darwin";
});

function fileUrlToPath(uri: string): string | null {
  const raw = uri.trim();
  if (!raw) return null;
  try {
    if (/^file:\/\//i.test(raw)) {
      const u = new URL(raw);
      let p = decodeURIComponent(u.pathname);
      if (/^\/[A-Za-z]:\//.test(p)) {
        p = p.slice(1).replace(/\//g, "\\");
      }
      return toWorkspaceRelative(p);
    }
  } catch {
    // fall through
  }
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\") || raw.startsWith("/")) {
    return toWorkspaceRelative(raw);
  }
  return null;
}

async function addFiles(files: FileList | File[]): Promise<void> {
  const list = Array.from(files);
  for (const file of list) {
    if (file.type.startsWith("image/")) {
      const img = await readImageFile(file);
      if (img) composer.addImageFile(img);
      continue;
    }
    const filePath = electronFilePath(file);
    if (filePath) composer.addFileTag(filePath);
  }
}

function modeTagLabel(mode: ComposerAgentMode): string {
  switch (mode) {
    case "agent":
      return t.composerModeAgent;
    case "ask":
      return t.composerModeAsk;
    case "plan":
      return t.composerModePlan;
    case "task":
      return t.composerModeTask;
    default: {
      const _never: never = mode;
      return String(_never);
    }
  }
}

function snapshotComposerPayload(): {
  text: string;
  displayText: string;
  imagesToSend: { type: "image"; data: string; mimeType: string }[];
  citationsToSend:
    | { url: string; selector?: string; text?: string; htmlSnippet?: string }[]
    | undefined;
  tagsToSend:
    | {
        url: string;
        host: string;
        label: string;
        content?: string;
        kind?: "file" | "url" | "element" | "agent" | "plan" | "ask" | "task";
      }[]
    | undefined;
} | null {
  const chipText = composer.formatChipsForMessage();
  const displayText = composer.draft.trim();
  const mode = composer.activeMode();
  const body = [displayText, chipText].filter(Boolean).join("\n\n");
  const text = [composerModePreamble(mode), body].filter(Boolean).join("\n\n");
  if (!body && !composer.images.length && !composer.chips.length) return null;
  const citations = composer.elementCitations();
  const citationList = citations.length ? citations : undefined;
  const attachmentTags = composer.attachmentTagSnapshot();
  const seen = new Set<string>();
  const imagesToSend = composer.images
    .filter((i) => {
      if (seen.has(i.data)) return false;
      seen.add(i.data);
      return true;
    })
    .map((i) => ({
      type: "image" as const,
      data: i.data,
      mimeType: i.mimeType || "image/png",
    }));
  const citationsToSend = citationList
    ? citationList.map((c) => ({
        url: c.url,
        selector: c.selector,
        text: c.text,
        htmlSnippet: c.htmlSnippet,
      }))
    : undefined;
  const modeLabel = modeTagLabel(mode);
  const tagsToSend = [
    {
      url: mode,
      host: "",
      label: modeLabel,
      content: mode,
      kind: mode,
    },
    ...attachmentTags.map((row) => {
      let host = "";
      if (row.kind === "url" || row.kind === "element") {
        try {
          host = new URL(row.ref).host;
        } catch {
          host = "";
        }
      }
      return {
        url: row.ref,
        host,
        label: row.label,
        content: row.content,
        kind: row.kind,
      };
    }),
  ];
  return { text, displayText, imagesToSend, citationsToSend, tagsToSend };
}

const attachMenu: DropdownOption[] = [
  {
    label: t.composerAttachFile,
    key: "file",
    icon: () => h(NIcon, null, { default: () => h(DocumentOutline) }),
  },
];

const modeSelectOptions = [
  { label: t.composerModeAgent, value: "agent" as const },
  { label: t.composerModeAsk, value: "ask" as const },
  { label: t.composerModePlan, value: "plan" as const },
  { label: t.composerModeTask, value: "task" as const },
];

async function onAttachSelect(key: string | number): Promise<void> {
  if (String(key) === "file") {
    const picked = await window.api.preview.pickFile();
    if (picked) composer.addFileTag(picked);
  }
}

function enqueueFromComposer(): boolean {
  const id = sessionId.value;
  if (!id) return false;
  const snap = snapshotComposerPayload();
  if (!snap) return false;
  const message =
    snap.displayText ||
    (snap.imagesToSend.length || snap.tagsToSend?.length ? " " : snap.text || " ");
  sendQueue.enqueue(id, {
    text: message,
    images: snap.imagesToSend.length ? snap.imagesToSend : undefined,
    citations: snap.citationsToSend,
    elementTags: snap.tagsToSend,
    agentText: snap.text || undefined,
  });
  composer.clear();
  messageApi.success(t.queueAdded, { duration: 1400 });
  // Race fix: turn may already be idle when Enter queued — flush now instead of waiting
  // for the next running→idle edge (which made messages look "lost" until the next turn).
  if (!isAgentBusy(id)) {
    void drainQueueIfIdle(id);
  }
  return true;
}

/** Persist main-composer contents back onto the queue item being edited. */
function saveEditingToQueue(): boolean {
  const id = sessionId.value;
  const qid = sendQueue.editingId;
  if (!id || !qid) return false;
  const snap = snapshotComposerPayload();
  if (!snap) {
    messageApi.warning(t.queueEditPlaceholder);
    return false;
  }
  const message =
    snap.displayText ||
    (snap.imagesToSend.length || snap.tagsToSend?.length ? " " : snap.text || " ");
  const updated = sendQueue.updateItem(id, qid, {
    text: message,
    agentText: snap.text || undefined,
    images: snap.imagesToSend.length ? snap.imagesToSend : undefined,
    citations: snap.citationsToSend,
    elementTags: snap.tagsToSend,
  });
  if (!updated) {
    sendQueue.setEditing(id, null);
    return false;
  }
  sendQueue.setEditing(id, null);
  composer.clear();
  messageApi.success(t.queueSaved, { duration: 1400 });
  return true;
}

function discardQueueEdit(): void {
  const id = sessionId.value;
  if (!id) return;
  sendQueue.setEditing(id, null);
  composer.clear();
}

function discardPublishedEdit(): void {
  chat.cancelEditUser();
  composer.clear();
}

function loadQueueItemIntoComposer(item: {
  text: string;
  images?: { type: "image"; data: string; mimeType: string }[];
  citations?: { url: string; selector?: string; text?: string; htmlSnippet?: string }[];
  elementTags?: {
    url: string;
    host: string;
    label: string;
    content?: string;
    kind?: "file" | "url" | "element" | "agent" | "plan" | "ask" | "task";
  }[];
}): void {
  composer.clear();
  composer.draft = item.text === " " ? "" : item.text;
  for (const img of item.images ?? []) {
    composer.addImageFile({
      data: img.data,
      mimeType: img.mimeType || "image/png",
      previewUrl: `data:${img.mimeType || "image/png"};base64,${img.data}`,
    });
  }
  const seenUrls = new Set<string>();
  for (const c of item.citations ?? []) {
    seenUrls.add(c.url);
    composer.addCitation({
      url: c.url,
      selector: c.selector ?? "",
      text: c.text ?? "",
      htmlSnippet: c.htmlSnippet ?? "",
    });
  }
  for (const tag of item.elementTags ?? []) {
    if (isComposerAgentMode(tag.kind)) {
      composer.setMode(tag.kind);
      continue;
    }
    if (tag.kind === "file") {
      composer.addFileTag(tag.content || tag.label || tag.url);
      continue;
    }
    if (tag.kind === "url" || (!tag.kind && /^https?:\/\//i.test(tag.url))) {
      composer.addUrlTag(tag.url);
      continue;
    }
    if (seenUrls.has(tag.url)) continue;
    seenUrls.add(tag.url);
    composer.addCitation({
      url: tag.url,
      selector: "",
      text: tag.content || tag.label || "",
      htmlSnippet: "",
    });
  }
}

function beginEditQueueItem(itemId: string): void {
  const id = sessionId.value;
  if (!id) return;
  if (voiceActive.value) cancelVoice();
  if (chat.pendingUserEdit) chat.cancelEditUser();

  const editing = sendQueue.editingId;
  if (editing && editing !== itemId) {
    // Commit the previous edit before switching
    if (hasSendContent.value) saveEditingToQueue();
    else sendQueue.setEditing(id, null);
  }

  // Don't lose an unrelated draft sitting in the composer
  if (!sendQueue.editingId && hasSendContent.value) {
    enqueueFromComposer();
  }

  const item = sendQueue.get(id, itemId);
  if (!item) return;
  loadQueueItemIntoComposer(item);
  sendQueue.setEditing(id, itemId);
  void nextTick(() => focusDraftAtEnd());
}

async function dispatchQueuedItem(
  id: string,
  item: {
    text: string;
    agentText?: string;
    images?: { type: "image"; data: string; mimeType: string }[];
    citations?: { url: string; selector?: string; text?: string; htmlSnippet?: string }[];
    elementTags?: {
      url: string;
      host: string;
      label: string;
      content?: string;
      kind?: "file" | "url" | "element" | "agent" | "plan" | "ask" | "task";
    }[];
  },
): Promise<void> {
  // Always prompt: Pi followUp only queues during a live turn and will not
  // start a new turn when the agent is already idle (queued items vanished).
  const agentText = item.agentText || item.text || " ";
  const displayText = item.text === " " ? "" : item.text;
  await chat.sendPrompt(
    id,
    agentText,
    item.citations,
    item.images,
    item.elementTags,
    displayText,
  );
}

function waitUntilIdle(sessionId: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const stateRunning = chat.bySession[sessionId]?.running;
      const statusRunning =
        sessions.sessions.find((s) => s.id === sessionId)?.status === "running";
      if (!stateRunning && !statusRunning) {
        resolve();
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(tick, 80);
    };
    tick();
  });
}

function isAgentBusy(targetSessionId?: string): boolean {
  const id = targetSessionId ?? sessionId.value;
  if (!id) return false;
  if (chat.bySession[id]?.running) return true;
  return sessions.sessions.find((s) => s.id === id)?.status === "running";
}

function queueItemHasContent(item: {
  text: string;
  images?: unknown[];
  citations?: unknown[];
  elementTags?: unknown[];
}): boolean {
  return Boolean(
    item.text.trim() ||
      item.images?.length ||
      item.citations?.length ||
      item.elementTags?.length,
  );
}

/** Serialize auto-drain so idle races cannot fire two sends at once. */
let drainInFlight: string | null = null;

async function drainQueueIfIdle(targetSessionId: string): Promise<void> {
  if (drainInFlight === targetSessionId) return;
  if (sendQueue.isDrainSuppressed(targetSessionId)) return;
  if (isAgentBusy(targetSessionId)) return;

  // Claim lock before takeNext — concurrent running/length watchers otherwise
  // both shift items and one send is lost.
  drainInFlight = targetSessionId;
  let taken: ReturnType<typeof sendQueue.takeNext> = null;
  let sentOk = false;
  try {
    while (!isAgentBusy(targetSessionId) && !sendQueue.isDrainSuppressed(targetSessionId)) {
      taken = sendQueue.takeNext(targetSessionId);
      if (!taken) return;
      if (!queueItemHasContent(taken)) {
        taken = null;
        continue;
      }
      await dispatchQueuedItem(targetSessionId, taken);
      taken = null;
      sentOk = true;
      // One turn per drain; chain the next item after the lock is released.
      return;
    }
  } catch (err) {
    if (taken) {
      sendQueue.requeueFront(targetSessionId, taken);
      taken = null;
    }
    const msg = err instanceof Error ? err.message : String(err);
    messageApi.error(msg);
  } finally {
    if (drainInFlight === targetSessionId) drainInFlight = null;
    // running→idle watch may have been skipped while the lock was held for the
    // full prompt; continue the queue now that we are idle again.
    if (
      sentOk &&
      !sendQueue.isDrainSuppressed(targetSessionId) &&
      !isAgentBusy(targetSessionId) &&
      sendQueue.list(targetSessionId).length > 0
    ) {
      void drainQueueIfIdle(targetSessionId);
    }
  }
}

async function sendQueuedNow(itemId: string): Promise<void> {
  const id = sessionId.value;
  if (!id) return;
  const item = sendQueue.remove(id, itemId);
  if (!item) return;
  if (voiceActive.value) cancelVoice();
  sendQueue.setSuppressDrain(id, true);
  try {
    if (running.value) {
      await chat.abort(id);
      await waitUntilIdle(id);
    }
    await dispatchQueuedItem(id, item);
  } finally {
    sendQueue.setSuppressDrain(id, false);
  }
}

async function submit(mode: "prompt" | "steer" | "follow_up"): Promise<void> {
  // Sending cancels an in-progress voice take / waits out pending ASR
  if (voiceActive.value) cancelVoice();
  if (voicePending.value) return;

  const id = sessionId.value;
  if (!id) return;

  // Editing a queued message: commit back into the queue
  if (sendQueue.editingId) {
    saveEditingToQueue();
    return;
  }

  // While agent is running, new sends go to the queue (Cursor-style)
  if (running.value && mode === "prompt") {
    enqueueFromComposer();
    return;
  }

  const snap = snapshotComposerPayload();
  if (!snap) return;

  // Re-editing a published user bubble: truncate that turn only once we have a send payload
  if (chat.pendingUserEdit?.sessionId === id) {
    chat.commitEditUser(id);
  }

  const displayText = snap.displayText;
  const agentText = snap.text || " ";
  const titleSeed = displayText || snap.tagsToSend?.[0]?.content || snap.tagsToSend?.[0]?.label || "";
  composer.clear();
  if (mode === "prompt") {
    const root = workspace.root;
    const summary = sessions.sessions.find((s) => s.id === id);
    if (root && titleSeed && !summary?.name?.trim()) {
      const title = heuristicSessionTitle(titleSeed);
      if (title) void sessions.renameSession(id, root, title);
    }
    await chat.sendPrompt(
      id,
      agentText,
      snap.citationsToSend,
      snap.imagesToSend,
      snap.tagsToSend,
      displayText,
    );
  } else if (mode === "steer") await chat.steer(id, agentText);
  else await chat.followUp(id, agentText);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.isComposing) return;

  if (editorExpanded.value) {
    // Expanded editor: Enter inserts newline; Shift+Enter sends.
    if (!event.shiftKey) return;
  } else {
    // Compact editor: Enter sends; Shift+Enter inserts newline.
    if (event.shiftKey) return;
  }

  event.preventDefault();
  if (sendQueue.editingId) {
    saveEditingToQueue();
    return;
  }
  if (running.value) {
    enqueueFromComposer();
    return;
  }
  void submit("prompt");
}

async function onAbort(): Promise<void> {
  if (sessionId.value) await chat.abort(sessionId.value);
}

function onPrimaryAction(): void {
  if (voicePending.value) return;
  if (sendQueue.editingId && !running.value) {
    saveEditingToQueue();
    return;
  }
  if (running.value && !hasSendContent.value) {
    void onAbort();
    return;
  }
  if (running.value && hasSendContent.value) {
    onQueueSendClick();
    return;
  }
  void submit("prompt");
}

function onQueueSendClick(): void {
  if (sendQueue.editingId) {
    saveEditingToQueue();
    return;
  }
  enqueueFromComposer();
}

function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

const contextUsage = computed(() => sessions.activeContextUsage);
const ctxPopoverShow = ref(false);
const skillsCount = ref<number | null>(null);
let skillsCountCachedFor: string | null = null;

const contextPercent = computed(() => {
  const pct = contextUsage.value?.percent;
  if (pct == null || !Number.isFinite(pct)) return null;
  return Math.max(0, Math.min(100, pct));
});

const contextPercentLabel = computed(() => {
  const pct = contextPercent.value;
  if (pct == null) return "?%";
  return `${pct.toFixed(0)}%`;
});

const contextTone = computed(() => {
  const pct = contextPercent.value;
  if (pct == null) return "muted";
  if (pct > 90) return "danger";
  if (pct > 70) return "warn";
  return "ok";
});

const contextRingStyle = computed(() => {
  const pct = contextPercent.value ?? 0;
  const r = 7;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  return {
    strokeDasharray: `${c}`,
    strokeDashoffset: `${offset}`,
  };
});

const contextMessageCount = computed(() => chat.activeMessages.length);
const contextToolCount = computed(
  () => chat.activeMessages.filter((m) => m.role === "tool").length,
);

const contextTokensLabel = computed(() => {
  const usage = contextUsage.value;
  if (!usage) return "—";
  if (usage.tokens !== null) return formatTokens(usage.tokens);
  return "?";
});

const contextWindowLabel = computed(() => {
  const usage = contextUsage.value;
  if (!usage) return "—";
  return formatTokens(usage.contextWindow);
});

async function openContextPopover(): Promise<void> {
  ctxPopoverShow.value = !ctxPopoverShow.value;
  if (!ctxPopoverShow.value) return;
  const root = workspace.root ?? "";
  if (skillsCountCachedFor === root && skillsCount.value !== null) return;
  try {
    const data = await window.api.skills.list(workspace.root ?? undefined);
    skillsCount.value = data.skills?.length ?? 0;
    skillsCountCachedFor = root;
  } catch {
    skillsCount.value = null;
  }
}

function closeContextPopover(): void {
  ctxPopoverShow.value = false;
}

async function onThinkingChange(value: string | number): Promise<void> {
  const id = sessionId.value;
  const level = String(value) as ThinkingLevel;
  thinkingLevel.value = level;
  if (!id) return;
  rememberThinking(id, level);
  await sessions.sendCommand(id, { type: "set_thinking_level", level });
}

async function refreshModels(): Promise<void> {
  try {
    const data = await window.api.models.get();
    const byProvider = new Map<string, { label: string; value: string }[]>();
    for (const m of data.available) {
      const list = byProvider.get(m.provider) ?? [];
      const label = (m.name && m.name.trim()) || m.id;
      list.push({ label, value: `${m.provider}/${m.id}` });
      byProvider.set(m.provider, list);
    }
    const groups: ModelSelectOption[] = [...byProvider.entries()].map(([provider, children]) => ({
      type: "group",
      label: provider,
      key: provider,
      children,
    }));
    availableModels.value = groups;
    await syncSessionModelAndThinking();
  } catch {
    availableModels.value = [];
  }
}

async function syncSessionModelAndThinking(): Promise<void> {
  const id = sessionId.value;
  const flat = flatModelOptions(availableModels.value);
  if (!id) {
    selectedModelKey.value = flat[0]?.value ?? null;
    return;
  }

  // Instant UI from per-session memory
  const remembered = modelBySession.value[id];
  if (remembered && flat.some((o) => o.value === remembered)) {
    selectedModelKey.value = remembered;
  }
  const rememberedThinking = thinkingBySession.value[id];
  if (rememberedThinking) {
    thinkingLevel.value = rememberedThinking;
  }

  // Prefer live worker state (source of truth for existing sessions)
  let workerKey: string | null = null;
  let workerThinking: ThinkingLevel | null = null;
  try {
    const state = await sessions.sendCommand(id, { type: "get_state" });
    workerKey = modelKeyFromState(state);
    workerThinking = thinkingFromState(state);
    sessions.applyContextFromState(id, state);
  } catch {
    // Worker may still be starting; fall back to remembered / default below.
  }

  if (workerKey && flat.some((o) => o.value === workerKey)) {
    selectedModelKey.value = workerKey;
    rememberModel(id, workerKey);
  } else if (remembered && flat.some((o) => o.value === remembered)) {
    selectedModelKey.value = remembered;
  } else if (!selectedModelKey.value || !flat.some((o) => o.value === selectedModelKey.value)) {
    selectedModelKey.value = flat[0]?.value ?? null;
  }

  if (workerThinking) {
    thinkingLevel.value = workerThinking;
    rememberThinking(id, workerThinking);
  } else if (rememberedThinking) {
    thinkingLevel.value = rememberedThinking;
  }

  // Ensure worker uses this session's remembered model (new sessions / cold workers)
  if (selectedModelKey.value) {
    const token = `${id}::${selectedModelKey.value}`;
    if (workerKey !== selectedModelKey.value || appliedModelForSession.value !== token) {
      appliedModelForSession.value = null;
      await applySelectedModel();
    } else {
      appliedModelForSession.value = token;
      rememberModel(id, selectedModelKey.value);
    }
  }

  if (rememberedThinking || thinkingLevel.value) {
    const level = thinkingLevel.value;
    if (workerThinking !== level) {
      try {
        await sessions.sendCommand(id, { type: "set_thinking_level", level });
        rememberThinking(id, level);
      } catch {
        // ignore thinking sync failures
      }
    }
  }
}

async function applySelectedModel(): Promise<void> {
  const id = sessionId.value;
  const value = selectedModelKey.value;
  if (!id || !value) return;
  // Session must be registered in the broker (present in live sessions list).
  if (!sessions.sessions.some((s) => s.id === id)) return;
  const slash = value.indexOf("/");
  if (slash <= 0) return;
  const token = `${id}::${value}`;
  if (appliedModelForSession.value === token) return;
  try {
    await sessions.sendCommand(id, {
      type: "set_model",
      provider: value.slice(0, slash),
      modelId: value.slice(slash + 1),
    });
    appliedModelForSession.value = token;
    rememberModel(id, value);
  } catch (err) {
    appliedModelForSession.value = null;
    const text = err instanceof Error ? err.message : String(err);
    // Startup race / cold worker / post-auth reload: don't toast transient noise.
    if (/unknown session|Model not found/i.test(text)) return;
    messageApi.error(formatLlmError(text, locale === "zh-CN" ? "zh-CN" : "en"));
  }
}

async function onModelChange(value: string | null): Promise<void> {
  selectedModelKey.value = value;
  appliedModelForSession.value = null;
  const id = sessionId.value;
  if (id && value) rememberModel(id, value);
  await applySelectedModel();
}

function onPaste(event: ClipboardEvent): void {
  const data = event.clipboardData;
  if (!data) return;

  const imageFiles: File[] = [];
  const pathFiles: File[] = [];

  if (data.files?.length) {
    for (const file of Array.from(data.files)) {
      if (file.type.startsWith("image/")) imageFiles.push(file);
      else pathFiles.push(file);
    }
  }

  if (data.items) {
    for (const item of Array.from(data.items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (!file) continue;
        if (file.type.startsWith("image/") || item.type.startsWith("image/")) {
          if (!imageFiles.some((f) => f.name === file.name && f.size === file.size)) {
            imageFiles.push(file);
          }
        } else if (!pathFiles.some((f) => f.name === file.name && f.size === file.size)) {
          pathFiles.push(file);
        }
      }
    }
  }

  if (imageFiles.length || pathFiles.length) {
    event.preventDefault();
    if (imageFiles.length) void addFiles(imageFiles);
    for (const file of pathFiles) {
      const filePath = electronFilePath(file);
      if (filePath) composer.addFileTag(filePath);
    }
    return;
  }

  const uriList = data.getData("text/uri-list")?.trim() ?? "";
  if (uriList) {
    const paths: string[] = [];
    let hasHttp = false;
    for (const line of uriList.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (/^https?:\/\//i.test(trimmed)) {
        hasHttp = true;
        composer.addUrlTag(trimmed);
        continue;
      }
      const filePath = fileUrlToPath(trimmed);
      if (filePath) paths.push(filePath);
    }
    if (paths.length || hasHttp) {
      event.preventDefault();
      for (const filePath of paths) composer.addFileTag(filePath);
      return;
    }
  }

  const text = data.getData("text/plain")?.trim() ?? "";
  if (text && isHttpUrl(text)) {
    event.preventDefault();
    composer.addUrlTag(text);
    return;
  }

  if (text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const asPaths = lines.map(fileUrlToPath).filter((p): p is string => Boolean(p));
    if (asPaths.length && asPaths.length === lines.length) {
      event.preventDefault();
      for (const filePath of asPaths) composer.addFileTag(filePath);
    }
  }
}

async function ensureAsrReady(): Promise<boolean> {
  // Resident warm path: status already loaded + installed — skip refresh hitch when possible.
  if (!(asr.status.residentModel && asr.status.installed && asr.status.enabled)) {
    await asr.refresh();
  }
  if (!asr.status.supported) {
    messageApi.warning(t.asrUnsupported);
    return false;
  }
  if (!asr.status.enabled) {
    messageApi.warning(t.asrDisabled);
    return false;
  }
  if (asr.status.installed) return true;

  // Model already on disk ? only (re)fetch GPU-matched runtime (install modal shows progress)
  if (asr.status.modelPath) {
    try {
      await asr.install();
      return true;
    } catch (err) {
      messageApi.error(formatAsrInstallError(err, t.asrDownloadFailed), { duration: 6000 });
      return false;
    }
  }

  const ok = window.confirm(
    t.asrInstallConfirm(
      asr.status.diskMb,
      asr.status.ramMb,
      asr.status.gpuDeviceLabel,
      asr.status.gpuBackend.toUpperCase(),
      asr.status.gpuKind === "cpu",
    ),
  );
  if (!ok) return false;
  try {
    await asr.install();
    return true;
  } catch (err) {
    messageApi.error(formatAsrInstallError(err, t.asrDownloadFailed), { duration: 6000 });
    return false;
  }
}

function setDictationWakePaused(paused: boolean): void {
  asr.setWakePaused(paused);
}

function joinAsr(base: string, next: string): string {
  const a = base.replace(/\s+$/u, "");
  const b = next.replace(/^\s+/u, "").trim();
  if (!b) return a;
  if (!a) return b;
  if (b.startsWith(a)) return b;
  if (a.endsWith(b)) return a;
  const needSpace =
    !/[\s\u3000]$/u.test(a) && !/^[,.!?;:\uFF0C\u3002\uFF01\uFF1F\u3001\uFF1B\uFF1A]/.test(b);
  return needSpace ? `${a} ${b}` : `${a}${b}`;
}

function cancelVoice(opts?: { resumeWake?: boolean }): void {
  voiceGen += 1;
  voiceSession?.abort();
  voiceSession = null;
  voiceActive.value = false;
  voiceLevel.value = 0;
  voicePending.value = false;
  voiceConfirming = false;
  asr.recording = false;
  if (opts?.resumeWake !== false) setDictationWakePaused(false);
}

async function confirmVoice(): Promise<void> {
  if (!voiceSession || voiceConfirming) return;
  voiceConfirming = true;
  const gen = voiceGen;

  // Stop mic + close record UI immediately; send button shows loading until ASR finishes
  const session = voiceSession;
  voiceSession = null;
  voiceActive.value = false;
  voiceLevel.value = 0;
  asr.recording = false;
  voicePending.value = true;

  try {
    const { pcmBase64, sampleRate } = await session.stop();
    if (gen !== voiceGen) return;
    if (!pcmBase64) {
      messageApi.warning(t.voiceEmpty);
      return;
    }
    const ready = await ensureAsrReady();
    if (gen !== voiceGen) return;
    if (!ready) return;
    const raw = await asr.transcribe(pcmBase64, sampleRate);
    if (gen !== voiceGen) return;
    const text = scrubAsrHallucination(raw);
    if (!text) {
      messageApi.warning(t.voiceEmpty);
      return;
    }
    // Append after chips / existing content (end of editor), then scroll there.
    armAsrCaretGuard();
    if (richEditor.value?.appendTextAtEnd) {
      richEditor.value.appendTextAtEnd(text);
    } else {
      composer.draft = joinAsr(composer.draft, text);
      void nextTick(() => focusDraftAtEnd());
    }
  } catch (err) {
    if (gen !== voiceGen) return;
    const raw = err instanceof Error ? err.message : String(err);
    messageApi.error(formatAsrRuntimeError(raw, t.asrFail), { duration: 5500 });
  } finally {
    voiceConfirming = false;
    voicePending.value = false;
    setDictationWakePaused(false);
  }
}

async function onMicClick(): Promise<void> {
  if (asr.installing || voiceConfirming || voicePending.value) return;
  if (voiceActive.value) return;

  // Fast gate — do not await model warm before opening the record UI.
  if (asr.status.supported === false) {
    messageApi.warning(t.asrUnsupported);
    return;
  }
  if (asr.status.enabled === false) {
    messageApi.warning(t.asrDisabled);
    return;
  }

  setDictationWakePaused(true);
  // Free wake mic (must finish before we open the dictation mic).
  await stopWakeListen();
  media.stopAll();

  try {
    voiceSession = await startVoiceRecord({
      onLevel: (level) => {
        if (!voiceActive.value) return;
        voiceLevel.value = level;
      },
      onMaxDuration: () => {
        void confirmVoice();
      },
    });
    voiceActive.value = true;
    asr.recording = true;
    void nextTick(() => focusDraftAtEnd());
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    let msg = raw;
    if (/permission denied|NotAllowed|PermissionDenied/i.test(raw) || raw.includes("\u9ea6\u514b\u98ce")) {
      msg = t.asrMicDenied;
    } else if (/No microphone|NotFound|DevicesNotFound/i.test(raw) || raw.includes("\u672a\u68c0\u6d4b")) {
      msg = t.asrMicMissing;
    }
    messageApi.error(msg);
    cancelVoice();
    return;
  }

  // Warm / ensure runtime+model in the background for when the user confirms.
  void ensureAsrReady().then((ready) => {
    if (!ready && voiceActive.value) {
      // Keep recording UI; confirmVoice will re-check / show install.
    }
  });
}

const micTitle = computed(
  () => `${t.voiceInput} (${formatAcceleratorLabel(asr.status.wakeHotkey || "Control+Alt+Y")})`,
);

function onVoiceSessionKeydown(e: KeyboardEvent): void {
  if (!voiceActive.value || voicePending.value || voiceConfirming) return;
  if (e.isComposing) return;
  if (e.key === "Enter" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    void confirmVoice();
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    cancelVoice();
  }
}

function onAsrWake(): void {
  if (asr.capturingHotkey) return;
  if (!asr.micVisible) return;
  if (voiceActive.value || voicePending.value || voiceConfirming || asr.installing) return;
  void onMicClick();
}

let offAsrWake: (() => void) | undefined;

onMounted(() => {
  composer.bindSession(sessionId.value);
  void refreshModels();
  void asr.refresh();
  offAsrProgress = asr.bindProgress();
  offAsrWake = window.api.asr.onWake(onAsrWake);
  window.addEventListener(ASR_VOICE_WAKE_EVENT, onAsrWake);
  window.addEventListener("keydown", onVoiceSessionKeydown, true);
  window.addEventListener("pi-models-changed", onModelsChanged);
});

onUnmounted(() => {
  window.removeEventListener("pi-models-changed", onModelsChanged);
  window.removeEventListener("keydown", onVoiceSessionKeydown, true);
  window.removeEventListener(ASR_VOICE_WAKE_EVENT, onAsrWake);
  offAsrProgress?.();
  offAsrWake?.();
  // Do not stop App-level wake listen — only clear dictation pause if we held it.
  cancelVoice({ resumeWake: true });
});

function onModelsChanged(): void {
  void refreshModels();
}

watch(
  () => asr.recording,
  (recording) => {
    if (recording) media.stopAll();
  },
);

watch(sessionId, (id, prev) => {
  // Switching session cancels an in-progress voice take / pending ASR
  if (voiceActive.value || voicePending.value) cancelVoice();
  if (chat.pendingUserEdit) chat.cancelEditUser();
  composer.bindSession(id);

  if (prev && selectedModelKey.value) {
    rememberModel(prev, selectedModelKey.value);
  }
  if (prev) {
    rememberThinking(prev, thinkingLevel.value);
  }
  appliedModelForSession.value = null;
  // Restore remembered UI immediately before async sync
  if (id && modelBySession.value[id]) {
    selectedModelKey.value = modelBySession.value[id];
  }
  if (id && thinkingBySession.value[id]) {
    thinkingLevel.value = thinkingBySession.value[id];
  }
  void refreshModels();
});

watch(
  () => workspace.root,
  (next, prev) => {
    if (next === prev) return;
    if (voiceActive.value || voicePending.value) cancelVoice();
  },
);

/** After a turn finishes — or when queue gains items while already idle — flush follow-ups. */
watch(running, (now, was) => {
  if (was && !now && sessionId.value) {
    void drainQueueIfIdle(sessionId.value);
  }
});

watch(
  () => sendQueue.activeItems.length,
  (len) => {
    const id = sessionId.value;
    if (len > 0 && id && !running.value) {
      void drainQueueIfIdle(id);
    }
  },
);
</script>

<template>
  <div class="composer-wrap">
    <SendQueueBar
      :items="sendQueue.activeItems"
      :editing-id="sendQueue.editingId"
      @edit="(qid) => beginEditQueueItem(qid)"
      @remove="(qid) => sessionId && sendQueue.remove(sessionId, qid)"
      @send-now="(qid) => void sendQueuedNow(qid)"
    />
    <div
      v-if="isEditingQueue && !voiceActive"
      class="queue-edit-banner"
    >
      <span>{{ t.queueEditingHint }}</span>
      <button type="button" class="queue-edit-discard" @click="discardQueueEdit">
        {{ t.queueDiscardEdit }}
      </button>
    </div>
    <div
      v-else-if="isEditingPublished && !voiceActive"
      class="queue-edit-banner"
    >
      <span>{{ t.editingPublishedHint }}</span>
      <button type="button" class="queue-edit-discard" @click="discardPublishedEdit">
        {{ t.discardPublishedEdit }}
      </button>
    </div>
    <div
      class="composer-card"
      :class="{ 'is-voice-recording': voiceActive, 'is-editor-expanded': editorExpanded }"
    >
      <button
        type="button"
        class="composer-expand-btn"
        :title="editorExpanded ? t.composerCollapse : t.composerExpand"
        :aria-label="editorExpanded ? t.composerCollapse : t.composerExpand"
        @click.stop="editorExpanded = !editorExpanded"
      >
        <NIcon :component="editorExpanded ? ContractOutline : ExpandOutline" :size="14" />
      </button>

      <!-- Images are separate attachments (sent as model images), not part of the rich text surface -->
      <div v-if="composer.images.length" class="image-attachments">
        <div v-for="img in composer.images" :key="img.id" class="img-chip">
          <NImage
            class="img-preview"
            :src="img.previewUrl"
            object-fit="cover"
            :preview-src="img.previewUrl"
          />
          <button type="button" class="img-x" title="remove" @click.stop="composer.removeImage(img.id)">
            x
          </button>
        </div>
      </div>

      <!-- Path/url/element chips + text share one contenteditable surface. -->
      <div class="rich-editor" @paste="onPaste" @click="focusDraft">
        <ComposerRichEditor
          ref="richEditor"
          :disabled="voiceActive || voicePending"
          :expanded="editorExpanded"
          @keydown="onKeydown"
          @click="onDraftCaretClick"
          @keyup="onDraftKeyup"
        />
      </div>

      <div v-if="voiceActive" class="voice-row">
        <VoiceRecordBar
          :level="voiceLevel"
          @cancel="cancelVoice"
          @confirm="confirmVoice"
        />
      </div>

      <div class="toolbar">
        <div class="toolbar-left">
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            multiple
            hidden
            @change="(e) => {
              const input = e.target as HTMLInputElement;
              if (input.files) void addFiles(input.files);
              input.value = '';
            }"
          />
          <NDropdown
            trigger="click"
            :options="attachMenu"
            :disabled="voiceActive || voicePending"
            @select="onAttachSelect"
          >
            <NButton
              quaternary
              circle
              size="tiny"
              :title="t.composerAttach"
              :disabled="voiceActive || voicePending"
            >
              <template #icon>
                <NIcon :component="AddOutline" />
              </template>
            </NButton>
          </NDropdown>

          <NSelect
            v-model:value="composer.mode"
            class="mode-select"
            :options="modeSelectOptions"
            size="tiny"
            :consistent-menu-width="false"
            :disabled="voiceActive || voicePending"
            :title="t.composerModeHint"
          />

          <NSelect
            v-model:value="selectedModelKey"
            class="model-select"
            :options="availableModels"
            size="tiny"
            :consistent-menu-width="false"
            filterable
            :placeholder="t.modelPlaceholder"
            :disabled="voiceActive || voicePending"
            @update:value="onModelChange"
          />
        </div>

        <div class="toolbar-right">
          <button
            v-if="asr.micVisible && !voiceActive && !voicePending"
            type="button"
            class="mic-btn"
            :disabled="asr.installing"
            :aria-label="micTitle"
            :title="micTitle"
            @click="onMicClick"
          >
            <NIcon :component="MicOutline" :size="18" />
          </button>
          <NButton
            v-if="showPrimaryAction || voicePending"
            size="tiny"
            circle
            :type="primaryIsStop ? 'error' : 'primary'"
            :loading="voicePending"
            :disabled="
              voicePending
                || (!primaryIsStop && !hasSendContent && !(isEditingQueue && hasSendContent))
            "
            :aria-label="
              voicePending
                ? t.voiceTranscribing
                : primaryIsStop
                  ? t.stop
                  : isEditingQueue
                    ? t.queueSave
                    : editorExpanded
                      ? t.shiftEnterToSend
                      : t.enterToSend
            "
            :title="!primaryIsStop && isEditingQueue ? t.queueSave : undefined"
            @click="onPrimaryAction"
          >
            <template #icon>
              <NIcon :component="primaryIsStop ? StopOutline : SendOutline" />
            </template>
          </NButton>
        </div>
      </div>
    </div>

    <div class="composer-meta">
      <NDropdown
        trigger="click"
        :options="thinkingMenu"
        :disabled="voiceActive || voicePending"
        @select="onThinkingChange"
      >
        <NButton
          quaternary
          size="tiny"
          class="think-btn"
          :disabled="voiceActive || voicePending"
          :title="t.thinkingLevel"
        >
          <template #icon>
            <NIcon :component="FlashOutline" :size="14" />
          </template>
          <span class="think-label">{{ thinkingLabel }}</span>
        </NButton>
      </NDropdown>

      <NPopover
        trigger="manual"
        :show="ctxPopoverShow"
        placement="top-end"
        @clickoutside="closeContextPopover"
      >
        <template #trigger>
          <NTooltip :disabled="ctxPopoverShow" placement="top-end">
            <template #trigger>
              <button
                type="button"
                class="ctx-meter"
                :class="`ctx-${contextTone}`"
                :disabled="!sessionId"
                @click="openContextPopover"
              >
                <svg class="ctx-ring" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <circle class="ctx-ring-track" cx="9" cy="9" r="7" fill="none" stroke-width="2" />
                  <circle
                    class="ctx-ring-fill"
                    cx="9"
                    cy="9"
                    r="7"
                    fill="none"
                    stroke-width="2"
                    stroke-linecap="round"
                    transform="rotate(-90 9 9)"
                    :style="contextRingStyle"
                  />
                </svg>
                <span class="ctx-label">{{ contextPercentLabel }}</span>
              </button>
            </template>
            {{ t.contextUsageHint }}
          </NTooltip>
        </template>
        <div class="ctx-popover">
          <div class="ctx-pop-title">{{ t.contextUsageTitle }}</div>
          <div class="ctx-pop-row">
            <span>{{ t.contextUsageTokens }}</span>
            <strong>{{ contextTokensLabel }}</strong>
          </div>
          <div class="ctx-pop-row">
            <span>{{ t.contextUsageWindow }}</span>
            <strong>{{ contextWindowLabel }}</strong>
          </div>
          <div class="ctx-pop-row">
            <span>%</span>
            <strong>{{ contextPercentLabel }}</strong>
          </div>
          <div class="ctx-pop-row">
            <span>{{ t.contextUsageMessages }}</span>
            <strong>{{ contextMessageCount }}</strong>
          </div>
          <div class="ctx-pop-row">
            <span>{{ t.contextUsageTools }}</span>
            <strong>{{ contextToolCount }}</strong>
          </div>
          <div class="ctx-pop-row">
            <span>{{ t.contextUsageSkills }}</span>
            <strong>{{ skillsCount ?? "—" }}</strong>
          </div>
          <div class="ctx-pop-hint">{{ t.contextUsageHint }}</div>
        </div>
      </NPopover>
    </div>

    <NModal
      :show="asr.installing"
      preset="card"
      :title="t.asrInstalling"
      :bordered="false"
      :mask-closable="false"
      :closable="false"
      style="width: min(420px, 92vw)"
    >
      <div class="asr-install-device">
        {{ t.asrDevice }}: {{ asr.status.gpuDeviceLabel }} ({{ asr.status.gpuBackend.toUpperCase() }} /
        {{
          asr.status.gpuKind === "cpu"
            ? t.asrDeviceCpu
            : asr.status.gpuKind === "metal"
              ? t.asrDeviceMetal
              : asr.status.gpuKind === "discrete"
                ? t.asrDeviceDiscrete
                : t.asrDeviceIntegrated
        }})
      </div>
      <NText
        :depth="asr.status.gpuKind === 'cpu' ? 1 : 3"
        style="font-size: 12px; display: block; margin: 6px 0 10px"
        :type="asr.status.gpuKind === 'cpu' ? 'warning' : 'default'"
      >
        {{ asr.status.gpuKind === "cpu" ? t.asrCpuSlowHint : t.asrGpuFastHint }}
      </NText>
      <AsrInstallProgress />
    </NModal>
  </div>
</template>

<style scoped>
.asr-install-device {
  font-size: 13px;
  color: var(--fg-strong);
  margin-bottom: 2px;
}

.composer-wrap {
  flex-shrink: 0;
  padding: 0 var(--chat-pad-x, 10px) 8px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  min-width: 0;
}

.queue-edit-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.3;
  color: var(--fg-muted, #666);
  background: color-mix(in srgb, var(--primary, #3b82f6) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--primary, #3b82f6) 22%, transparent);
}

.queue-edit-discard {
  flex-shrink: 0;
  margin: 0;
  padding: 1px 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--primary, #3b82f6);
  font-size: 11px;
  cursor: pointer;
}

.queue-edit-discard:hover {
  text-decoration: underline;
}

.composer-card {
  position: relative;
  width: 100%;
  max-width: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 14px);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
  padding: 6px 8px 6px;
  min-width: 0;
  box-sizing: border-box;
  transition:
    border-color var(--duration-fast, 140ms) var(--ease-out, ease),
    box-shadow var(--duration, 180ms) var(--ease-out, ease);
}

.composer-expand-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted, #888);
  cursor: pointer;
  opacity: 0.35;
  pointer-events: auto;
  transition:
    opacity 0.12s ease,
    background 0.12s ease,
    color 0.12s ease;
}

.composer-card:hover .composer-expand-btn,
.composer-card:focus-within .composer-expand-btn,
.composer-card.is-editor-expanded .composer-expand-btn {
  opacity: 1;
}

.composer-expand-btn:hover {
  color: var(--fg-strong, #222);
  background: color-mix(in srgb, var(--fg-muted, #888) 12%, transparent);
}

.composer-card:focus-within {
  border-color: var(--accent-border);
  box-shadow: var(--shadow-md), 0 0 0 3px var(--accent-soft);
}

.rich-editor {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  padding: 6px 28px 6px 8px;
  cursor: text;
  border-radius: 8px;
  background: var(--bg-input, transparent);
}

.voice-row {
  padding: 4px 4px 2px;
}

.voice-row :deep(.voice-bar) {
  width: 100%;
}

.image-attachments {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 6px 0;
  align-items: flex-start;
}

.img-chip {
  position: relative;
  width: 56px;
  height: 56px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-strong, var(--border));
  background: var(--bg-panel);
  flex-shrink: 0;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.img-preview {
  display: block;
  width: 100%;
  height: 100%;
}

.img-preview :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.img-x {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  cursor: pointer;
  line-height: 1;
  font-size: 12px;
  padding: 0;
}

.composer-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 4px 4px 0;
  box-sizing: border-box;
  min-width: 0;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding-top: 2px;
  min-width: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.mic-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--fg-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.mic-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--fg-strong);
}

.mic-btn.recording {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.12);
  animation: mic-pulse 1.2s ease-in-out infinite;
}

.mic-btn.busy,
.mic-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

@keyframes mic-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.35);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(239, 68, 68, 0);
  }
}

.model-select {
  flex: 1 1 auto;
  min-width: 56px;
  max-width: 140px;
}

.mode-select {
  flex: 0 0 auto;
  width: 56px;
  min-width: 56px;
  max-width: 56px;
}

.model-select :deep(.n-base-selection) {
  --n-padding-single: 0 16px 0 4px;
  font-size: 11px;
}

.mode-select :deep(.n-base-selection) {
  --n-padding-single: 0 12px 0 3px;
  --n-height: 22px;
  font-size: 11px;
  font-weight: 500;
}

.mode-select :deep(.n-base-suffix) {
  width: 12px;
}

.mode-select :deep(.n-base-selection-label) {
  padding: 0 !important;
}

.think-btn {
  flex-shrink: 0;
  max-width: 72px;
  padding: 0 4px !important;
}

.think-label {
  display: inline-block;
  max-width: 40px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  margin-left: 1px;
}

.ctx-meter {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 6px;
  border: 1px solid var(--border, #e5e5e5);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
  color: #5c5c5c;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.ctx-meter:disabled {
  opacity: 0.45;
  cursor: default;
}

.ctx-meter:not(:disabled):hover {
  background: rgba(0, 0, 0, 0.04);
}

.ctx-ring {
  flex-shrink: 0;
  display: block;
}

.ctx-ring-track {
  stroke: rgba(0, 0, 0, 0.12);
}

.ctx-ring-fill {
  stroke: #5c5c5c;
  transition: stroke-dashoffset 0.2s ease;
}

.ctx-ok .ctx-ring-fill {
  stroke: #5c5c5c;
}

.ctx-warn {
  color: #b45309;
  border-color: rgba(180, 83, 9, 0.35);
}

.ctx-warn .ctx-ring-fill {
  stroke: #d97706;
}

.ctx-danger {
  color: #b91c1c;
  border-color: rgba(185, 28, 28, 0.35);
}

.ctx-danger .ctx-ring-fill {
  stroke: #dc2626;
}

.ctx-muted .ctx-label {
  color: #8a8a8a;
}

.ctx-label {
  line-height: 1;
  white-space: nowrap;
}

.ctx-popover {
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px 0;
  font-size: 12px;
}

.ctx-pop-title {
  font-weight: 600;
  font-size: 12.5px;
  color: var(--fg-strong);
  margin-bottom: 2px;
}

.ctx-pop-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: var(--fg-muted);
}

.ctx-pop-row strong {
  font-weight: 600;
  color: var(--fg-strong);
  font-variant-numeric: tabular-nums;
}

.ctx-pop-hint {
  margin-top: 4px;
  font-size: 11px;
  color: var(--fg-faint);
  line-height: 1.35;
}

@media (max-width: 900px) {
  .mode-select {
    width: 52px;
    min-width: 52px;
    max-width: 52px;
  }

  .model-select {
    max-width: 100px;
  }

  .think-label {
    display: none;
  }
}
</style>
