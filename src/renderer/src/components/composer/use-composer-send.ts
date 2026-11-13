import { useEffect, useRef, type MutableRefObject } from "react";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useDialog, useMessage } from "@renderer/services/feedback";
import { useChatStore } from "@renderer/stores/chat";
import { useComposerStore } from "@renderer/stores/composer";
import {
  useSendQueueStore,
  type QueuedSendItem,
} from "@renderer/stores/send-queue";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { heuristicSessionTitle } from "@renderer/utils/session-title";
import { nextFrame } from "@renderer/components/next-frame";
import {
  displayTextFor,
  planComposerTags,
  queueItemHasContent,
  queueMessageText,
  steerTextWithCitations,
  titleSeedFor,
} from "@renderer/utils/composer-payload";
import type { ElementCitation } from "../../../../shared/protocol";
import type { LegacyModeTagKind } from "../../../../shared/injected-blocks";
import { expandCommandText } from "../../../../shared/slash-command-template";
import { clampThinkingLevel } from "@renderer/utils/thinking-level";
import {
  DANGEROUS_OMP_COMMANDS,
  bareBuiltinSlashDraft,
  bareOmpClientSlashDraft,
  bareOmpCommandDraft,
  bareSkillCommandDraft,
} from "./composer-drafts";
import type { useComposerModels } from "./use-composer-models";
import type { useSlashMenu } from "./use-slash-menu";

type ComposerSnapshot = {
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
        kind?: "file" | "url" | "element" | LegacyModeTagKind;
      }[]
    | undefined;
};

type Params = {
  sessionId: string | null;
  running: boolean;
  hasSendContent: boolean;
  isEditingPublished: boolean;
  models: ReturnType<typeof useComposerModels>;
  slash: ReturnType<typeof useSlashMenu>;
  draftCommitPendingRef: MutableRefObject<boolean>;
  focusDraftAtEnd: () => void;
};

/**
 * 发送链路：队列增删/编辑、steer、提交、自动排空。
 *
 * 拆自原 Composer 巨型组件；会话绑定与模型同步仍在 useComposerModels，
 * 斜杠命令执行仍在 useSlashMenu，这里只负责把它们编排成一次发送。
 */
export function useComposerSend({
  sessionId,
  running,
  hasSendContent,
  isEditingPublished,
  models,
  slash,
  draftCommitPendingRef,
  focusDraftAtEnd,
}: Params) {
  const t = useI18n();
  const messageApi = useMessage();
  const dialog = useDialog();
  const queueItems = useSendQueueStore((s) => s.activeItems);

  const drainInFlightRef = useRef<string | null>(null);
  const queueWatchReadyRef = useRef(false);
  const prevRunningRef = useRef(false);

  const { applySelectedModel, allowedThinkingLevels, adoptThinking, adoptThinkingResult, thinking, prefsKeyOf } =
    models;
  const {
    runSlashBuiltin,
    runBarePiCommand,
    runOmpClientSlash,
    sendBareOmpCommandNow,
    tryConsumeBuiltinSlashDraft,
    slashCatalog,
  } = slash;

  function currentSessionId(): string | null {
    return useSessionsStore.getState().activeId;
  }

  function isRunning(): boolean {
    const chatState = useChatStore.getState();
    if (chatState.activeRunning) return true;
    const sessionsState = useSessionsStore.getState();
    const id = sessionsState.activeId;
    if (!id) return false;
    return sessionsState.sessions.find((s) => s.id === id)?.status === "running";
  }

  function snapshotComposerPayload(): ComposerSnapshot | null {
    const store = useComposerStore.getState();
    const chipText = store.formatChipsForMessage();
    const displayText = store.draft.trim();
    const agentDraft = expandCommandText(displayText, slashCatalog.value.commands);
    const body = [agentDraft, chipText].filter(Boolean).join("\n\n");
    let text = body;
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
      if (action.kind === "file") {
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

    // Bare builtin slash (e.g. `/compact`) — run locally, do not prompt the model.
    // 必须排在引导分支前：运行中的输入仍是命令，不能被当成 steer 文本发给模型。
    if (mode === "prompt" && (await tryConsumeBuiltinSlashDraft())) return;

    const clientSlash = bareOmpClientSlashDraft(
      useComposerStore.getState().draft,
      useWorkspaceStore.getState().backend,
    );
    if (mode === "prompt" && clientSlash) {
      runOmpClientSlash(clientSlash);
      return;
    }
    if (mode === "prompt" && runBarePiCommand()) return;

    // While agent is running, a plain send becomes guidance for the running turn
    // (steer) instead of waiting for the next turn. A pending re-edit is not
    // guidance: it truncates the turn, so it must go through the normal send.
    // omp 内建命令必须进入 worker 的命令通道，不能被 steer。
    if (
      isRunning() &&
      mode === "prompt" &&
      !isEditingPublished &&
      !bareOmpCommandDraft(
        useComposerStore.getState().draft,
        useWorkspaceStore.getState().backend,
      )
    ) {
      await steerFromComposer();
      return;
    }

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
      const level = clampThinkingLevel(
        thinking.ref.current,
        allowedThinkingLevels(models.selectedModel.ref.current),
      );
      if (level !== thinking.ref.current) adoptThinking(level, prefsKeyOf(id));
      void useSessionsStore
        .getState()
        .sendCommand(id, {
          type: "set_thinking_level",
          level,
        })
        .then((result) => adoptThinkingResult(level, result, prefsKeyOf(id)))
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

  async function onAbort(): Promise<void> {
    const id = currentSessionId();
    if (id) await useChatStore.getState().abort(id);
  }

  function onPrimaryAction(): void {
    if (useSendQueueStore.getState().editingId && !isRunning()) {
      saveEditingToQueue();
      return;
    }
    // 运行中点击发送也先执行裸内置命令，不能被排进发送队列。
    if (!useSendQueueStore.getState().editingId) {
      const draft = useComposerStore.getState().draft;
      const backend = useWorkspaceStore.getState().backend;
      const builtin = bareBuiltinSlashDraft(draft);
      if (builtin) {
        useComposerStore.getState().clear();
        void runSlashBuiltin(builtin);
        return;
      }
      const clientSlash = bareOmpClientSlashDraft(draft, backend);
      if (clientSlash) {
        runOmpClientSlash(clientSlash);
        return;
      }
      if (runBarePiCommand()) return;
      if (confirmDangerousOmpCommand()) return;
    }
    if (isRunning() && !hasSendContent) {
      void onAbort();
      return;
    }
    if (isRunning() && hasSendContent) {
      if (
        !useSendQueueStore.getState().editingId &&
        (bareOmpCommandDraft(
          useComposerStore.getState().draft,
          useWorkspaceStore.getState().backend,
        ) ||
          bareSkillCommandDraft(useComposerStore.getState().draft)) &&
        sendBareOmpCommandNow()
      ) {
        return;
      }
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

  /** 危险命令执行前确认；返回 true 表示已接管本次发送。 */
  function confirmDangerousOmpCommand(): boolean {
    const command = bareOmpCommandDraft(
      useComposerStore.getState().draft,
      useWorkspaceStore.getState().backend,
    );
    if (!command || !DANGEROUS_OMP_COMMANDS[command]) return false;
    if (useSendQueueStore.getState().editingId) return false;
    dialog.warning({
      title: t.slashDangerousTitle.replace("{command}", command),
      content: t.slashDangerousBody,
      positiveText: t.slashDangerousRun,
      negativeText: t.cancel,
      onPositiveClick: () => {
        if (isRunning()) sendBareOmpCommandNow();
        else void submit("prompt");
      },
    });
    return true;
  }

  /** After a turn finishes — or when queue gains items while already idle — flush follow-ups. */
  useEffect(() => {
    const was = prevRunningRef.current;
    const now = running;
    prevRunningRef.current = now;
    if (was && !now && sessionId) {
      void drainQueueIfIdle(sessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在 running 变化时排空，与原实现一致
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在队列长度变化时排空，与原实现一致
  }, [queueItems.length]);

  return {
    snapshotComposerPayload,
    enqueueFromComposer,
    steerFromComposer,
    saveEditingToQueue,
    discardQueueEdit,
    discardPublishedEdit,
    beginEditQueueItem,
    sendQueuedNow,
    drainQueueIfIdle,
    submit,
    onAbort,
    onPrimaryAction,
    onQueueSendClick,
    isRunning,
    isAgentBusy,
    confirmDangerousOmpCommand,
  };
}
