import { memo, useRef, type ReactNode } from "react";
import { Button, Dropdown, Spin } from "antd";
import type { MenuProps } from "antd";
import {
  AddOutline,
  ContractOutline,
  DocumentOutline,
  ExpandOutline,
  ReturnArrowOutline,
  StopOutline,
} from "@renderer/components/icons/ionicons";
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
import { NO_OVERLAY_MOTION } from "@renderer/components/overlay-motion";
import { useChatStore } from "@renderer/stores/chat";
import { useComposerStore } from "@renderer/stores/composer";
import { useSendQueueStore } from "@renderer/stores/send-queue";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useSendShortcutStore } from "@renderer/stores/send-shortcut";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useI18n } from "@renderer/i18n/use-i18n";
import { MODEL_MENU_PROPS } from "@renderer/model-menu";
import {
  parseAtFileContext,
  replaceAtFileMention,
} from "../../../shared/at-file-mention";
import { parseSlashContext } from "../../../shared/slash-commands";
import {
  bareBuiltinSlashDraft,
  bareOmpClientSlashDraft,
  bareOmpCommandDraft,
  bareSkillCommandDraft,
} from "./composer/composer-drafts";
import { useComposerModels } from "./composer/use-composer-models";
import { useComposerAttachments } from "./composer/use-composer-attachments";
import { useAtFileMenu } from "./composer/use-at-file-menu";
import { useSlashMenu } from "./composer/use-slash-menu";
import { useComposerSend } from "./composer/use-composer-send";
import { ComposerAttachments } from "./composer/ComposerAttachments";
import { ComposerContextMeter } from "./composer/ComposerContextMeter";
import { ComposerEditBanner } from "./composer/ComposerEditBanner";
import { useLatest } from "./composer/use-latest";
import styles from "./Composer.module.css";

export type ComposerProps = {
  docked?: boolean;
};

export function Composer({ docked = false }: ComposerProps): ReactNode {
  const t = useI18n();
  const composer = useComposerStore();

  const chatRunning = useChatStore((s) => s.activeRunning);
  const chatStopping = useChatStore((s) => s.activeStopping);
  const pendingUserEdit = useChatStore((s) => s.pendingUserEdit);
  const sessionId = useSessionsStore((s) => s.activeId);
  const draftRoot = useSessionsStore((s) => s.draftRoot);
  const sendShortcut = useSendShortcutStore((s) => s.mode);
  const activeSessionStatus = useSessionsStore((s) => {
    const id = s.activeId;
    if (!id) return null;
    return s.sessions.find((x) => x.id === id)?.status ?? null;
  });
  const workspaceRoot = useWorkspaceStore((s) => s.root);
  const agentBackend = useWorkspaceStore((s) => s.backend);
  const queueItems = useSendQueueStore((s) => s.activeItems);
  const queueEditingId = useSendQueueStore((s) => s.editingId);

  const richEditorRef = useRef<ComposerRichEditorHandle | null>(null);
  const slashMenuRef = useRef<ComposerSlashMenuHandle | null>(null);
  const atFileMenuRef = useRef<ComposerAtFileMenuHandle | null>(null);
  const draftCommitPendingRef = useRef(false);
  const editorExpanded = useLatest(false);

  const isDraftSession = !sessionId && Boolean(draftRoot);
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

  function focusDraft(): void {
    richEditorRef.current?.focus();
  }

  function focusDraftAtEnd(): void {
    richEditorRef.current?.focusEnd();
    richEditorRef.current?.scrollToEnd();
  }

  const models = useComposerModels({ sessionId, draftCommitPendingRef });

  const attachments = useComposerAttachments({
    root: workspaceRoot ?? "",
    richEditorRef,
  });

  const slash = useSlashMenu({
    draft: composer.draft,
    agentBackend,
    workspaceRoot: workspaceRoot ?? "",
    focusDraft,
    focusDraftAtEnd,
    openModelMenu: () => models.modelMenuOpen.set(true),
  });

  const atFiles = useAtFileMenu({
    draft: composer.draft,
    workspaceRoot: workspaceRoot ?? "",
    disabled: Boolean(slash.slashContext),
    focusDraft,
  });

  const send = useComposerSend({
    sessionId,
    running,
    hasSendContent,
    isEditingPublished,
    models,
    slash,
    draftCommitPendingRef,
    focusDraftAtEnd,
  });

  const attachMenu: MenuProps["items"] = [
    {
      label: t.composerAttachFile,
      key: "file",
      icon: <DocumentOutline />,
    },
  ];

  async function onAttachSelect(key: string | number): Promise<void> {
    if (String(key) === "file") {
      const picked = await window.api.preview.pickFile();
      if (picked) useComposerStore.getState().addFileTag(picked);
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    const draft = useComposerStore.getState().draft;
    const ctx = parseSlashContext(draft);
    const atCtx = parseAtFileContext(draft);

    if (slash.slashMenuOpen) {
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
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.isComposing
      ) {
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

    if (atFiles.atFileMenuOpen) {
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
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.isComposing
      ) {
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

    // 选中的组合键发送，其余组合键换行；Enter 一直是换行候选项。
    if (sendShortcut === "ctrl-enter") {
      if (!event.ctrlKey && !event.metaKey) return;
    } else if (sendShortcut === "shift-enter") {
      if (!event.shiftKey) return;
    } else if (event.shiftKey) return;

    event.preventDefault();
    if (useSendQueueStore.getState().editingId) {
      send.saveEditingToQueue();
      return;
    }
    // 菜单未覆盖的裸内置命令也要执行，运行中不能进入发送队列。
    const builtin = bareBuiltinSlashDraft(draft);
    if (builtin) {
      useComposerStore.getState().clear();
      void slash.runSlashBuiltin(builtin);
      return;
    }
    const clientSlash = bareOmpClientSlashDraft(draft, agentBackend);
    if (clientSlash) {
      slash.runOmpClientSlash(clientSlash);
      return;
    }
    if (slash.runBarePiCommand()) return;
    if (send.confirmDangerousOmpCommand()) return;
    if (send.isRunning()) {
      if (
        (bareOmpCommandDraft(draft, agentBackend) || bareSkillCommandDraft(draft)) &&
        slash.sendBareOmpCommandNow()
      ) {
        return;
      }
      send.enqueueFromComposer();
      return;
    }
    // Empty composer + queued sends: Enter flushes the first queued item
    // (Cursor-like — the queue bar shows what will go next).
    const activeId = useSessionsStore.getState().activeId;
    if (!hasSendContent && activeId && useSendQueueStore.getState().activeItems.length > 0) {
      void send.drainQueueIfIdle(activeId);
      return;
    }
    void send.submit("prompt");
  }

  return (
    <div className={styles.wrap}>
      <SendQueueBar
        items={queueItems}
        editingId={queueEditingId}
        onEdit={(qid) => send.beginEditQueueItem(qid)}
        onRemove={(qid) => {
          const id = useSessionsStore.getState().activeId;
          if (id) useSendQueueStore.getState().remove(id, qid);
        }}
        onSendNow={(qid) => void send.sendQueuedNow(qid)}
      />
      {isEditingQueue ? (
        <ComposerEditBanner
          hint={t.queueEditingHint}
          actionLabel={t.queueDiscardEdit}
          onAction={send.discardQueueEdit}
        />
      ) : isEditingPublished ? (
        <ComposerEditBanner
          hint={t.editingPublishedHint}
          actionLabel={t.discardPublishedEdit}
          onAction={send.discardPublishedEdit}
        />
      ) : null}
      <div
        className={`composer-card ${styles.card} ${
          editorExpanded.value ? styles.isEditorExpanded : ""
        } ${attachments.fileDragOver.value ? styles.isFileDragOver : ""} ${
          docked ? styles.docked : ""
        }`}
        onDragOver={attachments.onComposerDragOver}
        onDragLeave={attachments.onComposerDragLeave}
        onDrop={attachments.onComposerDrop}
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

        <ComposerAttachments
          images={composer.images}
          removeLabel={t.remove}
          onRemove={(id) => useComposerStore.getState().removeImage(id)}
        />

        {/* Path/url/element chips + text share one contenteditable surface. */}
        <div className={styles.richEditor} onPaste={attachments.onPaste} onClick={focusDraft}>
          <ComposerSlashMenu
            ref={slashMenuRef}
            visible={slash.slashMenuOpen}
            items={slash.slashItems}
            onSelect={(item) => void slash.onSlashSelect(item)}
          />
          <ComposerAtFileMenu
            ref={atFileMenuRef}
            visible={atFiles.atFileMenuOpen}
            items={atFiles.atFileItems.value}
            emptyHint={atFiles.atFileEmptyHint}
            onSelect={(item) => void atFiles.onAtFileSelect(item)}
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
                  if (input.files) void attachments.addFiles(input.files);
                  input.value = "";
                }}
              />
              <Dropdown
                {...NO_OVERLAY_MOTION}
                trigger={["click"]}
                menu={{
                  items: attachMenu,
                  onClick: ({ key }) => void onAttachSelect(key),
                }}
              >
                <Button type="text" size="small" title={t.composerAttach} icon={<AddOutline />} />
              </Dropdown>

              <Dropdown
                {...NO_OVERLAY_MOTION}
                open={models.modelMenuOpen.value}
                onOpenChange={models.onModelMenuOpenChange}
                trigger={["click"]}
                menu={{
                  ...MODEL_MENU_PROPS,
                  items: models.modelMenu,
                  onClick: ({ key }) => void models.onModelChange(key),
                }}
              >
                <Button
                  type="text"
                  size="small"
                  className={styles.modelBtn}
                  title={t.modelPlaceholder}
                  onClick={models.onModelMenuToggle}
                >
                  <span className={styles.modelLabel}>{models.modelLabel}</span>
                </Button>
              </Dropdown>

              <Dropdown
                {...NO_OVERLAY_MOTION}
                trigger={["click"]}
                menu={{
                  items: models.thinkingMenu,
                  onClick: ({ key }) => void models.onThinkingChange(key),
                }}
              >
                <Button
                  type="text"
                  size="small"
                  className={styles.thinkBtn}
                  title={t.thinkingLevel}
                >
                  <span className={styles.thinkLabel}>{models.thinkingLabel}</span>
                </Button>
              </Dropdown>
            </div>

            <div className={styles.toolbarRight}>
              <ComposerContextMeter sessionId={sessionId} running={running} />
              {showPrimaryAction ? (
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={
                    stopping || (!primaryIsStop && !hasSendContent && !(isEditingQueue && hasSendContent))
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
                  onClick={send.onPrimaryAction}
                >
                  {stopping ? (
                    <Spin size="small" />
                  ) : primaryIsStop ? (
                    <StopOutline size={18} />
                  ) : (
                    <ReturnArrowOutline size={18} />
                  )}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

export default memo(Composer);
