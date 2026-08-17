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
  useMessage,
} from "naive-ui";
import type { DropdownOption } from "naive-ui";
import {
  AddOutline,
  CheckmarkOutline,
  ChevronDownOutline,
  ContractOutline,
  DocumentOutline,
  ExpandOutline,
  FlashOutline,
  MicOutline,
  SendOutline,
  StopOutline,
} from "@vicons/ionicons5";
import ComposerRichEditor from "@renderer/components/ComposerRichEditor.vue";
import ComposerSlashMenu from "@renderer/components/ComposerSlashMenu.vue";
import ComposerAtFileMenu from "@renderer/components/ComposerAtFileMenu.vue";
import AsrInstallProgress from "@renderer/components/AsrInstallProgress.vue";
import AsrInstallConfirmModal from "@renderer/components/AsrInstallConfirmModal.vue";
import VoiceRecordBar, { type VoiceMeter } from "@renderer/components/VoiceRecordBar.vue";
import SendQueueBar from "@renderer/components/SendQueueBar.vue";
import { useChatStore } from "@renderer/stores/chat";
import type { ContextUsageSegmentId } from "../../../shared/protocol";
import { isHttpUrl, useComposerStore } from "@renderer/stores/composer";
import { useSendQueueStore } from "@renderer/stores/send-queue";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { formatAsrInstallError, formatAsrRuntimeError, isAsrInstallCancelled, useAsrStore } from "@renderer/stores/asr";
import { useMediaStore } from "@renderer/stores/media";
import { plainTextFromClipboard } from "@renderer/utils/composer-rich";
import { heuristicSessionTitle } from "@renderer/utils/session-title";
import {
  prewarmVoiceCapture,
  startVoiceRecord,
  type VoiceRecordSession,
} from "@renderer/utils/pcm-capture";
import { yieldToPaint } from "@renderer/utils/low-power";
import {
  ASR_VOICE_WAKE_EVENT,
  stopWakeListen,
  stopPreloadStream,
  suspendWakeListen,
} from "@renderer/utils/asr-wake-listen";
import { scrubAsrHallucination, type AsrStreamEvent } from "../../../shared/asr";
import { formatAcceleratorLabel } from "../../../shared/hotkey";
import {
  composerModePreamble,
  isComposerAgentMode,
  type ComposerAgentMode,
} from "../../../shared/composer-modes";
import {
  filterSlashItems,
  isSlashBuiltinId,
  parseSlashContext,
  replaceSlashLine,
  skillSlashCommand,
  type SlashItem,
} from "../../../shared/slash-commands";
import {
  parseAtFileContext,
  replaceAtFileMention,
  type AtFileItem,
} from "../../../shared/at-file-mention";
import { formatLlmError } from "@renderer/utils/llm-error";
import {
  decodeWorkspacePaths,
  looksLikeWorkspaceRelPath,
  PI_WORKSPACE_PATHS_MIME,
} from "@renderer/utils/workspace-path-dnd";
import { locale, t } from "@renderer/i18n";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const chat = useChatStore();
const composer = useComposerStore();
const sendQueue = useSendQueueStore();
const sessions = useSessionsStore();
const workspace = useWorkspaceStore();
const rightTabs = useRightTabsStore();
const asr = useAsrStore();
const media = useMediaStore();
const messageApi = useMessage();
let voiceConfirming = false;
/** Bumped to ignore late transcription results after cancel/switch. */
let voiceGen = 0;
let offAsrProgress: (() => void) | undefined;
const voiceActive = ref(false);
/** Non-reactive meter — mutated from AudioWorklet; VoiceRecordBar samples via rAF. */
const voiceMeter: VoiceMeter = { level: 0 };
/** True from confirm until transcription finishes — send button loading. */
const voicePending = ref(false);
let voiceSession: VoiceRecordSession | null = null;
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
  insertTextAtCaret?: (text: string) => void;
  beginVoiceStream?: () => { id: number } | null;
  setVoicePending?: (handle: { id: number }, text: string) => void;
  appendVoiceCommitted?: (handle: { id: number }, text: string) => void;
  commitVoiceStream?: (handle: { id: number }) => void;
  abortVoiceStream?: (handle: { id: number }) => void;
  isCaretAtVoiceLive?: (handle: { id: number }) => boolean;
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
 * During streaming dictation the caret must stay parked at the live
 * insertion point; any move away interrupts the stream.
 */
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

/** Absolute / file:// / workspace-relative path token → workspace-relative for file tags. */
function coercePathToken(raw: string): string | null {
  const fromUrl = fileUrlToPath(raw);
  if (fromUrl != null && fromUrl !== "") return fromUrl;
  if (fromUrl === "") return null; // dropped onto workspace root itself
  if (looksLikeWorkspaceRelPath(raw)) {
    // Strip quotes wrapping pasted paths that contain spaces.
    return raw
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\\/g, "/")
      .replace(/^\.\//, "");
  }
  return null;
}

const fileDragOver = ref(false);

function transferHasFilePayload(data: DataTransfer): boolean {
  const types = Array.from(data.types);
  return (
    types.includes(PI_WORKSPACE_PATHS_MIME) ||
    types.includes("Files") ||
    types.includes("text/uri-list") ||
    types.includes("text/plain")
  );
}

function onComposerDragOver(event: DragEvent): void {
  const data = event.dataTransfer;
  if (!data || !transferHasFilePayload(data)) return;
  event.preventDefault();
  data.dropEffect = "copy";
  fileDragOver.value = true;
}

function onComposerDragLeave(event: DragEvent): void {
  const next = event.relatedTarget as Node | null;
  const card = event.currentTarget as HTMLElement | null;
  if (card && next && card.contains(next)) return;
  fileDragOver.value = false;
}

function onComposerDrop(event: DragEvent): void {
  fileDragOver.value = false;
  const data = event.dataTransfer;
  if (!data) return;
  if (ingestTransferData(data)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

/**
 * Shared paste/drop ingest. Returns true when the event should be consumed
 * (paths/urls/images handled as tags/attachments instead of plain text).
 */
function ingestTransferData(data: DataTransfer): boolean {
  const custom = data.getData(PI_WORKSPACE_PATHS_MIME)?.trim() ?? "";
  if (custom) {
    const paths = decodeWorkspacePaths(custom);
    if (paths.length) {
      for (const filePath of paths) composer.addFileTag(filePath);
      return true;
    }
  }

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
      if (item.kind !== "file") continue;
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

  if (imageFiles.length || pathFiles.length) {
    if (imageFiles.length) void addFiles(imageFiles);
    for (const file of pathFiles) {
      const filePath = electronFilePath(file);
      if (filePath) composer.addFileTag(filePath);
    }
    return true;
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
      const filePath = coercePathToken(trimmed);
      if (filePath) paths.push(filePath);
    }
    if (paths.length || hasHttp) {
      for (const filePath of paths) composer.addFileTag(filePath);
      return true;
    }
  }

  const text = data.getData("text/plain")?.trim() ?? "";
  if (text && isHttpUrl(text)) {
    composer.addUrlTag(text);
    return true;
  }

  if (text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const asPaths = lines.map(coercePathToken).filter((p): p is string => Boolean(p));
    if (asPaths.length && asPaths.length === lines.length) {
      for (const filePath of asPaths) composer.addFileTag(filePath);
      return true;
    }
  }

  return false;
}

async function addFiles(files: FileList | File[]): Promise<void> {
  const list = Array.from(files);
  for (const file of list) {
    if (file.type.startsWith("image/")) {
      try {
        const img = await readImageFile(file);
        if (img) {
          // Persist into the session cache so the message references a real file.
          await composer.addPastedImage(`data:${img.mimeType};base64,${img.data}`);
          if (img.previewUrl.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl);
        }
      } catch (err) {
        console.warn("[composer] failed to read pasted image", err);
      }
      continue;
    }
    const filePath = electronFilePath(file);
    if (filePath) composer.addFileTag(filePath);
  }
}

/** Heuristic: does this http(s) URL look like it points at an image file? */
function looksLikeImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return /\.(png|jpe?g|gif|webp|bmp|avif|svg|ico)([?#]|$)/i.test(u.pathname);
  } catch {
    return false;
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
  imagesToSend: { type: "image"; data: string; mimeType: string; cachePath?: string }[];
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
  let text = [composerModePreamble(mode), body].filter(Boolean).join("\n\n");
  // Bind cached image paths to the prompt (hidden in the editor): text-only
  // models can locate the files, vision models still get the base64 content.
  const imagePaths = Array.from(new Set(composer.images.map((i) => i.cachePath).filter((p): p is string => Boolean(p))));
  if (imagePaths.length) {
    text = `${text}\n\n[attached images]\n${imagePaths.map((p) => `- ${p}`).join("\n")}`;
  }
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
      ...(i.cachePath ? { cachePath: i.cachePath } : {}),
    }));
  const citationsToSend = citationList
    ? citationList.map((c) => ({
        url: c.url,
        selector: c.selector,
        text: c.text,
        htmlSnippet: c.htmlSnippet,
      }))
    : undefined;
  // Mode is injected into agentText via preamble — do not show a mode chip on the bubble.
  const tagsToSend = attachmentTags.map((row) => {
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
  });
  return {
    text,
    displayText,
    imagesToSend,
    citationsToSend,
    tagsToSend: tagsToSend.length ? tagsToSend : undefined,
  };
}

const attachMenu: DropdownOption[] = [
  {
    label: t.composerAttachFile,
    key: "file",
    icon: () => h(NIcon, null, { default: () => h(DocumentOutline) }),
  },
];

type ModeMenuItem = {
  value: ComposerAgentMode;
  label: string;
  tag: string;
  hint: string;
};

const modeMenuItems: ModeMenuItem[] = [
  {
    value: "agent",
    label: t.composerModeAgent,
    tag: t.composerModeAgentTag,
    hint: t.composerModeAgentHint,
  },
  {
    value: "ask",
    label: t.composerModeAsk,
    tag: t.composerModeAskTag,
    hint: t.composerModeAskHint,
  },
  {
    value: "plan",
    label: t.composerModePlan,
    tag: t.composerModePlanTag,
    hint: t.composerModePlanHint,
  },
  {
    value: "task",
    label: t.composerModeTask,
    tag: t.composerModeTaskTag,
    hint: t.composerModeTaskHint,
  },
];

const modeBubbleShow = ref(false);

const activeModeLabel = computed(() => modeTagLabel(composer.mode));

function onModePick(mode: ComposerAgentMode): void {
  composer.mode = mode;
  modeBubbleShow.value = false;
}

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

  // Editing a queued item intentionally replaces the composer content with
  // that item — do NOT enqueue any unrelated draft here (that duplicated the
  // item and caused double-sends). If an unrelated draft exists, drop it.

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
  // Cold session: spawn worker on first real dispatch (not on create/open).
  await applySelectedModel({ allowStart: true });
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

/** Embed URL citations as text so they survive the steer message (text-only queue). */
function steerTextWithCitations(item: {
  agentText?: string;
  text: string;
  citations?: { url?: string; text?: string }[];
}): string {
  const base = item.agentText || item.text || " ";
  const cites = (item.citations ?? []).filter((c) => c && c.url);
  if (!cites.length) return base;
  const lines = cites.map((c) => `- ${c.url}${c.text ? ` (${c.text.slice(0, 160)})` : ""}`);
  return [base, "", "References:", ...lines].join("\n");
}
async function sendQueuedNow(itemId: string): Promise<void> {
  const id = sessionId.value;
  if (!id) return;
  const item = sendQueue.remove(id, itemId);
  if (!item) return;
  if (voiceActive.value) cancelVoice();
  sendQueue.setSuppressDrain(id, true);
  try {
    if (isAgentBusy(id)) {
      // Codex-style steer: queue the message as guidance for the running turn
      // WITHOUT aborting it. The model processes it after the current output.
      await applySelectedModel({ allowStart: true });
      await chat.steer(id, steerTextWithCitations(item), item.images);
    } else {
      await dispatchQueuedItem(id, item);
    }
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

  // While agent is running, new sends go to the queue
  if (running.value && mode === "prompt") {
    enqueueFromComposer();
    return;
  }

  // Bare builtin slash (e.g. `/compact`) — run locally, do not prompt the model.
  if (mode === "prompt" && (await tryConsumeBuiltinSlashDraft())) return;

  const snap = snapshotComposerPayload();
  if (!snap) return;

  // Re-editing a published user bubble: commit replaces that message and
  // everything after it (see chat.sendPromptSerial + agent rollback_user).
  // `pendingUserEdit` is cleared once the send lands (in chat.sendPrompt).

  const displayText = snap.displayText;
  const agentText = snap.text || " ";
  const titleSeed = displayText || snap.tagsToSend?.[0]?.content || snap.tagsToSend?.[0]?.label || "";
  composer.clear();
  // First message (or any send) activates the Pi agent worker and applies model.
  if (mode === "prompt" || mode === "steer" || mode === "follow_up") {
    await applySelectedModel({ allowStart: true });
    const level = thinkingLevel.value;
    try {
      await sessions.sendCommand(id, { type: "set_thinking_level", level });
      rememberThinking(id, level);
    } catch {
      // ignore — prompt may still proceed with worker default
    }
  }
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
  if (slashMenuOpen.value) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      slashMenuRef.value?.move(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      slashMenuRef.value?.move(-1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      const ctx = slashContext.value;
      if (ctx) composer.draft = composer.draft.slice(0, ctx.slashIndex);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      slashMenuRef.value?.confirm();
      return;
    }
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      slashMenuRef.value?.confirm();
      return;
    }
  }

  if (atFileMenuOpen.value) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      atFileMenuRef.value?.move(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      atFileMenuRef.value?.move(-1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      const ctx = atFileContext.value;
      if (ctx) composer.draft = replaceAtFileMention(composer.draft, ctx);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      atFileMenuRef.value?.confirm();
      return;
    }
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      atFileMenuRef.value?.confirm();
      return;
    }
  }

  if (event.key !== "Enter" || event.isComposing) return;

  // DeepSeek-style: Enter sends; Shift+Enter inserts a newline (both modes).
  if (event.shiftKey) return;

  event.preventDefault();
  if (sendQueue.editingId) {
    saveEditingToQueue();
    return;
  }
  if (running.value) {
    enqueueFromComposer();
    return;
  }
  // Empty composer + queued sends: Enter flushes the first queued item
  // (Cursor-like — the queue bar shows what will go next).
  if (!hasSendContent.value && sendQueue.activeItems.length > 0) {
    void drainQueueIfIdle(sessionId.value!);
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

const SEGMENT_META: Record<
  ContextUsageSegmentId,
  { color: string; label: () => string }
> = {
  system: { color: "#8b8b8b", label: () => t.contextUsageSegSystem },
  tools: { color: "#a855f7", label: () => t.contextUsageSegTools },
  summarized: { color: "#b91c1c", label: () => t.contextUsageSegSummarized },
  conversation: { color: "#ef4444", label: () => t.contextUsageSegConversation },
  toolResults: { color: "#db2777", label: () => t.contextUsageSegToolResults },
};

const contextUsage = computed(() => sessions.activeContextUsage);
const ctxPopoverShow = ref(false);
const skillsCount = ref<number | null>(null);
let skillsCountCachedFor: string | null = null;

const slashMenuRef = ref<{ move: (d: number) => void; confirm: () => boolean } | null>(null);
const atFileMenuRef = ref<{ move: (d: number) => void; confirm: () => boolean } | null>(null);
const modelSelectRef = ref<{ focus?: () => void } | null>(null);
const slashSkills = ref<{ name: string; description: string }[]>([]);
let slashSkillsCachedFor: string | null = null;
let slashSkillsLoading = false;
const atFileItems = ref<AtFileItem[]>([]);
const atFileLoading = ref(false);
let atFileSearchGen = 0;

const slashBuiltins = computed<SlashItem[]>(() => [
  {
    id: "new",
    kind: "builtin",
    command: "new",
    title: "/new",
    description: t.slashNewDesc,
  },
  {
    id: "compact",
    kind: "builtin",
    command: "compact",
    title: "/compact",
    description: t.slashCompactDesc,
  },
  {
    id: "model",
    kind: "builtin",
    command: "model",
    title: "/model",
    description: t.slashModelDesc,
  },
]);

const slashSkillItems = computed<SlashItem[]>(() =>
  slashSkills.value.map((s) => ({
    id: `skill:${s.name}`,
    kind: "skill" as const,
    command: skillSlashCommand(s.name),
    title: `/${skillSlashCommand(s.name)}`,
    description: s.description || t.slashSkillFallbackDesc,
  })),
);

const slashContext = computed(() => parseSlashContext(composer.draft));

const slashItems = computed(() => {
  const ctx = slashContext.value;
  if (!ctx) return [] as SlashItem[];
  return filterSlashItems([...slashBuiltins.value, ...slashSkillItems.value], ctx.query);
});

const slashMenuOpen = computed(
  () => Boolean(slashContext.value) && slashItems.value.length > 0 && !voiceActive.value,
);

const atFileContext = computed(() => {
  // Slash command on the last line takes priority over @ mentions.
  if (slashContext.value) return null;
  return parseAtFileContext(composer.draft);
});

const atFileMenuOpen = computed(
  () => Boolean(atFileContext.value) && !voiceActive.value,
);

const atFileEmptyHint = computed(() => {
  if (!workspace.root) return t.atFileNeedWorkspace;
  if (atFileLoading.value) return t.atFileSearching;
  return t.atFileEmpty;
});

/** Recently opened preview tabs (workspace-relative) for the empty-@ list. */
function recentPreviewAtFiles(): AtFileItem[] {
  const out: AtFileItem[] = [];
  const seen = new Set<string>();
  for (const tab of rightTabs.tabs) {
    if (tab.kind !== "preview" || !tab.filePath) continue;
    const rel = tab.filePath.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!rel || seen.has(rel)) continue;
    // Skip obvious absolute paths that aren't workspace-relative.
    if (/^[a-zA-Z]:/.test(rel) || rel.startsWith("/")) continue;
    seen.add(rel);
    out.push({
      name: rel.split("/").pop() || rel,
      path: rel,
      kind: "file",
    });
  }
  return out;
}

async function refreshAtFileItems(query: string): Promise<void> {
  const gen = ++atFileSearchGen;
  if (!workspace.root) {
    atFileItems.value = [];
    return;
  }
  atFileLoading.value = true;
  try {
    const q = query.trim();
    if (!q) {
      const recent = recentPreviewAtFiles();
      const rootEntries = await window.api.files.list();
      if (gen !== atFileSearchGen) return;
      const seen = new Set(recent.map((r) => r.path));
      const merged: AtFileItem[] = [...recent];
      for (const e of rootEntries) {
        if (seen.has(e.path)) continue;
        merged.push({ name: e.name, path: e.path, kind: e.kind });
      }
      atFileItems.value = merged;
      return;
    }
    const entries = await window.api.files.search(q, 80);
    if (gen !== atFileSearchGen) return;
    // Boost recently opened files that still match the query to the top.
    const recent = recentPreviewAtFiles();
    const recentHit = new Set(
      recent.filter((r) => entries.some((e) => e.path === r.path)).map((r) => r.path),
    );
    const mapped = entries.map((e) => ({
      name: e.name,
      path: e.path,
      kind: e.kind,
    }));
    atFileItems.value = [
      ...mapped.filter((e) => recentHit.has(e.path)),
      ...mapped.filter((e) => !recentHit.has(e.path)),
    ];
  } catch {
    if (gen !== atFileSearchGen) return;
    atFileItems.value = [];
  } finally {
    if (gen === atFileSearchGen) atFileLoading.value = false;
  }
}

let atFileRefreshTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  atFileContext,
  (ctx) => {
    if (atFileRefreshTimer) {
      clearTimeout(atFileRefreshTimer);
      atFileRefreshTimer = null;
    }
    if (!ctx) {
      atFileItems.value = [];
      return;
    }
    // Bare `@` loads immediately; typed queries debounce slightly.
    const delay = ctx.query.trim() ? 80 : 0;
    atFileRefreshTimer = setTimeout(() => {
      atFileRefreshTimer = null;
      void refreshAtFileItems(ctx.query);
    }, delay);
  },
  { immediate: true },
);

async function onAtFileSelect(item: AtFileItem): Promise<void> {
  const ctx = atFileContext.value;
  if (!ctx) return;
  const nextDraft = replaceAtFileMention(composer.draft, ctx);
  composer.addFileTag(item.path);
  // Chip sync may re-read DOM still containing `@query`; strip after that flush.
  await nextTick();
  composer.draft = nextDraft;
  await nextTick();
  focusDraft();
}

async function ensureSlashSkills(): Promise<void> {
  const root = workspace.root ?? "";
  if (slashSkillsCachedFor === root || slashSkillsLoading) return;
  slashSkillsLoading = true;
  try {
    const data = await window.api.skills.list(workspace.root ?? undefined);
    slashSkills.value = (data.skills ?? []).map((s) => ({
      name: s.name,
      description: s.description ?? "",
    }));
    slashSkillsCachedFor = root;
  } catch {
    slashSkills.value = [];
  } finally {
    slashSkillsLoading = false;
  }
}

watch(slashContext, (ctx) => {
  if (ctx) void ensureSlashSkills();
});

async function runSlashBuiltin(id: string): Promise<void> {
  if (!isSlashBuiltinId(id)) return;
  switch (id) {
    case "new": {
      const root = workspace.root;
      if (!root) {
        message.warning(t.slashNeedWorkspace);
        return;
      }
      const created = await sessions.createSession(root);
      if (created) message.success(t.slashNewDone);
      return;
    }
    case "compact": {
      const idSession = sessionId.value;
      if (!idSession) {
        message.warning(t.slashNeedSession);
        return;
      }
      await sessions.sendCommand(idSession, { type: "compact" });
      message.success(t.compactDone);
      return;
    }
    case "model": {
      await nextTick();
      modelSelectRef.value?.focus?.();
      return;
    }
    default: {
      const _never: never = id;
      void _never;
    }
  }
}

async function onSlashSelect(item: SlashItem): Promise<void> {
  const ctx = slashContext.value;
  if (!ctx) return;
  if (item.kind === "builtin") {
    composer.clear();
    await runSlashBuiltin(item.id);
    return;
  }
  // Skills: leave `/skill:name` so AgentSession expands on send; trailing space for optional args.
  composer.draft = replaceSlashLine(composer.draft, ctx, item.command, true);
  await nextTick();
  focusDraft();
}

/** If the whole draft is a bare builtin slash, run it instead of prompting. */
async function tryConsumeBuiltinSlashDraft(): Promise<boolean> {
  const raw = composer.draft.trim();
  if (!raw.startsWith("/") || raw.includes("\n")) return false;
  const body = raw.slice(1).trim();
  if (!isSlashBuiltinId(body)) return false;
  composer.clear();
  await runSlashBuiltin(body);
  return true;
}

/**
 * Cost-health reference: the UI treats this many context tokens as "full".
 * Real model windows are huge (deepseek = 1M), so a window-based % always
 * looks healthy while the bill grows. Show pressure against this budget
 * instead (matches ~30k tokens of a 1M window as the compaction sweet spot).
 */
const CONTEXT_COST_REFERENCE = 300_000;

const contextPercent = computed(() => {
  const tokens = contextUsage.value?.tokens;
  if (tokens == null || !Number.isFinite(tokens) || tokens <= 0) return null;
  return Math.max(0, Math.min(100, (tokens / CONTEXT_COST_REFERENCE) * 100));
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

const contextMessageCount = computed(() => {
  const fromStats = contextUsage.value?.messageCount;
  if (typeof fromStats === "number") return fromStats;
  return chat.activeMessages.length;
});
const contextToolCount = computed(() => {
  const fromStats = contextUsage.value?.toolCalls;
  if (typeof fromStats === "number") return fromStats;
  const messages = chat.activeMessages.filter((m) => m.role === "tool").length;
  const streaming = chat.activeStreaming?.role === "tool" ? 1 : 0;
  return messages + streaming;
});

const contextTokensLabel = computed(() => {
  const usage = contextUsage.value;
  if (!usage) return "—";
  if (usage.tokens !== null) return formatTokens(usage.tokens);
  return "?";
});

/**
 * Rough per-turn input cost estimate ($). Uses the DeepSeek-style rate as a
 * sensible default; the point is to surface cost growth, not exact billing.
 */
const CONTEXT_INPUT_COST_PER_M = 0.14;
const contextCostLabel = computed(() => {
  const tokens = contextUsage.value?.tokens;
  if (tokens == null || !Number.isFinite(tokens) || tokens <= 0) return "";
  const cost = (tokens / 1_000_000) * CONTEXT_INPUT_COST_PER_M;
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
});

/** True when the context is past the cost-health reference (needs compaction). */
const contextNeedsCompact = computed(() => {
  const pct = contextPercent.value;
  return pct != null && pct >= 90;
});

const contextWindowLabel = computed(() => {
  const usage = contextUsage.value;
  if (!usage) return "—";
  return formatTokens(usage.contextWindow);
});

const contextSegments = computed(() => {
  const usage = contextUsage.value;
  const window = usage?.contextWindow ?? 0;
  const segs = usage?.segments ?? [];
  if (!window || !segs.length) return [];
  return segs.map((s) => {
    const meta = SEGMENT_META[s.id];
    return {
      id: s.id,
      tokens: s.tokens,
      label: meta?.label() ?? s.id,
      color: meta?.color ?? "#888",
      widthPct: Math.max(0.4, (s.tokens / window) * 100),
      tokensLabel: formatTokens(s.tokens),
    };
  });
});

const contextFreePct = computed(() => {
  const usage = contextUsage.value;
  if (!usage?.contextWindow) return 100;
  const used =
    typeof usage.tokens === "number"
      ? usage.tokens
      : (usage.segments ?? []).reduce((n, s) => n + s.tokens, 0);
  return Math.max(0, 100 - (used / usage.contextWindow) * 100);
});

const contextFullLabel = computed(() => {
  const pct = contextPercent.value;
  if (pct == null) return t.contextUsageUnknown;
  return t.contextUsageFull(pct.toFixed(0));
});

const contextTokensPairLabel = computed(() => {
  const usage = contextUsage.value;
  if (!usage) return t.contextUsageEmpty;
  const used = usage.tokens !== null ? formatTokens(usage.tokens) : "?";
  return t.contextUsageTokensPair(used, formatTokens(usage.contextWindow));
});

const compactBusy = ref(false);

async function onCompactContext(): Promise<void> {
  const idSession = sessionId.value;
  if (!idSession || compactBusy.value) return;
  compactBusy.value = true;
  try {
    await sessions.sendCommand(idSession, { type: "compact" });
    message.success(t.compactDone);
    closeContextPopover();
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    compactBusy.value = false;
  }
}

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

  // New session with no saved prefs: inherit model + thinking level from the
  // workspace's first session (sidebar top) so new chats match the user's setup.
  if (!remembered && !rememberedThinking) {
    const first = sessions.sessions[0];
    if (first && first.id !== id) {
      const firstModel = modelBySession.value[first.id];
      const firstThinking = thinkingBySession.value[first.id];
      if (firstModel && flat.some((o) => o.value === firstModel)) {
        selectedModelKey.value = firstModel;
      }
      if (firstThinking) thinkingLevel.value = firstThinking;
    }
  }

  // Prefer live worker state when agent is already running (never cold-start here).
  let workerKey: string | null = null;
  let workerThinking: ThinkingLevel | null = null;
  try {
    const state = await sessions.tryCommand(id, { type: "get_state" });
    if (state !== undefined) {
      workerKey = modelKeyFromState(state);
      workerThinking = thinkingFromState(state);
      sessions.applyContextFromState(id, state);
    }
  } catch {
    // ignore sync failures
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

  // Only push model/thinking to a live worker — first prompt cold-starts the agent.
  if (selectedModelKey.value && workerKey !== null) {
    const token = `${id}::${selectedModelKey.value}`;
    if (workerKey !== selectedModelKey.value || appliedModelForSession.value !== token) {
      appliedModelForSession.value = null;
      await applySelectedModel({ allowStart: false });
    } else {
      appliedModelForSession.value = token;
      rememberModel(id, selectedModelKey.value);
    }
  }

  if (workerThinking !== null && (rememberedThinking || thinkingLevel.value)) {
    const level = thinkingLevel.value;
    if (workerThinking !== level) {
      try {
        await sessions.tryCommand(id, { type: "set_thinking_level", level });
        rememberThinking(id, level);
      } catch {
        // ignore thinking sync failures
      }
    }
  }
}

async function applySelectedModel(opts?: { allowStart?: boolean }): Promise<void> {
  const id = sessionId.value;
  const value = selectedModelKey.value;
  if (!id || !value) return;
  // Session must be registered in the broker (present in live sessions list).
  if (!sessions.sessions.some((s) => s.id === id)) return;
  const slash = value.indexOf("/");
  if (slash <= 0) return;
  const token = `${id}::${value}`;
  if (appliedModelForSession.value === token) return;
  const allowStart = opts?.allowStart === true;
  try {
    const command = {
      type: "set_model" as const,
      provider: value.slice(0, slash),
      modelId: value.slice(slash + 1),
    };
    if (allowStart) {
      await sessions.sendCommand(id, command);
    } else {
      const applied = await sessions.tryCommand(id, command);
      if (applied === undefined) {
        // No live worker yet — keep UI selection; first prompt will apply.
        rememberModel(id, value);
        return;
      }
    }
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
  await applySelectedModel({ allowStart: false });
}

/**
 * Paste into the composer: only complete URLs (and pasted images) become
 * tags/attachments. File paths and any other text stay plain text — the
 * path→tag behavior is reserved for drag & drop (ingestTransferData), not paste.
 * Rich HTML from Word/browsers is always stripped to plain text so styles
 * cannot leak into the contenteditable surface.
 */
/** Extract the first http(s) <img src> from pasted HTML (web images). */
function imgUrlFromHtml(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const img = doc.querySelector("img[src]");
  const src = img?.getAttribute("src")?.trim() ?? "";
  return src && isHttpUrl(src) ? src : null;
}

function onPaste(event: ClipboardEvent): void {
  try {
    const data = event.clipboardData;
    if (!data) return;
    const imageFiles: File[] = [];
    if (data.files?.length) {
      for (const file of Array.from(data.files)) {
        if (file.type.startsWith("image/")) imageFiles.push(file);
      }
    }
    if (!imageFiles.length && data.items) {
      for (const item of Array.from(data.items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file && !imageFiles.some((f) => f.name === file.name && f.size === file.size)) {
            imageFiles.push(file);
          }
        }
      }
    }
    if (imageFiles.length) {
      event.preventDefault();
      void addFiles(imageFiles).catch((err) => {
        console.warn("[composer] paste image failed", err);
      });
      return;
    }

    // Copying an image from a web page often carries an <img> tag in the
    // HTML with no bitmap file — download it into the session cache instead
    // of showing a raw URL tag.
    const html = data.getData("text/html") ?? "";
    const htmlImgUrl = html ? imgUrlFromHtml(html) : null;
    if (htmlImgUrl) {
      event.preventDefault();
      void composer.addImageFromUrl(htmlImgUrl).then((ok) => {
        if (!ok) messageApi.warning(t.pasteImageDownloadFailed);
      });
      return;
    }

    const text = data.getData("text/plain")?.trim() ?? "";
    if (text && isHttpUrl(text) && !/\s/.test(text)) {
      // Image-looking URLs attach as images (bound to the cached file path);
      // a failed download shows a message instead of silently becoming a tag.
      if (looksLikeImageUrl(text)) {
        event.preventDefault();
        void composer.addImageFromUrl(text).then((ok) => {
          if (!ok) messageApi.warning(t.pasteImageDownloadFailed);
        });
        return;
      }
      event.preventDefault();
      composer.addUrlTag(text);
      return;
    }

    // Strip Word/browser formatting: never let contenteditable insert styled HTML.
    const plain = plainTextFromClipboard(data.getData("text/plain") ?? "", html);
    if (!plain.trim() && !html.trim()) return;
    event.preventDefault();
    if (plain.trim()) {
      richEditor.value?.insertTextAtCaret(plain);
    }
  } catch (err) {
    // Never let a paste handler exception swallow the user's clipboard.
    console.warn("[composer] onPaste error", err);
  }
}

async function ensureAsrReady(): Promise<boolean> {
  if (ensureAsrReadyFlight) return ensureAsrReadyFlight;
  ensureAsrReadyFlight = doEnsureAsrReady().finally(() => {
    ensureAsrReadyFlight = null;
  });
  return ensureAsrReadyFlight;
}

let ensureAsrReadyFlight: Promise<boolean> | null = null;

async function doEnsureAsrReady(): Promise<boolean> {
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
  // Cloud backend needs no local model/runtime.
  if (asr.status.backend === "cloud" && asr.status.cloudConfigured) return true;
  if (asr.status.installed) return true;

  // Join an in-flight install (e.g. background warm from mic click) — don't start a second one.
  if (asr.installing) {
    try {
      await asr.install();
      return asr.status.installed;
    } catch (err) {
      if (isAsrInstallCancelled(err)) return false;
      messageApi.error(formatAsrInstallError(err, t.asrDownloadFailed), { duration: 6000 });
      return false;
    }
  }

  const ok = await promptAsrInstallConfirm();
  if (!ok) return false;
  try {
    await asr.install();
    return true;
  } catch (err) {
    if (isAsrInstallCancelled(err)) return false;
    messageApi.error(formatAsrInstallError(err, t.asrDownloadFailed), { duration: 6000 });
    return false;
  }
}

const asrInstallConfirmOpen = ref(false);
let asrInstallConfirmResolve: ((ok: boolean) => void) | null = null;

function promptAsrInstallConfirm(): Promise<boolean> {
  if (asrInstallConfirmResolve) {
    asrInstallConfirmResolve(false);
    asrInstallConfirmResolve = null;
  }
  asrInstallConfirmOpen.value = true;
  return new Promise((resolve) => {
    asrInstallConfirmResolve = resolve;
  });
}

function onAsrInstallConfirm(): void {
  asrInstallConfirmOpen.value = false;
  asrInstallConfirmResolve?.(true);
  asrInstallConfirmResolve = null;
}

function onAsrInstallConfirmCancel(): void {
  asrInstallConfirmOpen.value = false;
  asrInstallConfirmResolve?.(false);
  asrInstallConfirmResolve = null;
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
  voiceMeter.level = 0;
  voicePending.value = false;
  voiceConfirming = false;
  asr.recording = false;
  if (opts?.resumeWake !== false) setDictationWakePaused(false);
}

async function confirmVoice(): Promise<void> {
  if (!voiceSession) {
    if (voiceActive.value && !voiceConfirming) messageApi.info(t.voiceMicOpening);
    return;
  }
  if (voiceConfirming) return;
  voiceConfirming = true;
  const gen = voiceGen;

  // Stop mic + close record UI immediately; send button shows loading until ASR finishes.
  const session = voiceSession;
  voiceSession = null;
  voiceActive.value = false;
  voiceMeter.level = 0;
  asr.recording = false;
  voicePending.value = true;

  try {
    // Let the "transcribing…" UI paint before encode / IPC / main work.
    await nextTick();
    await yieldToPaint();
    if (gen !== voiceGen) return;
    const { pcm, sampleRate } = await session.stop();
    if (gen !== voiceGen) return;
    if (!pcm || pcm.length === 0) {
      messageApi.warning(t.voiceEmpty);
      return;
    }
    const ready = await ensureAsrReady();
    if (gen !== voiceGen) return;
    if (!ready) return;
    const raw = await asr.transcribe(pcm, sampleRate);
    if (gen !== voiceGen) return;
    const text = scrubAsrHallucination(raw);
    if (!text) {
      messageApi.warning(t.voiceEmpty);
      return;
    }
    // Insert directly at the current caret — do NOT move the cursor.
    armAsrCaretGuard();
    if (richEditor.value?.insertTextAtCaret) {
      richEditor.value.insertTextAtCaret(text);
    } else {
      composer.draft = joinAsr(composer.draft, text);
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
  // First use: let the user pick the recognition backend (local vs cloud API).
  if (!(await asr.ensureBackendChosen())) return;

  if (asr.status.supported === false && !asr.status.cloudConfigured) {
    messageApi.warning(t.asrUnsupported);
    return;
  }
  if (asr.status.enabled === false) {
    messageApi.warning(t.asrDisabled);
    return;
  }

  setDictationWakePaused(true);

  // Show the record UI INSTANTLY — never block the click on the mic or
  // the ASR engine. The mic opens in the background; the model loads async.
  voiceActive.value = true;
  asr.recording = true;
  voiceMeter.level = 0;
  void nextTick(() => focusDraftAtEnd());

  // Free wake mic / preload / media in the background — do NOT await on the click path.
  // suspend keeps the ASR child warm so convert stays fast on low-end machines.
  void (async () => {
    await suspendWakeListen();
    await stopPreloadStream();
    media.stopAll();
  })();

  try {
    // Kick mic open without awaiting UI; startVoiceRecord already yields a frame.
    voiceSession = await startVoiceRecord({
      onLevel: (level) => {
        if (!voiceActive.value) return;
        voiceMeter.level = level;
      },
      onMaxDuration: () => {
        void confirmVoice();
      },
    });
    if (!voiceActive.value) {
      voiceSession.abort();
      voiceSession = null;
    }
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

  // Warm / ensure runtime+model in the background so conversion is fast.
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

/** User typed/edited the draft while streaming — they took control, stop. */
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
  // Warm AudioWorklet + mic permission off the click path (idle so boot stays light).
  const ric =
    typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback.bind(window)
      : (cb: () => void) => window.setTimeout(cb, 900);
  ric(() => {
    void prewarmVoiceCapture();
  });
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
      :class="{
        'is-voice-recording': voiceActive,
        'is-editor-expanded': editorExpanded,
        'is-file-drag-over': fileDragOver,
      }"
      @dragover="onComposerDragOver"
      @dragleave="onComposerDragLeave"
      @drop="onComposerDrop"
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
        <ComposerSlashMenu
          ref="slashMenuRef"
          :visible="slashMenuOpen"
          :items="slashItems"
          @select="(item) => void onSlashSelect(item)"
        />
        <ComposerAtFileMenu
          ref="atFileMenuRef"
          :visible="atFileMenuOpen"
          :items="atFileItems"
          :empty-hint="atFileEmptyHint"
          @select="(item) => void onAtFileSelect(item)"
        />
        <ComposerRichEditor
          ref="richEditor"
          :disabled="voicePending"
          :expanded="editorExpanded"
          @keydown="onKeydown"
        />
      </div>

      <!-- Toolbar stays mounted; voice UI overlays this row only. -->
      <div class="composer-footer">
        <div class="toolbar" :aria-hidden="voiceActive">
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

          <NPopover
            v-model:show="modeBubbleShow"
            trigger="click"
            placement="top-start"
            :show-arrow="true"
            :disabled="voiceActive || voicePending"
            raw
          >
            <template #trigger>
              <button
                type="button"
                class="mode-trigger pi-interactive"
                :disabled="voiceActive || voicePending"
                :title="t.composerModeHint"
                :aria-expanded="modeBubbleShow"
                :aria-haspopup="true"
              >
                <span class="mode-trigger-label">{{ activeModeLabel }}</span>
                <NIcon :component="ChevronDownOutline" :size="12" />
              </button>
            </template>
            <div class="mode-bubble" role="listbox" :aria-label="t.composerModeHint">
              <button
                v-for="item in modeMenuItems"
                :key="item.value"
                type="button"
                class="mode-option"
                role="option"
                :aria-selected="composer.mode === item.value"
                :class="{ active: composer.mode === item.value }"
                @click="onModePick(item.value)"
              >
                <div class="mode-option-main">
                  <span class="mode-option-name">
                    {{ item.label }}
                    <span
                      v-if="item.tag && item.tag !== item.label"
                      class="mode-option-tag"
                    >{{ item.tag }}</span>
                  </span>
                  <span class="mode-option-hint">{{ item.hint }}</span>
                </div>
                <NIcon
                  v-if="composer.mode === item.value"
                  class="mode-option-check"
                  :component="CheckmarkOutline"
                  :size="14"
                />
              </button>
            </div>
          </NPopover>

          <NSelect
            ref="modelSelectRef"
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
            @pointerenter="void prewarmVoiceCapture()"
            @mousedown.prevent="onMicClick"
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
                    : t.enterToSendShiftNewline
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

        <div v-if="voiceActive" class="voice-row" role="presentation">
          <NButton
            quaternary
            circle
            size="tiny"
            class="voice-attach"
            :title="t.composerAttach"
            disabled
            tabindex="-1"
          >
            <template #icon>
              <NIcon :component="AddOutline" />
            </template>
          </NButton>
          <VoiceRecordBar
            :meter="voiceMeter"
            :busy="voicePending"
            :show-stop="running"
            @cancel="cancelVoice"
            @confirm="confirmVoice"
            @stop="onAbort"
          />
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
        <div class="ctx-popover">
          <div class="ctx-pop-title">{{ t.contextUsageTitle }}</div>
          <div class="ctx-pop-summary">
            <span class="ctx-pop-full">{{ contextFullLabel }}</span>
            <span class="ctx-pop-pair">{{ contextTokensPairLabel }}</span>
            <span v-if="contextCostLabel" class="ctx-pop-cost">
              {{ contextCostLabel }}
            </span>
          </div>
          <div class="ctx-bar" aria-hidden="true">
            <span
              v-for="seg in contextSegments"
              :key="seg.id"
              class="ctx-bar-seg"
              :style="{ width: `${seg.widthPct}%`, background: seg.color }"
              :title="`${seg.label}: ${seg.tokensLabel}`"
            />
            <span
              v-if="contextFreePct > 0.5"
              class="ctx-bar-seg free"
              :style="{ width: `${contextFreePct}%` }"
            />
          </div>
          <div v-if="contextSegments.length" class="ctx-legend">
            <div v-for="seg in contextSegments" :key="`leg-${seg.id}`" class="ctx-legend-row">
              <span class="ctx-swatch" :style="{ background: seg.color }" />
              <span class="ctx-legend-label">{{ seg.label }}</span>
              <strong>{{ seg.tokensLabel }}</strong>
            </div>
          </div>
          <div v-else class="ctx-pop-hint">{{ t.contextUsageEmpty }}</div>
          <div class="ctx-pop-meta">
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
          </div>
          <div class="ctx-pop-hint">{{ t.contextUsageHint }}</div>
          <NButton
            size="small"
            type="primary"
            secondary
            block
            class="ctx-compact-btn"
            :class="{ 'ctx-compact-urgent': contextNeedsCompact }"
            :disabled="!sessionId || running || compactBusy"
            :loading="compactBusy"
            @click="onCompactContext"
          >
            <span v-if="contextNeedsCompact" class="ctx-compact-dot" />
            {{ t.compactContext }}
          </NButton>
        </div>
      </NPopover>
    </div>

    <AsrInstallConfirmModal
      :show="asrInstallConfirmOpen"
      @confirm="onAsrInstallConfirm"
      @cancel="onAsrInstallConfirmCancel"
    />

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
  width: 100%;
  max-width: var(--composer-max, 780px);
  margin: 0 auto;
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
  background: var(--tool-bg, #f5f6f7);
  box-shadow: none;
  padding: 6px 8px 6px;
  min-width: 0;
  box-sizing: border-box;
  transition:
    border-color var(--duration-fast, 140ms) var(--ease-out, ease),
    box-shadow var(--duration, 180ms) var(--ease-out, ease);
}

.composer-card.is-file-drag-over {
  border-color: color-mix(in srgb, var(--primary, #3b82f6) 55%, var(--border));
  box-shadow:
    var(--shadow-md),
    0 0 0 2px color-mix(in srgb, var(--primary, #3b82f6) 22%, transparent);
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
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.rich-editor {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  padding: 6px 28px 6px 8px;
  cursor: text;
  border-radius: 8px;
  background: transparent;
}

/* Bottom toolbar slot — voice UI overlays this row without resizing the editor. */
.composer-footer {
  position: relative;
  min-width: 0;
}

.composer-footer .toolbar {
  /* Keep layout height while covered so the card does not jump. */
  transition: none;
}

.composer-card.is-voice-recording .composer-footer .toolbar {
  visibility: hidden;
  pointer-events: none;
}

.voice-row {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 3px;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--bg-elevated, #fff);
  border-top: 1px solid color-mix(in srgb, var(--border, #e5e7eb) 55%, transparent);
  border-radius: 0 0 calc(var(--radius-lg, 14px) - 6px) calc(var(--radius-lg, 14px) - 6px);
}

.voice-row .voice-attach {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  min-width: 22px;
  min-height: 22px;
  padding: 0;
  color: #9aa0a6;
  background: rgba(0, 0, 0, 0.05);
}

.voice-row .voice-attach :deep(.n-icon) {
  font-size: 14px;
}

.voice-row .voice-attach:disabled {
  opacity: 1;
  color: #9aa0a6;
}

.voice-row :deep(.voice-bar) {
  flex: 1;
  min-width: 0;
}

:root.dark .voice-row .voice-attach,
.dark .voice-row .voice-attach {
  background: rgba(255, 255, 255, 0.08);
  color: #9aa0a6;
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

.mode-trigger {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  height: 22px;
  max-width: 72px;
  padding: 0 6px 0 8px;
  border: 1px solid color-mix(in srgb, var(--border, #ddd) 85%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-elevated, #fff) 92%, transparent);
  color: var(--fg, #222);
  font-size: 11px;
  font-weight: 550;
  cursor: pointer;
  white-space: nowrap;
}

.mode-trigger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.mode-trigger:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--primary, #3b82f6) 45%, var(--border));
  color: var(--fg-strong, #111);
}

.mode-trigger-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.mode-bubble {
  min-width: 260px;
  max-width: min(360px, 92vw);
  padding: 6px;
  border: 1px solid color-mix(in srgb, var(--border, #ddd) 80%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--bg-panel, var(--bg-elevated, #fff)) 96%, transparent);
  box-shadow: 0 10px 28px color-mix(in srgb, #000 16%, transparent);
  backdrop-filter: blur(10px);
}

.mode-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 8px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.mode-option:hover {
  background: var(--bg-hover, rgba(127, 127, 127, 0.08));
}

.mode-option.active {
  background: color-mix(in srgb, var(--primary, #3b82f6) 12%, transparent);
}

.mode-option-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.mode-option-name {
  display: inline-flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--fg-strong, #1a1a1a);
}

.mode-option.active .mode-option-name {
  color: var(--primary, #3b82f6);
}

.mode-option-tag {
  font-size: 12px;
  font-weight: 500;
  color: var(--fg-muted, #666);
}

.mode-option.active .mode-option-tag {
  color: color-mix(in srgb, var(--primary, #3b82f6) 75%, var(--fg-muted));
}

.mode-option-hint {
  font-size: 11px;
  line-height: 1.4;
  color: var(--fg-faint, #888);
}

.mode-option-check {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--primary, #3b82f6);
}

.model-select :deep(.n-base-selection) {
  --n-padding-single: 0 16px 0 4px;
  font-size: 11px;
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
  width: min(320px, 86vw);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 2px 2px;
  font-size: 12px;
}

.ctx-pop-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--fg-strong);
}

.ctx-pop-summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.ctx-pop-cost {
  font-size: 11px;
  font-weight: 650;
  color: var(--warn, #d97706);
  font-variant-numeric: tabular-nums;
}

.ctx-pop-full {
  font-weight: 600;
  color: var(--fg-strong);
}

.ctx-pop-pair {
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.ctx-bar {
  display: flex;
  width: 100%;
  height: 10px;
  border-radius: 999px;
  overflow: hidden;
  background: color-mix(in srgb, var(--border, #ddd) 55%, transparent);
}

.ctx-bar-seg {
  display: block;
  height: 100%;
  min-width: 2px;
  flex-shrink: 0;
}

.ctx-bar-seg.free {
  background: color-mix(in srgb, var(--bg-elevated, #f4f4f5) 70%, #d4d4d8);
  flex-shrink: 1;
  min-width: 0;
}

.ctx-legend {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.ctx-legend-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--fg-muted);
}

.ctx-legend-row strong {
  margin-left: auto;
  font-weight: 600;
  color: var(--fg-strong);
  font-variant-numeric: tabular-nums;
}

.ctx-swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}

.ctx-legend-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctx-pop-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 4px;
  border-top: 1px solid color-mix(in srgb, var(--border, #ddd) 70%, transparent);
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
  font-size: 11px;
  color: var(--fg-faint);
  line-height: 1.35;
}

.ctx-compact-btn {
  margin-top: 10px;
}

.ctx-compact-btn.ctx-compact-urgent {
  border-color: var(--error, #d03050) !important;
  color: var(--error, #d03050) !important;
  animation: ctx-pulse 1.6s ease-in-out infinite;
}

.ctx-compact-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--error, #d03050);
  vertical-align: middle;
}

@keyframes ctx-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

@media (max-width: 900px) {
  .mode-trigger {
    max-width: 64px;
    padding: 0 5px 0 7px;
  }

  .model-select {
    max-width: 100px;
  }

  .think-label {
    display: none;
  }
}
</style>
