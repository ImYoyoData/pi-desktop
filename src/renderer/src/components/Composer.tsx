import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { Button, Dropdown, Image, Popover } from "antd";
import type { MenuProps } from "antd";
import {
  AddOutline,
  CheckmarkOutline,
  ContractOutline,
  DocumentOutline,
  ExpandOutline,
  SendOutline,
  StopOutline,
} from "@renderer/components/icons/ionicons";
import * as prefsApi from "@renderer/utils/prefs";
import ComposerRichEditor, {
  type ComposerRichEditorHandle,
} from "@renderer/components/ComposerRichEditor";
import ComposerSlashMenu, {
  type ComposerSlashMenuHandle,
} from "@renderer/components/ComposerSlashMenu";
import ComposerAtFileMenu, {
  type ComposerAtFileMenuHandle,
} from "@renderer/components/ComposerAtFileMenu";
import SendQueueBar from "@renderer/components/SendQueueBar";
import DraftContextBar from "@renderer/components/DraftContextBar";
import { useChatStore } from "@renderer/stores/chat";
import type { ElementCitation } from "../../../shared/protocol";
import { isHttpUrl, useComposerStore } from "@renderer/stores/composer";
import { useKeybindingsStore } from "@renderer/stores/keybindings";
import {
  useSendQueueStore,
  type QueuedSendItem,
} from "@renderer/stores/send-queue";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { plainTextFromClipboard } from "@renderer/utils/composer-rich";
import { heuristicSessionTitle } from "@renderer/utils/session-title";
import {
  DRAFT_PREF_KEY,
  SESSION_PREFS_KEY,
  flatModelOptions,
  forgetPrefKey,
  modelKeyFromState,
  parseSessionPrefs,
  resolveThinkingResult,
  serializeSessionPrefs,
  setPrefKey,
  thinkingFromState,
  type SessionPrefs,
} from "@renderer/utils/session-prefs";
import {
  coercePathToken,
  toWorkspaceRelative,
  transferTypesHaveFilePayload,
  type WorkspacePathContext,
} from "@renderer/utils/composer-paths";
import {
  displayTextFor,
  planComposerTags,
  queueItemHasContent,
  queueMessageText,
  steerTextWithCitations,
  titleSeedFor,
} from "@renderer/utils/composer-payload";
import { buildSessionStats } from "@renderer/utils/session-stats";
import {
  contextCostLabelOf,
  contextFreePctOf,
  contextFullLabelOf,
  contextNeedsCompactAt,
  contextPercentOf,
  contextRingDash,
  contextSegmentsOf,
  contextTokensPairLabelOf,
  contextToneOf,
} from "@renderer/utils/context-usage";
import {
  EMPTY_MODEL_SELECTION,
  filterAvailableModels,
  isSameModelSelection,
  pruneStaleModelSelection,
} from "../../../shared/model-selection";
import { MODEL_MENU_PROPS, buildModelMenu } from "@renderer/model-menu";
import {
  composerModePreamble,
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
  PI_WORKSPACE_PATHS_MIME,
} from "@renderer/utils/workspace-path-dnd";
import { getLocale } from "@renderer/i18n";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useMessage } from "@renderer/services/feedback";
import {
  THINKING_LEVELS,
  isThinkingLevel,
  thinkingLevelLabel,
  type ThinkingLevel,
} from "@renderer/utils/thinking-level";
import styles from "./Composer.module.css";

export type ComposerProps = {
  docked?: boolean;
};

type ModelSelectOption =
  | {
      type: "group";
      label: string;
      key: string;
      children: { label: string; value: string }[];
    }
  | { label: string; value: string };

type ModeMenuItem = {
  value: ComposerAgentMode;
  label: string;
  tag: string;
  hint: string;
};

type Latest<T> = {
  readonly value: T;
  ref: MutableRefObject<T>;
  set: (next: T) => void;
};

const RAW_POPOVER_STYLES = {
  root: { background: "transparent", boxShadow: "none", padding: 0 },
  container: { background: "transparent", boxShadow: "none", padding: 0 },
};

const TONE_CLASS: Record<string, string> = {
  muted: "ctxMuted",
  ok: "ctxOk",
  warn: "ctxWarn",
  danger: "ctxDanger",
};

function useLatest<T>(initial: T): Latest<T> {
  const [, setValue] = useState(initial);
  const ref = useRef(initial);
  const set = useCallback((next: T) => {
    ref.current = next;
    setValue(next);
  }, []);
  /**
   * `value` 直读 ref：set 之后同一 tick 内读到的就是新值。
   * 若改用 state 快照，写入后未重渲染前读到的是旧值——
   * 例如 refreshModels 写完模型列表紧接着读它，会读到空列表而把模型回落成占位符。
   */
  return useMemo(
    () => ({
      get value(): T {
        return ref.current;
      },
      ref,
      set,
    }),
    [set],
  );
}

function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function Composer({ docked = false }: ComposerProps): ReactNode {
  const t = useI18n();
  const composer = useComposerStore();
  const messageApi = useMessage();

  const chatRunning = useChatStore((s) => s.activeRunning);
  const chatStopping = useChatStore((s) => s.activeStopping);
  const pendingUserEdit = useChatStore((s) => s.pendingUserEdit);
  const chatMessageCount = useChatStore((s) => s.activeMessages.length);
  const chatToolCount = useChatStore((s) => {
    const messages = s.activeMessages.filter((m) => m.role === "tool").length;
    const streaming = s.activeStreaming?.role === "tool" ? 1 : 0;
    return messages + streaming;
  });
  const sessionId = useSessionsStore((s) => s.activeId);
  const draftRoot = useSessionsStore((s) => s.draftRoot);
  const contextUsage = useSessionsStore((s) => s.activeContextUsage);
  const activeSessionStatus = useSessionsStore((s) => {
    const id = s.activeId;
    if (!id) return null;
    return s.sessions.find((x) => x.id === id)?.status ?? null;
  });
  const workspaceRoot = useWorkspaceStore((s) => s.root);
  const showCompactButton = useAppearanceStore((s) => s.showCompactButton);
  const showSessionDetails = useAppearanceStore((s) => s.showSessionDetails);
  const queueItems = useSendQueueStore((s) => s.activeItems);
  const queueEditingId = useSendQueueStore((s) => s.editingId);

  const availableModels = useLatest<ModelSelectOption[]>([]);
  const selectedModel = useLatest<string | null>(null);
  const thinking = useLatest<ThinkingLevel>("medium");
  const prefs = useLatest<SessionPrefs>(
    parseSessionPrefs(prefsApi.getItem(SESSION_PREFS_KEY)),
  );
  const slashSkills = useLatest<{ name: string; description: string }[]>([]);
  const atFileItems = useLatest<AtFileItem[]>([]);
  const atFileLoading = useLatest(false);
  const skillsCount = useLatest<number | null>(null);
  const editorExpanded = useLatest(false);
  const fileDragOver = useLatest(false);
  const pathCaseInsensitive = useLatest(false);
  const modeBubbleOpen = useLatest(false);
  const ctxPopoverOpen = useLatest(false);
  const modelMenuOpen = useLatest(false);
  const compactBusy = useLatest(false);

  const richEditorRef = useRef<ComposerRichEditorHandle | null>(null);
  const slashMenuRef = useRef<ComposerSlashMenuHandle | null>(null);
  const atFileMenuRef = useRef<ComposerAtFileMenuHandle | null>(null);
  const appliedModelForSessionRef = useRef<string | null>(null);
  const draftCommitPendingRef = useRef(false);
  const drainInFlightRef = useRef<string | null>(null);
  const slashSkillsCachedForRef = useRef<string | null>(null);
  const slashSkillsLoadingRef = useRef(false);
  const atFileSearchGenRef = useRef(0);
  const atFileRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skillsCountCachedForRef = useRef<string | null>(null);
  const prevSessionIdRef = useRef<string | null>(null);
  const sessionWatchReadyRef = useRef(false);
  const queueWatchReadyRef = useRef(false);
  const prevRunningRef = useRef(false);

  const isDraftSession = !sessionId && Boolean(draftRoot);

  function currentSessionId(): string | null {
    return useSessionsStore.getState().activeId;
  }

  function currentPrefsKey(): string | null {
    const state = useSessionsStore.getState();
    if (state.activeId) return state.activeId;
    return state.draftRoot ? DRAFT_PREF_KEY : null;
  }

  function isRunning(): boolean {
    const chatState = useChatStore.getState();
    if (chatState.activeRunning) return true;
    const sessionsState = useSessionsStore.getState();
    const id = sessionsState.activeId;
    if (!id) return false;
    return sessionsState.sessions.find((s) => s.id === id)?.status === "running";
  }

  function focusDraft(): void {
    richEditorRef.current?.focus();
  }

  function focusDraftAtEnd(): void {
    richEditorRef.current?.focusEnd();
    richEditorRef.current?.scrollToEnd();
  }

  function persistSessionPrefs(next: SessionPrefs): void {
    prefsApi.setItem(SESSION_PREFS_KEY, serializeSessionPrefs(next));
  }

  function updatePrefs(next: SessionPrefs): void {
    prefs.set(next);
    persistSessionPrefs(next);
  }

  /** 界面档位写入偏好；worker 会按模型能力 clamp 后回传实际档位。 */
  function adoptThinking(level: ThinkingLevel, key: string | null = currentPrefsKey()): void {
    thinking.set(level);
    if (key) rememberThinking(key, level);
  }

  /**
   * worker 会按模型能力 clamp 档位（模型未映射 xhigh/max 时回落到 high）。
   * 实际值不等于请求值就说明被 clamp，界面改成实际档位，避免显示与实际不符。
   */
  function adoptThinkingResult(
    requested: ThinkingLevel,
    result: unknown,
    key: string | null = currentPrefsKey(),
  ): void {
    // worker 未回传实际值时不动界面，只按用户选择记忆。
    const { actual, clamped } = resolveThinkingResult(requested, result, isThinkingLevel);
    if (!clamped) {
      if (key) rememberThinking(key, requested);
      return;
    }
    adoptThinking(actual, key);
  }

  function rememberModel(sessionId: string, key: string): void {
    updatePrefs(setPrefKey(prefs.ref.current, "models", sessionId, key));
  }

  function rememberThinking(sessionId: string, level: ThinkingLevel): void {
    updatePrefs(setPrefKey(prefs.ref.current, "thinking", sessionId, level));
  }

  /** 清掉某个记忆键，避免草稿转正后残留悬挂偏好。 */
  function forgetPrefs(key: string): void {
    const next = forgetPrefKey(prefs.ref.current, key);
    if (next === prefs.ref.current) return;
    updatePrefs(next);
  }

  const thinkingMenu: MenuProps["items"] = THINKING_LEVELS.map((o) => ({
    label: o.label,
    key: o.value,
    style:
      o.value === thinking.value
        ? { fontWeight: 600, color: "var(--accent)" }
        : undefined,
  }));

  const thinkingLabel = thinkingLevelLabel(thinking.value) ?? "Medium";

  const modelMenu = buildModelMenu(availableModels.value, selectedModel.value);

  const modelLabel =
    flatModelOptions(availableModels.value).find(
      (o) => o.value === selectedModel.value,
    )?.label ?? t.modelPlaceholder;

  const running = chatRunning || activeSessionStatus === "running";

  const hasSendContent = Boolean(
    composer.draft.trim() || composer.images.length || composer.chips.length,
  );

  /** Editing a queued item — Enter/Send commits back to the queue. */
  const isEditingQueue = Boolean(queueEditingId);
  const isEditingPublished =
    Boolean(pendingUserEdit) && pendingUserEdit?.sessionId === sessionId;

  /** Show stop while running; show send whenever there is a session or a draft. */
  const showPrimaryAction = Boolean(sessionId) || isDraftSession;
  /** Stop when running with empty composer; otherwise send/queue. */
  const primaryIsStop = running && !hasSendContent;
  /**
   * A stop is in flight but the worker has not gone idle yet. The button shows a
   * spinner instead of looking inert, so a slow abort never reads as a freeze.
   */
  const stopping = chatStopping;

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
    if (typeof p === "string" && p.trim()) return toWorkspaceRelativePath(p.trim());
    return null;
  }

  /** Prefer workspace-relative paths for file tags. */
  const pathCtx: WorkspacePathContext = {
    root: workspaceRoot || "",
    caseInsensitive: pathCaseInsensitive.value,
  };

  function toWorkspaceRelativePath(p: string): string {
    return toWorkspaceRelative(p, pathCtx);
  }

  /** Absolute / file:// / workspace-relative path token → workspace-relative for file tags. */
  function coercePathTokenInComposer(raw: string): string | null {
    return coercePathToken(raw, pathCtx);
  }

  function transferHasFilePayload(data: DataTransfer): boolean {
    return transferTypesHaveFilePayload(data.types);
  }

  function onComposerDragOver(event: ReactDragEvent<HTMLDivElement>): void {
    const data = event.dataTransfer;
    if (!data || !transferHasFilePayload(data)) return;
    event.preventDefault();
    data.dropEffect = "copy";
    fileDragOver.set(true);
  }

  function onComposerDragLeave(event: ReactDragEvent<HTMLDivElement>): void {
    const next = event.relatedTarget as Node | null;
    const card = event.currentTarget as HTMLElement | null;
    if (card && next && card.contains(next)) return;
    fileDragOver.set(false);
  }

  function onComposerDrop(event: ReactDragEvent<HTMLDivElement>): void {
    fileDragOver.set(false);
    const data = event.dataTransfer;
    if (!data) return;
    const outcome = ingestTransferData(data);
    if (!outcome) return;
    event.preventDefault();
    event.stopPropagation();
    if (outcome.kind === "text") {
      // Dropped http(s) URLs stay plain text — insert where the user let go.
      placeDropCaret(event.clientX, event.clientY);
      richEditorRef.current?.insertTextAtCaret(outcome.text, true);
    }
  }

  /** Park the caret at the drop point so URL drops insert exactly where released. */
  function placeDropCaret(clientX: number, clientY: number): void {
    const root = richEditorRef.current?.getSurface() ?? null;
    if (!root) return;
    root.focus();
    const caretFromPoint = (
      document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      }
    ).caretRangeFromPoint;
    const range = caretFromPoint ? caretFromPoint.call(document, clientX, clientY) : null;
    if (!range || !root.contains(range.startContainer)) return;
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /**
   * Shared drop ingest. Returns what the caller should do with the event:
   * - { kind: "files" }: paths/images already became tags & attachments — consume it.
   * - { kind: "text" }: payload is an http(s) URL — insert as plain text (never a chip).
   * - null: nothing to handle — leave the browser's default behavior.
   */
  function ingestTransferData(
    data: DataTransfer,
  ): { kind: "files" } | { kind: "text"; text: string } | null {
    const custom = data.getData(PI_WORKSPACE_PATHS_MIME)?.trim() ?? "";
    if (custom) {
      const paths = decodeWorkspacePaths(custom);
      if (paths.length) {
        for (const filePath of paths) {
          useComposerStore.getState().addFileTag(filePath);
        }
        return { kind: "files" };
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
        if (filePath) useComposerStore.getState().addFileTag(filePath);
      }
      return { kind: "files" };
    }

    const uriList = data.getData("text/uri-list")?.trim() ?? "";
    if (uriList) {
      const filePaths: string[] = [];
      const urls: string[] = [];
      for (const line of uriList.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        if (/^https?:\/\//i.test(trimmed)) {
          urls.push(trimmed);
          continue;
        }
        const filePath = coercePathTokenInComposer(trimmed);
        if (filePath) filePaths.push(filePath);
      }
      for (const filePath of filePaths) {
        useComposerStore.getState().addFileTag(filePath);
      }
      if (urls.length) return { kind: "text", text: urls.join("\n") };
      if (filePaths.length) return { kind: "files" };
    }

    const text = data.getData("text/plain")?.trim() ?? "";
    if (text && isHttpUrl(text)) {
      return { kind: "text", text };
    }

    if (text) {
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const asPaths = lines
        .map(coercePathTokenInComposer)
        .filter((p): p is string => Boolean(p));
      if (asPaths.length && asPaths.length === lines.length) {
        for (const filePath of asPaths) {
          useComposerStore.getState().addFileTag(filePath);
        }
        return { kind: "files" };
      }
    }

    return null;
  }

  async function addFiles(files: FileList | File[]): Promise<void> {
    const list = Array.from(files);
    for (const file of list) {
      if (file.type.startsWith("image/")) {
        try {
          const img = await readImageFile(file);
          if (img) {
            // Persist into the session cache so the message references a real file.
            await useComposerStore
              .getState()
              .addPastedImage(`data:${img.mimeType};base64,${img.data}`);
            if (img.previewUrl.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl);
          }
        } catch (err) {
          console.warn("[composer] failed to read pasted image", err);
        }
        continue;
      }
      const filePath = electronFilePath(file);
      if (filePath) useComposerStore.getState().addFileTag(filePath);
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
    citationsToSend: ElementCitation[] | undefined;
    tagsToSend:
      | {
          url: string;
          host: string;
          label: string;
          content?: string;
          kind?: "file" | "url" | "element" | "agent" | "plan" | "ask" | "task";
        }[]
      | undefined;
    mode: ComposerAgentMode;
  } | null {
    const store = useComposerStore.getState();
    const chipText = store.formatChipsForMessage();
    const displayText = store.draft.trim();
    const mode = store.activeMode();
    const body = [displayText, chipText].filter(Boolean).join("\n\n");
    let text = [composerModePreamble(mode), body].filter(Boolean).join("\n\n");
    // Bind cached image paths to the prompt (hidden in the editor): text-only
    // models can locate the files, vision models still get the base64 content.
    const imagePaths = Array.from(
      new Set(store.images.map((i) => i.cachePath).filter((p): p is string => Boolean(p))),
    );
    if (imagePaths.length) {
      text = `${text}\n\n[attached images]\n${imagePaths.map((p) => `- ${p}`).join("\n")}`;
    }
    if (!body && !store.images.length && !store.chips.length) return null;
    const citations = store.elementCitations();
    const citationList = citations.length ? citations : undefined;
    const attachmentTags = store.attachmentTagSnapshot();
    const seen = new Set<string>();
    const imagesToSend = store.images
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
    const citationsToSend = citationList ? citationList.map((c) => ({ ...c })) : undefined;
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
      mode,
    };
  }

  const attachMenu: MenuProps["items"] = [
    {
      label: t.composerAttachFile,
      key: "file",
      icon: <DocumentOutline />,
    },
  ];

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

  const activeModeLabel = modeTagLabel(composer.mode);

  function onModePick(mode: ComposerAgentMode): void {
    useComposerStore.getState().setMode(mode);
    modeBubbleOpen.set(false);
  }

  async function onAttachSelect(key: string | number): Promise<void> {
    if (String(key) === "file") {
      const picked = await window.api.preview.pickFile();
      if (picked) useComposerStore.getState().addFileTag(picked);
    }
  }

  function enqueueFromComposer(): boolean {
    const id = currentSessionId();
    if (!id) return false;
    const snap = snapshotComposerPayload();
    if (!snap) return false;
    useSendQueueStore.getState().enqueue(id, {
      text: queueMessageText({
        displayText: snap.displayText,
        text: snap.text,
        hasVisual: Boolean(snap.imagesToSend.length || snap.tagsToSend?.length),
      }),
      images: snap.imagesToSend.length ? snap.imagesToSend : undefined,
      citations: snap.citationsToSend,
      elementTags: snap.tagsToSend,
      agentText: snap.text || undefined,
    });
    useComposerStore.getState().clear();
    messageApi.success(t.queueAdded, 1.4);
    // Race fix: turn may already be idle when Enter queued — flush now instead of waiting
    // for the next running→idle edge (which made messages look "lost" until the next turn).
    if (!isAgentBusy(id)) {
      void drainQueueIfIdle(id);
    }
    return true;
  }

  /**
   * Guidance sent while Pi is replying.
   *
   * Sending mid-turn goes through steering rather than the idle queue: the SDK
   * delivers a steering message after the current assistant turn finishes its tool
   * calls and BEFORE the next LLM call, so the model re-reasons with it — waiting
   * for the turn to end would silently postpone the user's correction by a whole
   * turn. `submit("prompt")` routes here; queued items keep draining on idle.
   */
  async function steerFromComposer(): Promise<boolean> {
    const id = currentSessionId();
    if (!id) return false;
    const snap = snapshotComposerPayload();
    if (!snap) return false;
    const hasVisual = Boolean(snap.imagesToSend.length || snap.tagsToSend?.length);
    const steerText = steerTextWithCitations({
      agentText: snap.text || (hasVisual ? " " : ""),
      text: snap.text || (hasVisual ? " " : ""),
      citations: snap.citationsToSend,
    });
    if (!steerText.trim()) return false;
    useComposerStore.getState().clear();
    // Show it immediately as a pending card: the agent only writes a steering
    // message into the transcript after the current tool calls finish, so without
    // this the guidance looked like it had been swallowed.
    useSendQueueStore.getState().addPendingSteer(id, {
      text: snap.displayText || snap.text || " ",
      agentText: snap.text || undefined,
      images: snap.imagesToSend.length ? snap.imagesToSend : undefined,
      citations: snap.citationsToSend,
      elementTags: snap.tagsToSend,
    });
    await applySelectedModel({ allowStart: true });
    await useChatStore
      .getState()
      .steer(id, steerText, snap.imagesToSend.length ? snap.imagesToSend : undefined);
    messageApi.success(t.steerSent, 1.4);
    return true;
  }

  /** Persist main-composer contents back onto the queue item being edited. */
  function saveEditingToQueue(): boolean {
    const id = currentSessionId();
    const qid = useSendQueueStore.getState().editingId;
    if (!id || !qid) return false;
    const snap = snapshotComposerPayload();
    if (!snap) {
      messageApi.warning(t.queueEditPlaceholder);
      return false;
    }
    const updated = useSendQueueStore.getState().updateItem(id, qid, {
      text: queueMessageText({
        displayText: snap.displayText,
        text: snap.text,
        hasVisual: Boolean(snap.imagesToSend.length || snap.tagsToSend?.length),
      }),
      agentText: snap.text || undefined,
      images: snap.imagesToSend.length ? snap.imagesToSend : undefined,
      citations: snap.citationsToSend,
      elementTags: snap.tagsToSend,
    });
    if (!updated) {
      useSendQueueStore.getState().setEditing(id, null);
      return false;
    }
    useSendQueueStore.getState().setEditing(id, null);
    useComposerStore.getState().clear();
    messageApi.success(t.queueSaved, 1.4);
    return true;
  }

  function discardQueueEdit(): void {
    const id = currentSessionId();
    if (!id) return;
    useSendQueueStore.getState().setEditing(id, null);
    useComposerStore.getState().clear();
  }

  function discardPublishedEdit(): void {
    useChatStore.getState().cancelEditUser();
    useComposerStore.getState().clear();
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
    const store = useComposerStore.getState();
    store.clear();
    store.setDraft(displayTextFor(item.text));
    for (const img of item.images ?? []) {
      useComposerStore.getState().addImageFile({
        data: img.data,
        mimeType: img.mimeType || "image/png",
        previewUrl: `data:${img.mimeType || "image/png"};base64,${img.data}`,
      });
    }
    const seenUrls = new Set<string>();
    for (const c of item.citations ?? []) {
      seenUrls.add(c.url);
      useComposerStore.getState().addCitation({
        url: c.url,
        selector: c.selector ?? "",
        text: c.text ?? "",
        htmlSnippet: c.htmlSnippet ?? "",
      });
    }
    for (const action of planComposerTags(item.elementTags)) {
      if (action.kind === "mode") {
        useComposerStore.getState().setMode(action.mode);
      } else if (action.kind === "file") {
        useComposerStore.getState().addFileTag(action.value);
      } else if (action.kind === "url") {
        useComposerStore.getState().addUrlTag(action.value);
      } else if (!seenUrls.has(action.url)) {
        seenUrls.add(action.url);
        useComposerStore.getState().addCitation({
          url: action.url,
          selector: "",
          text: action.text,
          htmlSnippet: "",
        });
      }
    }
  }

  function beginEditQueueItem(itemId: string): void {
    const id = currentSessionId();
    if (!id) return;
    if (useChatStore.getState().pendingUserEdit) {
      useChatStore.getState().cancelEditUser();
    }

    const editing = useSendQueueStore.getState().editingId;
    if (editing && editing !== itemId) {
      // Commit the previous edit before switching
      if (hasSendContent) saveEditingToQueue();
      else useSendQueueStore.getState().setEditing(id, null);
    }

    // Editing a queued item intentionally replaces the composer content with
    // that item — do NOT enqueue any unrelated draft here (that duplicated the
    // item and caused double-sends). If an unrelated draft exists, drop it.

    const item = useSendQueueStore.getState().get(id, itemId);
    if (!item) return;
    loadQueueItemIntoComposer(item);
    useSendQueueStore.getState().setEditing(id, itemId);
    void nextFrame().then(() => focusDraftAtEnd());
  }

  async function dispatchQueuedItem(
    id: string,
    item: QueuedSendItem,
  ): Promise<void> {
    // Always prompt: Pi followUp only queues during a live turn and will not
    // start a new turn when the agent is already idle (queued items vanished).
    // Cold session: spawn worker on first real dispatch (not on create/open).
    // 不等待：队列气泡先上屏，不被 worker 往返挡住。
    void applySelectedModel({ allowStart: true });
    await useChatStore.getState().sendPrompt(
      id,
      item.agentText || item.text || " ",
      item.citations,
      item.images,
      item.elementTags,
      displayTextFor(item.text),
    );
  }

  function isAgentBusy(targetSessionId?: string): boolean {
    const id = targetSessionId ?? currentSessionId();
    if (!id) return false;
    if (useChatStore.getState().bySession[id]?.running) return true;
    return (
      useSessionsStore.getState().sessions.find((s) => s.id === id)?.status ===
      "running"
    );
  }

  /** Serialize auto-drain so idle races cannot fire two sends at once. */
  async function drainQueueIfIdle(targetSessionId: string): Promise<void> {
    if (drainInFlightRef.current === targetSessionId) return;
    if (useSendQueueStore.getState().isDrainSuppressed(targetSessionId)) return;
    if (isAgentBusy(targetSessionId)) return;

    // Claim lock before takeNext — concurrent running/length watchers otherwise
    // both shift items and one send is lost.
    drainInFlightRef.current = targetSessionId;
    let taken: QueuedSendItem | null = null;
    let sentOk = false;
    try {
      while (
        !isAgentBusy(targetSessionId) &&
        !useSendQueueStore.getState().isDrainSuppressed(targetSessionId)
      ) {
        taken = useSendQueueStore.getState().takeNext(targetSessionId);
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
        useSendQueueStore.getState().requeueFront(targetSessionId, taken);
        taken = null;
      }
      const msg = err instanceof Error ? err.message : String(err);
      messageApi.error(msg);
    } finally {
      if (drainInFlightRef.current === targetSessionId) drainInFlightRef.current = null;
      // running→idle watch may have been skipped while the lock was held for the
      // full prompt; continue the queue now that we are idle again.
      if (
        sentOk &&
        !useSendQueueStore.getState().isDrainSuppressed(targetSessionId) &&
        !isAgentBusy(targetSessionId) &&
        useSendQueueStore.getState().list(targetSessionId).length > 0
      ) {
        void drainQueueIfIdle(targetSessionId);
      }
    }
  }

  async function sendQueuedNow(itemId: string): Promise<void> {
    const id = currentSessionId();
    if (!id) return;
    const item = useSendQueueStore.getState().remove(id, itemId);
    if (!item) return;
    useSendQueueStore.getState().setSuppressDrain(id, true);
    try {
      if (isAgentBusy(id)) {
        // Codex-style steer: queue the message as guidance for the running turn
        // WITHOUT aborting it. The model processes it after the current output.
        void applySelectedModel({ allowStart: true });
        await useChatStore
          .getState()
          .steer(id, steerTextWithCitations(item), item.images);
      } else {
        await dispatchQueuedItem(id, item);
      }
    } finally {
      useSendQueueStore.getState().setSuppressDrain(id, false);
    }
  }

  async function submit(mode: "prompt" | "steer" | "follow_up"): Promise<void> {
    // Editing a queued message: commit back into the queue
    if (useSendQueueStore.getState().editingId) {
      saveEditingToQueue();
      return;
    }

    // 快照先于任何 await 取：让出的微任务里会话绑定可能变化，
    // 否则工具栏显示的模式会与实际下发的不一致。
    const snap = snapshotComposerPayload();

    // While agent is running, a plain send becomes guidance for the running turn
    // (steer) instead of waiting for the next turn.
    if (isRunning() && mode === "prompt") {
      await steerFromComposer();
      return;
    }

    // Bare builtin slash (e.g. `/compact`) — run locally, do not prompt the model.
    if (mode === "prompt" && (await tryConsumeBuiltinSlashDraft())) return;

    if (!snap) return;

    // 草稿态在此刻才真正建会话（首条消息触发），失败则保留输入待重试。
    const sourceId = currentSessionId();
    const sessionsState = useSessionsStore.getState();
    if (!sourceId && !sessionsState.draftRoot) return;
    let id = sourceId;
    if (!id) {
      draftCommitPendingRef.current = true;
      try {
        const created = await useSessionsStore.getState().commitDraft();
        if (!created) {
          draftCommitPendingRef.current = false;
          return;
        }
        id = created.id;
        useComposerStore.getState().transferDraftMode(id, snap.mode);
      } catch (err) {
        draftCommitPendingRef.current = false;
        messageApi.error(err instanceof Error ? err.message : String(err));
        return;
      }
    }

    // Re-editing a published user bubble: commit replaces that message and
    // everything after it (see chat.sendPromptSerial + agent rollback_user).
    // `pendingUserEdit` is cleared once the send lands (in chat.sendPrompt).

    const displayText = snap.displayText;
    const agentText = snap.text || " ";
    const titleSeed = titleSeedFor(displayText, snap.tagsToSend?.[0]);
    useComposerStore.getState().clearSession(sourceId);
    // First message (or any send) activates the Pi agent worker and applies model.
    if (mode === "prompt" || mode === "steer" || mode === "follow_up") {
      // 不等 worker 冷启动：设置与 prompt 依次下发，主进程保证设置先落地，
      // 用户气泡因此立即上屏。
      void applySelectedModel({ allowStart: true });
      const level = thinking.ref.current;
      void useSessionsStore
        .getState()
        .sendCommand(id, {
          type: "set_thinking_level",
          level,
        })
        .then((result) => adoptThinkingResult(level, result, id))
        .catch(() => {
          // ignore — prompt may still proceed with worker default
        });
    }
    if (mode === "prompt") {
      const root = useWorkspaceStore.getState().root;
      const summary = useSessionsStore
        .getState()
        .sessions.find((s) => s.id === id);
      if (root && titleSeed && !summary?.name?.trim()) {
        const title = heuristicSessionTitle(titleSeed);
        if (title) void useSessionsStore.getState().renameSession(id, root, title);
      }
      await useChatStore.getState().sendPrompt(
        id,
        agentText,
        snap.citationsToSend,
        snap.imagesToSend,
        snap.tagsToSend,
        displayText,
      );
    } else if (mode === "steer") await useChatStore.getState().steer(id, agentText);
    else await useChatStore.getState().followUp(id, agentText);
  }

  function onKeydown(event: KeyboardEvent): void {
    const draft = useComposerStore.getState().draft;
    const ctx = parseSlashContext(draft);
    const atCtx = parseAtFileContext(draft);

    if (slashMenuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        slashMenuRef.current?.move(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        slashMenuRef.current?.move(-1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (ctx) useComposerStore.getState().setDraft(draft.slice(0, ctx.slashIndex));
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        slashMenuRef.current?.confirm();
        return;
      }
      if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        slashMenuRef.current?.confirm();
        return;
      }
    }

    if (atFileMenuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        atFileMenuRef.current?.move(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        atFileMenuRef.current?.move(-1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (atCtx) {
          useComposerStore.getState().setDraft(replaceAtFileMention(draft, atCtx));
        }
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        atFileMenuRef.current?.confirm();
        return;
      }
      if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        atFileMenuRef.current?.confirm();
        return;
      }
    }

    if (event.key !== "Enter" || event.isComposing) return;

    // DeepSeek-style: Enter sends; Shift+Enter inserts a newline (both modes).
    if (event.shiftKey) return;

    event.preventDefault();
    if (useSendQueueStore.getState().editingId) {
      saveEditingToQueue();
      return;
    }
    if (isRunning()) {
      enqueueFromComposer();
      return;
    }
    // Empty composer + queued sends: Enter flushes the first queued item
    // (Cursor-like — the queue bar shows what will go next).
    const activeId = currentSessionId();
    if (!hasSendContent && activeId && useSendQueueStore.getState().activeItems.length > 0) {
      void drainQueueIfIdle(activeId);
      return;
    }
    void submit("prompt");
  }

  async function onAbort(): Promise<void> {
    const id = currentSessionId();
    if (id) await useChatStore.getState().abort(id);
  }

  function onPrimaryAction(): void {
    if (useSendQueueStore.getState().editingId && !isRunning()) {
      saveEditingToQueue();
      return;
    }
    if (isRunning() && !hasSendContent) {
      void onAbort();
      return;
    }
    if (isRunning() && hasSendContent) {
      onQueueSendClick();
      return;
    }
    void submit("prompt");
  }

  function onQueueSendClick(): void {
    if (useSendQueueStore.getState().editingId) {
      saveEditingToQueue();
      return;
    }
    enqueueFromComposer();
  }


  /** 上下文占用率：环形图、色调、% Full 与分段条共用同一个窗口口径。 */
  const contextPercent = contextPercentOf(contextUsage);
  const contextTone = contextToneOf(contextPercent);
  const contextRingStyle = contextRingDash(contextPercent);
  const contextMessageCount = contextUsage?.messageCount ?? chatMessageCount;
  const contextToolCount = (() => {
    const fromStats = contextUsage?.toolCalls;
    if (typeof fromStats === "number") return fromStats;
    return chatToolCount;
  })();
  const contextCostLabel = contextCostLabelOf(contextUsage);
  const contextNeedsCompact = contextNeedsCompactAt(contextPercent);
  const contextSegments = contextSegmentsOf(contextUsage);
  const contextFreePct = contextFreePctOf(contextUsage);
  const contextFullLabel = contextFullLabelOf(contextPercent);
  const contextTokensPairLabel = contextTokensPairLabelOf(contextUsage);

  const slashBuiltins: SlashItem[] = [
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
  ];

  const slashSkillItems: SlashItem[] = slashSkills.value.map((s) => ({
    id: `skill:${s.name}`,
    kind: "skill" as const,
    command: skillSlashCommand(s.name),
    title: `/${skillSlashCommand(s.name)}`,
    description: s.description || t.slashSkillFallbackDesc,
  }));

  const slashContext = parseSlashContext(composer.draft);

  const slashItems: SlashItem[] = slashContext
    ? filterSlashItems([...slashBuiltins, ...slashSkillItems], slashContext.query)
    : [];

  const slashMenuOpen = Boolean(slashContext) && slashItems.length > 0;

  const atFileContext = slashContext ? null : parseAtFileContext(composer.draft);

  const atFileMenuOpen = Boolean(atFileContext);

  const atFileEmptyHint = !workspaceRoot
    ? t.atFileNeedWorkspace
    : atFileLoading.value
      ? t.atFileSearching
      : t.atFileEmpty;

  /** Recently opened preview tabs (workspace-relative) for the empty-@ list. */
  function recentPreviewAtFiles(): AtFileItem[] {
    const out: AtFileItem[] = [];
    const seen = new Set<string>();
    for (const tab of useRightTabsStore.getState().tabs) {
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
    const gen = ++atFileSearchGenRef.current;
    const root = useWorkspaceStore.getState().root;
    if (!root) {
      atFileItems.set([]);
      return;
    }
    atFileLoading.set(true);
    try {
      const q = query.trim();
      if (!q) {
        const recent = recentPreviewAtFiles();
        const rootEntries = await window.api.files.list();
        if (gen !== atFileSearchGenRef.current) return;
        const seen = new Set(recent.map((r) => r.path));
        const merged: AtFileItem[] = [...recent];
        for (const e of rootEntries) {
          if (seen.has(e.path)) continue;
          merged.push({ name: e.name, path: e.path, kind: e.kind });
        }
        atFileItems.set(merged);
        return;
      }
      const entries = await window.api.files.search(q, 80);
      if (gen !== atFileSearchGenRef.current) return;
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
      atFileItems.set([
        ...mapped.filter((e) => recentHit.has(e.path)),
        ...mapped.filter((e) => !recentHit.has(e.path)),
      ]);
    } catch {
      if (gen !== atFileSearchGenRef.current) return;
      atFileItems.set([]);
    } finally {
      if (gen === atFileSearchGenRef.current) atFileLoading.set(false);
    }
  }

  async function ensureSlashSkills(): Promise<void> {
    const root = useWorkspaceStore.getState().root ?? "";
    if (slashSkillsCachedForRef.current === root || slashSkillsLoadingRef.current) return;
    slashSkillsLoadingRef.current = true;
    try {
      const data = await window.api.skills.list(
        useWorkspaceStore.getState().root ?? undefined,
      );
      slashSkills.set(
        (data.skills ?? []).map((s) => ({
          name: s.name,
          description: s.description ?? "",
        })),
      );
      slashSkillsCachedForRef.current = root;
    } catch {
      slashSkills.set([]);
    } finally {
      slashSkillsLoadingRef.current = false;
    }
  }

  async function runSlashBuiltin(id: string): Promise<void> {
    if (!isSlashBuiltinId(id)) return;
    switch (id) {
      case "new": {
        const root = useWorkspaceStore.getState().root;
        if (!root) {
          messageApi.warning(t.slashNeedWorkspace);
          return;
        }
        useSessionsStore.getState().beginDraft(root);
        messageApi.success(t.slashNewDone);
        return;
      }
      case "compact": {
        const idSession = currentSessionId();
        if (!idSession) {
          messageApi.warning(t.slashNeedSession);
          return;
        }
        await useSessionsStore.getState().sendCommand(idSession, { type: "compact" });
        messageApi.success(t.compactDone);
        return;
      }
      case "model": {
        // Model switching stays available while Pi is replying (the worker applies
        // it to the live session) — no lock guard here.
        await nextFrame();
        modelMenuOpen.set(true);
        return;
      }
      default: {
        const _never: never = id;
        void _never;
      }
    }
  }

  async function onAtFileSelect(item: AtFileItem): Promise<void> {
    const ctx = atFileContext;
    if (!ctx) return;
    const nextDraft = replaceAtFileMention(useComposerStore.getState().draft, ctx);
    useComposerStore.getState().addFileTag(item.path);
    // Chip sync may re-read DOM still containing `@query`; strip after that flush.
    await nextFrame();
    useComposerStore.getState().setDraft(nextDraft);
    await nextFrame();
    focusDraft();
  }

  async function onSlashSelect(item: SlashItem): Promise<void> {
    const ctx = slashContext;
    if (!ctx) return;
    if (item.kind === "builtin") {
      useComposerStore.getState().clear();
      await runSlashBuiltin(item.id);
      return;
    }
    // Skills: leave `/skill:name` so AgentSession expands on send; trailing space for optional args.
    const draft = useComposerStore.getState().draft;
    useComposerStore
      .getState()
      .setDraft(replaceSlashLine(draft, ctx, item.command, true));
    await nextFrame();
    focusDraft();
  }

  /** If the whole draft is a bare builtin slash, run it instead of prompting. */
  async function tryConsumeBuiltinSlashDraft(): Promise<boolean> {
    const raw = useComposerStore.getState().draft.trim();
    if (!raw.startsWith("/") || raw.includes("\n")) return false;
    const body = raw.slice(1).trim();
    if (!isSlashBuiltinId(body)) return false;
    useComposerStore.getState().clear();
    await runSlashBuiltin(body);
    return true;
  }

  /**
   * Session-detail stats shown under the composer: Agent turns, steps, tool
   * calls, TTFT, avg tokens/s, cache hit, input/output tokens.
   * Fed by the worker's context_usage event (SessionTimingTracker + Pi stats).
   *
   * Only items that actually have data are rendered — a stat with no sample
   * is omitted instead of showing "label —".
   */
  const sessionStats = buildSessionStats(contextUsage);

  async function onCompactContext(): Promise<void> {
    const idSession = currentSessionId();
    if (!idSession || compactBusy.value) return;
    compactBusy.set(true);
    try {
      await useSessionsStore.getState().sendCommand(idSession, { type: "compact" });
      messageApi.success(t.compactDone);
      ctxPopoverOpen.set(false);
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : String(err));
    } finally {
      compactBusy.set(false);
    }
  }

  async function loadSkillsCount(): Promise<void> {
    const root = useWorkspaceStore.getState().root ?? "";
    if (skillsCountCachedForRef.current === root && skillsCount.value !== null) return;
    try {
      const data = await window.api.skills.list(
        useWorkspaceStore.getState().root ?? undefined,
      );
      skillsCount.set(data.skills?.length ?? 0);
      skillsCountCachedForRef.current = root;
    } catch {
      skillsCount.set(null);
    }
  }

  async function onThinkingChange(value: string | number): Promise<void> {
    const level = String(value) as ThinkingLevel;
    thinking.set(level);
    const key = currentPrefsKey();
    if (key) rememberThinking(key, level);
    const id = currentSessionId();
    if (!id) return;
    // persist: 写入 Pi 全局默认，新会话（无历史记录）据此初始化。
    const result = await useSessionsStore.getState().sendCommand(id, {
      type: "set_thinking_level",
      level,
      persist: true,
    });
    adoptThinkingResult(level, result, key);
  }

  async function refreshModels(): Promise<void> {
    try {
      const data = await window.api.models.get();
      const available = data.available;
      // Honour the Settings → Models curation so a 300-model provider does not
      // flood the menu; providers without a curation pass through untouched.
      //
      // Prune first. A curation whose ids were all renamed/replaced upstream would
      // otherwise filter the provider's *new* models away and leave the menu empty —
      // which reads as "this session has no model config". Persist the pruned
      // selection so the stale entry does not come back on the next launch.
      const stored = data.modelSelection ?? EMPTY_MODEL_SELECTION;
      const selection = pruneStaleModelSelection(stored, available);
      if (!isSameModelSelection(stored, selection)) {
        try {
          await window.api.models.setSelection(selection);
        } catch {
          // Self-heal is best-effort: an unwritable store must not break the menu.
        }
      }
      const selected = filterAvailableModels(available, selection);
      const byProvider = new Map<string, { label: string; value: string }[]>();
      for (const m of selected) {
        const list = byProvider.get(m.provider) ?? [];
        const label = (m.name && m.name.trim()) || m.id;
        list.push({ label, value: `${m.provider}/${m.id}` });
        byProvider.set(m.provider, list);
      }
      const groups: ModelSelectOption[] = [...byProvider.entries()].map(
        ([provider, children]) => ({
          type: "group",
          label: provider,
          key: provider,
          children,
        }),
      );
      availableModels.set(groups);
      await syncSessionModelAndThinking();
    } catch (err) {
      // Keep whatever list we already had: blanking it turns a transient failure
      // into a dead model button with no way back.
      console.warn("[composer] failed to refresh models", err);
    }
  }

  async function syncSessionModelAndThinking(): Promise<void> {
    const realId = currentSessionId();
    const key = currentPrefsKey();
    const flat = flatModelOptions(availableModels.value);
    if (!key) {
      selectedModel.set(flat[0]?.value ?? null);
      return;
    }

    // Instant UI from per-session (or draft) memory
    const remembered = prefs.ref.current.models[key];
    if (remembered && flat.some((o) => o.value === remembered)) {
      selectedModel.set(remembered);
    }
    const rememberedThinking = prefs.ref.current.thinking[key];
    if (rememberedThinking) {
      thinking.set(rememberedThinking);
    }

    // New session with no saved prefs: inherit model + thinking level from the
    // workspace's first session (sidebar top) so new chats match the user's setup.
    if (!remembered && !rememberedThinking) {
      const first = useSessionsStore.getState().sessions[0];
      if (first && first.id !== realId) {
        const firstModel = prefs.ref.current.models[first.id];
        const firstThinking = prefs.ref.current.thinking[first.id];
        if (firstModel && flat.some((o) => o.value === firstModel)) {
          selectedModel.set(firstModel);
        }
        if (firstThinking) thinking.set(firstThinking);
      }
    }

    // 草稿没有 worker 可查，选定模型/等级就位后直接返回。
    if (!realId) {
      if (
        !selectedModel.ref.current ||
        !flat.some((o) => o.value === selectedModel.ref.current)
      ) {
        selectedModel.set(flat[0]?.value ?? null);
      }
      return;
    }

    // Prefer live worker state when agent is already running (never cold-start here).
    let workerKey: string | null = null;
    let workerThinking: ThinkingLevel | null = null;
    try {
      const state = await useSessionsStore.getState().tryCommand(realId, {
        type: "get_state",
      });
      if (state !== undefined) {
        workerKey = modelKeyFromState(state);
        workerThinking = thinkingFromState(state, isThinkingLevel);
        useSessionsStore.getState().applyContextFromState(realId, state);
      }
    } catch {
      // ignore sync failures
    }

    if (workerKey && flat.some((o) => o.value === workerKey)) {
      selectedModel.set(workerKey);
      rememberModel(realId, workerKey);
    } else if (remembered && flat.some((o) => o.value === remembered)) {
      selectedModel.set(remembered);
    } else if (
      !selectedModel.ref.current ||
      !flat.some((o) => o.value === selectedModel.ref.current)
    ) {
      selectedModel.set(flat[0]?.value ?? null);
    }

    // Only push model to a live worker — first prompt cold-starts the agent.
    if (selectedModel.ref.current && workerKey !== null) {
      const token = `${realId}::${selectedModel.ref.current}`;
      if (workerKey !== selectedModel.ref.current || appliedModelForSessionRef.current !== token) {
        appliedModelForSessionRef.current = null;
        await applySelectedModel({ allowStart: false });
      } else {
        appliedModelForSessionRef.current = token;
        rememberModel(realId, selectedModel.ref.current);
      }
    }

    // 界面与 worker 各自保留档位；不一致（如会话切换）时把界面值同步过去。
    if (rememberedThinking) {
      thinking.set(rememberedThinking);
    } else if (workerThinking) {
      adoptThinking(workerThinking, realId);
    }
    if (workerThinking !== null && workerThinking !== thinking.ref.current) {
      try {
        const result = await useSessionsStore.getState().tryCommand(realId, {
          type: "set_thinking_level",
          level: thinking.ref.current,
        });
        adoptThinkingResult(thinking.ref.current, result, realId);
      } catch {
        // ignore thinking sync failures
      }
    }
  }

  async function applySelectedModel(opts?: { allowStart?: boolean }): Promise<void> {
    const sessionsState = useSessionsStore.getState();
    const id = sessionsState.activeId;
    const value = selectedModel.ref.current;
    if (!id || !value) return;
    // Session must be registered in the broker (present in live sessions list).
    if (!sessionsState.sessions.some((s) => s.id === id)) return;
    const slash = value.indexOf("/");
    if (slash <= 0) return;
    const token = `${id}::${value}`;
    if (appliedModelForSessionRef.current === token) return;
    const allowStart = opts?.allowStart === true;
    try {
      const command = {
        type: "set_model" as const,
        provider: value.slice(0, slash),
        modelId: value.slice(slash + 1),
      };
      if (allowStart) {
        await useSessionsStore.getState().sendCommand(id, command);
      } else {
        const applied = await useSessionsStore.getState().tryCommand(id, command);
        if (applied === undefined) {
          // No live worker yet — keep UI selection; first prompt will apply.
          rememberModel(id, value);
          return;
        }
      }
      appliedModelForSessionRef.current = token;
      rememberModel(id, value);
    } catch (err) {
      appliedModelForSessionRef.current = null;
      const text = err instanceof Error ? err.message : String(err);
      // Startup race / cold worker / post-auth reload: don't toast transient noise.
      if (/unknown session|Model not found/i.test(text)) return;
      messageApi.error(formatLlmError(text, getLocale()));
    }
  }

  async function onModelChange(value: string | number): Promise<void> {
    // Switching models while Pi is replying is allowed. The worker applies it to
    // the live session immediately (and when no worker is warm the choice is
    // remembered for the next prompt), so the picker must not silently swallow
    // the click.
    const key = String(value);
    selectedModel.set(key);
    appliedModelForSessionRef.current = null;
    const prefsKeyValue = currentPrefsKey();
    if (prefsKeyValue && key) rememberModel(prefsKeyValue, key);
    await applySelectedModel({ allowStart: false });
  }

  /** 快捷键：循环到下一个模型 / 思考等级。 */
  const cycleModel = useCallback((): void => {
    const options = flatModelOptions(availableModels.ref.current);
    if (!options.length) return;
    const index = options.findIndex((o) => o.value === selectedModel.ref.current);
    const next = options[(index + 1) % options.length];
    if (next) void onModelChange(next.value);
  }, [availableModels, selectedModel]);

  const cycleThinking = useCallback((): void => {
    const index = THINKING_LEVELS.findIndex((o) => o.value === thinking.ref.current);
    const next = THINKING_LEVELS[(index + 1) % THINKING_LEVELS.length];
    if (next) void onThinkingChange(next.value);
  }, [thinking]);

  /**
   * Paste into the composer: only image bitmaps are attached. http(s) URLs,
   * file paths and any other text stay plain text — the path→tag behavior is
   * reserved for drag & drop (ingestTransferData), not paste. Rich HTML from
   * Word/browsers is always stripped to plain text so styles cannot leak into
   * the contenteditable surface.
   */
  /** Extract the first http(s) <img src> from pasted HTML (web images). */
  function imgUrlFromHtml(html: string): string | null {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const img = doc.querySelector("img[src]");
    const src = img?.getAttribute("src")?.trim() ?? "";
    return src && isHttpUrl(src) ? src : null;
  }

  function onPaste(event: ReactClipboardEvent<HTMLDivElement>): void {
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
      // of leaving an unreadable URL.
      const html = data.getData("text/html") ?? "";
      const htmlImgUrl = html ? imgUrlFromHtml(html) : null;
      if (htmlImgUrl) {
        event.preventDefault();
        void useComposerStore.getState().addImageFromUrl(htmlImgUrl).then((ok) => {
          if (!ok) messageApi.warning(t.pasteImageDownloadFailed);
        });
        return;
      }

      // Strip Word/browser formatting: never let contenteditable insert styled HTML.
      const plain = plainTextFromClipboard(data.getData("text/plain") ?? "", html);
      // 空白同样是用户复制的内容（缩进、空格），逐字插入，不能因 trim 为空就丢弃。
      if (!plain) return;
      event.preventDefault();
      richEditorRef.current?.insertTextAtCaret(plain);
    } catch (err) {
      // Never let a paste handler exception swallow the user's clipboard.
      console.warn("[composer] onPaste error", err);
    }
  }

  function onModelsChanged(): void {
    void refreshModels();
  }

  useEffect(() => {
    useComposerStore.getState().bindSession(useSessionsStore.getState().activeId);
    void refreshModels();
    window.addEventListener("pi-models-changed", onModelsChanged);
    return () => {
      window.removeEventListener("pi-models-changed", onModelsChanged);
    };
  }, []);

  useEffect(() => {
    useKeybindingsStore.getState().register("cycle-model", cycleModel);
    useKeybindingsStore.getState().register("cycle-thinking", cycleThinking);
    return () => {
      useKeybindingsStore.getState().unregister("cycle-model");
      useKeybindingsStore.getState().unregister("cycle-thinking");
    };
  }, [cycleModel, cycleThinking]);

  useEffect(() => {
    const id = sessionId;
    const prev = prevSessionIdRef.current;
    if (!sessionWatchReadyRef.current) {
      sessionWatchReadyRef.current = true;
      prevSessionIdRef.current = id;
      return;
    }
    prevSessionIdRef.current = id;
    if (useChatStore.getState().pendingUserEdit) {
      useChatStore.getState().cancelEditUser();
    }
    useComposerStore.getState().bindSession(id);

    // 草稿首次发送成功建出真实会话：把草稿的模型/思考选择迁移过去。
    if (id && !prev && draftCommitPendingRef.current) {
      draftCommitPendingRef.current = false;
      const draftModel = prefs.ref.current.models[DRAFT_PREF_KEY];
      const draftThinking = prefs.ref.current.thinking[DRAFT_PREF_KEY];
      if (draftModel) rememberModel(id, draftModel);
      if (draftThinking) rememberThinking(id, draftThinking);
      forgetPrefs(DRAFT_PREF_KEY);
    }

    if (prev && selectedModel.ref.current) {
      rememberModel(prev, selectedModel.ref.current);
    }
    if (prev) {
      rememberThinking(prev, thinking.ref.current);
    }
    appliedModelForSessionRef.current = null;
    // Restore remembered UI immediately before async sync
    if (id && prefs.ref.current.models[id]) {
      selectedModel.set(prefs.ref.current.models[id]);
    }
    if (id && prefs.ref.current.thinking[id]) {
      thinking.set(prefs.ref.current.thinking[id]);
    } else if (id) {
      // 新会话没有记忆时沿用当前档位，不因 worker 默认值回退。
      rememberThinking(id, thinking.ref.current);
    }
    void refreshModels();
  }, [sessionId]);

  /** After a turn finishes — or when queue gains items while already idle — flush follow-ups. */
  useEffect(() => {
    const was = prevRunningRef.current;
    const now = running;
    prevRunningRef.current = now;
    if (was && !now && sessionId) {
      void drainQueueIfIdle(sessionId);
    }
  }, [running]);

  useEffect(() => {
    if (!queueWatchReadyRef.current) {
      queueWatchReadyRef.current = true;
      return;
    }
    const id = currentSessionId();
    if (queueItems.length > 0 && id && !isRunning()) {
      void drainQueueIfIdle(id);
    }
  }, [queueItems.length]);

  useEffect(() => {
    const ctx = atFileContext;
    if (atFileRefreshTimerRef.current) {
      clearTimeout(atFileRefreshTimerRef.current);
      atFileRefreshTimerRef.current = null;
    }
    if (!ctx) {
      atFileItems.set([]);
      return;
    }
    // Bare `@` loads immediately; typed queries debounce slightly.
    const delay = ctx.query.trim() ? 80 : 0;
    atFileRefreshTimerRef.current = setTimeout(() => {
      atFileRefreshTimerRef.current = null;
      void refreshAtFileItems(ctx.query);
    }, delay);
    return () => {
      if (atFileRefreshTimerRef.current) {
        clearTimeout(atFileRefreshTimerRef.current);
        atFileRefreshTimerRef.current = null;
      }
    };
  }, [atFileContext?.atIndex, atFileContext?.query]);

  useEffect(() => {
    if (!slashContext) return;
    void ensureSlashSkills();
  }, [slashContext?.slashIndex, slashContext?.query]);

  useEffect(() => {
    void window.api.window.platform().then((p) => {
      // Windows + default macOS APFS volumes are case-insensitive.
      pathCaseInsensitive.set(p === "win32" || p === "darwin");
    });
  }, []);

  const ctxPopoverContent = (
    <div className={styles.ctxPopover}>
      <div className={styles.ctxPopSummary}>
        <span className={styles.ctxPopFull}>{contextFullLabel}</span>
        <span className={styles.ctxPopPair}>{contextTokensPairLabel}</span>
        {contextCostLabel ? (
          <span className={styles.ctxPopCost}>
            <span className={styles.ctxPopCostLabel}>{t.contextUsageCost}</span>
            {contextCostLabel}
          </span>
        ) : null}
      </div>
      <div className={styles.ctxBar} aria-hidden="true">
        {contextSegments.map((seg) => (
          <span
            key={seg.id}
            className={styles.ctxBarSeg}
            style={{ width: `${seg.widthPct}%`, background: seg.color }}
            title={`${seg.label}: ${seg.tokensLabel}`}
          />
        ))}
        {contextFreePct > 0.5 ? (
          <span className={styles.ctxBarSegFree} style={{ width: `${contextFreePct}%` }} />
        ) : null}
      </div>
      {contextSegments.length ? (
        <div className={styles.ctxLegend}>
          {contextSegments.map((seg) => (
            <div key={`leg-${seg.id}`} className={styles.ctxLegendRow}>
              <span className={styles.ctxSwatch} style={{ background: seg.color }} />
              <span className={styles.ctxLegendLabel}>{seg.label}</span>
              <strong>{seg.tokensLabel}</strong>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.ctxPopHint}>{t.contextUsageEmpty}</div>
      )}
      <div className={styles.ctxPopMeta}>
        <div className={styles.ctxPopRow}>
          <span>{t.contextUsageMessages}</span>
          <strong>{contextMessageCount}</strong>
        </div>
        <div className={styles.ctxPopRow}>
          <span>{t.contextUsageTools}</span>
          <strong>{contextToolCount}</strong>
        </div>
        <div className={styles.ctxPopRow}>
          <span>{t.contextUsageSkills}</span>
          <strong>{skillsCount.value ?? "—"}</strong>
        </div>
      </div>
      {showCompactButton ? (
        <Button
          size="small"
          color="primary"
          variant="outlined"
          block
          className={`${styles.ctxCompactBtn} ${
            contextNeedsCompact ? styles.ctxCompactUrgent : ""
          }`}
          disabled={!sessionId || running || compactBusy.value}
          loading={compactBusy.value}
          onClick={() => void onCompactContext()}
        >
          {contextNeedsCompact ? <span className={styles.ctxCompactDot} /> : null}
          {t.compactContext}
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className={styles.wrap}>
      <SendQueueBar
        items={queueItems}
        editingId={queueEditingId}
        onEdit={(qid) => beginEditQueueItem(qid)}
        onRemove={(qid) => {
          const id = currentSessionId();
          if (id) useSendQueueStore.getState().remove(id, qid);
        }}
        onSendNow={(qid) => void sendQueuedNow(qid)}
      />
      {isEditingQueue ? (
        <div className={styles.queueEditBanner}>
          <span>{t.queueEditingHint}</span>
          <button
            type="button"
            className={styles.queueEditDiscard}
            onClick={discardQueueEdit}
          >
            {t.queueDiscardEdit}
          </button>
        </div>
      ) : isEditingPublished ? (
        <div className={styles.queueEditBanner}>
          <span>{t.editingPublishedHint}</span>
          <button
            type="button"
            className={styles.queueEditDiscard}
            onClick={discardPublishedEdit}
          >
            {t.discardPublishedEdit}
          </button>
        </div>
      ) : null}
      <div
        className={`composer-card ${styles.card} ${
          editorExpanded.value ? styles.isEditorExpanded : ""
        } ${fileDragOver.value ? styles.isFileDragOver : ""} ${
          docked ? styles.docked : ""
        }`}
        onDragOver={onComposerDragOver}
        onDragLeave={onComposerDragLeave}
        onDrop={onComposerDrop}
      >
        <button
          type="button"
          className={styles.composerExpandBtn}
          title={editorExpanded.value ? t.composerCollapse : t.composerExpand}
          aria-label={editorExpanded.value ? t.composerCollapse : t.composerExpand}
          onClick={(e) => {
            e.stopPropagation();
            editorExpanded.set(!editorExpanded.value);
          }}
        >
          {editorExpanded.value ? <ContractOutline size={14} /> : <ExpandOutline size={14} />}
        </button>

        {/* 草稿态：在输入框左上方选择新会话的工作区与（若有）Git 分支。 */}
        {isDraftSession ? <DraftContextBar /> : null}

        {/* Images are separate attachments (sent as model images), not part of the rich text surface */}
        {composer.images.length ? (
          <div className={styles.imageAttachments}>
            {composer.images.map((img) => (
              <div key={img.id} className={`img-chip ${styles.imgChip}`}>
                <Image
                  className={styles.imgPreview}
                  src={img.previewUrl}
                  alt=""
                  preview={{ src: img.previewUrl }}
                />
                <button
                  type="button"
                  className={styles.imgX}
                  title="remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    useComposerStore.getState().removeImage(img.id);
                  }}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {/* Path/url/element chips + text share one contenteditable surface. */}
        <div className={styles.richEditor} onPaste={onPaste} onClick={focusDraft}>
          <ComposerSlashMenu
            ref={slashMenuRef}
            visible={slashMenuOpen}
            items={slashItems}
            onSelect={(item) => void onSlashSelect(item)}
          />
          <ComposerAtFileMenu
            ref={atFileMenuRef}
            visible={atFileMenuOpen}
            items={atFileItems.value}
            emptyHint={atFileEmptyHint}
            onSelect={(item) => void onAtFileSelect(item)}
          />
          <ComposerRichEditor
            ref={richEditorRef}
            expanded={editorExpanded.value}
            onKeyDown={onKeydown}
          />
        </div>

        <div className={styles.composerFooter}>
          <div className={styles.toolbar}>
            <div className={styles.toolbarLeft}>
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  const input = e.target as HTMLInputElement;
                  if (input.files) void addFiles(input.files);
                  input.value = "";
                }}
              />
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: attachMenu,
                  onClick: ({ key }) => void onAttachSelect(key),
                }}
              >
                <Button type="text" size="small" title={t.composerAttach} icon={<AddOutline />} />
              </Dropdown>

              <Popover
                open={modeBubbleOpen.value}
                onOpenChange={(next) => modeBubbleOpen.set(next)}
                trigger="click"
                placement="topLeft"
                styles={RAW_POPOVER_STYLES}
                content={
                  <div className={styles.modeBubble} role="listbox" aria-label={t.composerModeHint}>
                    {modeMenuItems.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        className={`${styles.modeOption} ${
                          composer.mode === item.value ? styles.active : ""
                        }`}
                        role="option"
                        aria-selected={composer.mode === item.value}
                        onClick={() => onModePick(item.value)}
                      >
                        <div className={styles.modeOptionMain}>
                          <span className={styles.modeOptionName}>
                            {item.label}
                            {item.tag && item.tag !== item.label ? (
                              <span className={styles.modeOptionTag}>{item.tag}</span>
                            ) : null}
                          </span>
                          <span className={styles.modeOptionHint}>{item.hint}</span>
                        </div>
                        {composer.mode === item.value ? (
                          <CheckmarkOutline size={14} className={styles.modeOptionCheck} />
                        ) : null}
                      </button>
                    ))}
                  </div>
                }
              >
                <Button
                  type="text"
                  size="small"
                  className={styles.modeBtn}
                  title={t.composerModeHint}
                  aria-expanded={modeBubbleOpen.value}
                  aria-haspopup="true"
                >
                  <span className={styles.modeLabel}>{activeModeLabel}</span>
                </Button>
              </Popover>

              <Dropdown
                open={modelMenuOpen.value}
                onOpenChange={(next) => modelMenuOpen.set(next)}
                trigger={["click"]}
                menu={{
                  ...MODEL_MENU_PROPS,
                  items: modelMenu,
                  onClick: ({ key }) => void onModelChange(key),
                }}
              >
                <Button
                  type="text"
                  size="small"
                  className={styles.modelBtn}
                  title={t.modelPlaceholder}
                >
                  <span className={styles.modelLabel}>{modelLabel}</span>
                </Button>
              </Dropdown>

              <Dropdown
                trigger={["click"]}
                menu={{
                  items: thinkingMenu,
                  onClick: ({ key }) => void onThinkingChange(key),
                }}
              >
                <Button
                  type="text"
                  size="small"
                  className={styles.thinkBtn}
                  title={t.thinkingLevel}
                >
                  <span className={styles.thinkLabel}>{thinkingLabel}</span>
                </Button>
              </Dropdown>
            </div>

            <div className={styles.toolbarRight}>
              <Popover
                open={ctxPopoverOpen.value}
                onOpenChange={(next) => {
                  ctxPopoverOpen.set(next);
                  if (next) void loadSkillsCount();
                }}
                trigger="click"
                placement="topRight"
                content={ctxPopoverContent}
              >
                <button
                  type="button"
                  className={`${styles.ctxMeter} ${styles[TONE_CLASS[contextTone]] ?? ""}`}
                  disabled={!sessionId}
                  title={t.contextUsageTitle}
                  aria-label={t.contextUsageTitle}
                >
                  <svg
                    className={styles.ctxRing}
                    width="18"
                    height="18"
                    viewBox="0 0 18 18"
                    aria-hidden="true"
                  >
                    <circle
                      className={styles.ctxRingTrack}
                      cx="9"
                      cy="9"
                      r="7"
                      fill="none"
                      strokeWidth="2"
                    />
                    <circle
                      className={styles.ctxRingFill}
                      cx="9"
                      cy="9"
                      r="7"
                      fill="none"
                      strokeWidth="2"
                      strokeLinecap="round"
                      transform="rotate(-90 9 9)"
                      style={contextRingStyle}
                    />
                  </svg>
                </button>
              </Popover>
              {showPrimaryAction ? (
                <Button
                  size="small"
                  shape="circle"
                  type="primary"
                  danger={primaryIsStop}
                  loading={stopping}
                  disabled={
                    !primaryIsStop && !hasSendContent && !(isEditingQueue && hasSendContent)
                  }
                  aria-label={
                    stopping
                      ? t.stopping
                      : primaryIsStop
                        ? t.stop
                        : isEditingQueue
                          ? t.queueSave
                          : t.enterToSendShiftNewline
                  }
                  title={
                    stopping
                      ? t.stopping
                      : !primaryIsStop && isEditingQueue
                        ? t.queueSave
                        : undefined
                  }
                  onClick={onPrimaryAction}
                  icon={primaryIsStop ? <StopOutline /> : <SendOutline />}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {showSessionDetails && sessionStats ? (
        <div
          className={styles.sessionStats}
          role="status"
          aria-label="session statistics"
        >
          {sessionStats.map((item) => (
            <span key={item.key} className={styles.ssItem} title={item.title}>
              <span className={styles.ssLabel}>{item.label}</span>
              <strong>{item.value}</strong>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default Composer;
