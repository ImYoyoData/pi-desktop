import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button, Input, Menu, Modal } from "antd";
import type { MenuProps } from "antd";
import {
  AddOutline,
  ChevronBackOutline,
  ChevronForwardOutline,
  CloseOutline,
  CreateOutline,
  DocumentTextOutline,
  GlobeOutline,
  PlayCircleOutline,
  TrashOutline,
} from "@renderer/components/icons/ionicons";
import { useRightTabsStore, type RightTab } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { gitCodeColor } from "@renderer/utils/editor-lang";
import { fileIcon, type FileIcon } from "@renderer/utils/file-icon";
import { localizedTabLabel } from "@renderer/utils/right-tab-labels";
import { useDialog } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./TabStrip.module.css";

type Props = {
  /** 该页面自己的标签（文件页是预览、浏览器页是浏览器）。 */
  tabs: RightTab[];
  activeId: string;
  onAdd?: () => void;
  addTitle?: string;
};

export function TabStrip({ tabs, activeId, onAdd, addTitle }: Props): ReactNode {
  const t = useI18n();
  const dialog = useDialog();
  const [ctxMenu, setCtxMenu] = useState({ show: false, x: 0, y: 0, tabId: null as string | null });
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [deletedTargetId, setDeletedTargetId] = useState<string | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const barRef = useRef<HTMLDivElement | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);

  const idsKey = tabs.map((tab) => tab.id).join("|");

  const fileGlyphs = useMemo(() => {
    const icons = new Map<string, FileIcon>();
    for (const tab of tabs) {
      if (tab.kind !== "preview" || !tab.filePath) continue;
      const icon = fileIcon(tab.filePath);
      let statusColor: string | undefined;
      if (tab.missing) statusColor = gitCodeColor("D");
      else if (tab.gitCode) statusColor = gitCodeColor(tab.gitCode);
      else if (tab.dirty) statusColor = gitCodeColor("M");
      icons.set(tab.id, statusColor ? { ...icon, color: statusColor } : icon);
    }
    return icons;
  }, [tabs]);

  function labelStyle(tab: RightTab): React.CSSProperties | undefined {
    if (tab.missing) return { color: gitCodeColor("D"), textDecoration: "line-through" };
    if (tab.gitCode) return { color: gitCodeColor(tab.gitCode) };
    if (tab.dirty) return { color: gitCodeColor("M") };
    return undefined;
  }

  function displayLabel(tab: RightTab): string {
    const base = localizedTabLabel(tab);
    if (tab.missing) return base;
    return tab.dirty ? `${base}*` : base;
  }

  function iconFor(tab: RightTab): ReactNode {
    if (tab.kind === "browser") return <GlobeOutline />;
    if (tab.kind === "running") return <PlayCircleOutline />;
    return <DocumentTextOutline />;
  }

  function updateScrollState(): void {
    const el = barRef.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    const max = el.scrollWidth - el.clientWidth;
    const overflow = max > 2;
    setCanScrollLeft(overflow && el.scrollLeft > 2);
    setCanScrollRight(overflow && el.scrollLeft < max - 2);
  }

  function scrollBy(dir: -1 | 1): void {
    const el = barRef.current;
    if (!el) return;
    const step = Math.max(120, Math.floor(el.clientWidth * 0.55));
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  }

  function onWheel(event: React.WheelEvent<HTMLDivElement>): void {
    const el = barRef.current;
    if (!el || el.scrollWidth <= el.clientWidth + 2) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (delta === 0) return;
    el.scrollLeft += delta;
    event.preventDefault();
    updateScrollState();
  }

  function onTabClose(id: string): void {
    const tab = tabs.find((item) => item.id === id);
    if (!tab) return;
    const store = useRightTabsStore.getState();
    if (tab.kind === "preview" && tab.missing) {
      setDeletedTargetId(id);
      return;
    }
    if (tab.kind === "preview" && tab.dirty && !tab.missing) {
      dialog.create({
        title: t.unsavedChangesTitle,
        content: t.unsavedChangesClose(tab.label),
        positiveText: t.save,
        negativeText: t.dontSave,
        onPositiveClick: async () => {
          const ok = await store.saveTab(id);
          if (ok) store.closeTab(id);
          return ok;
        },
        onNegativeClick: () => store.closeTab(id),
      });
      return;
    }
    store.closeTab(id);
  }

  function canRename(tab: RightTab): boolean {
    return tab.kind === "browser" || tab.kind === "preview" || tab.kind === "running";
  }

  function contextOptions(tab: RightTab): MenuProps["items"] {
    const items: MenuProps["items"] = [];
    if (canRename(tab)) items.push({ label: t.renameTab, key: "rename", icon: <CreateOutline /> });
    if (tab.kind !== "running") {
      items.push({ label: t.deleteTab, key: "delete", icon: <TrashOutline /> });
    }
    return items;
  }

  function openContextMenu(event: ReactMouseEvent, tab: RightTab): void {
    const options = contextOptions(tab);
    if (!options?.length) return;
    setCtxMenu({ show: true, x: event.clientX, y: event.clientY, tabId: tab.id });
  }

  function closeContextMenu(): void {
    setCtxMenu((current) => ({ ...current, show: false, tabId: null }));
  }

  function onContextSelect(key: string): void {
    const tab = tabs.find((item) => item.id === ctxMenu.tabId);
    closeContextMenu();
    if (!tab) return;
    if (key === "rename") {
      setRenameTargetId(tab.id);
      setRenameDraft(tab.label);
      setRenameOpen(true);
      return;
    }
    if (key === "delete") onTabClose(tab.id);
  }

  function submitRename(): void {
    const id = renameTargetId;
    const name = renameDraft.trim();
    setRenameOpen(false);
    setRenameTargetId(null);
    if (!id || !name) return;
    const store = useRightTabsStore.getState();
    store.renameTab(id, name);
    store.persistTabs(useWorkspaceStore.getState().root);
  }

  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      updateScrollState();
      return;
    }
    const observer = new ResizeObserver(() => updateScrollState());
    observer.observe(el);
    updateScrollState();
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => {
      const el = barRef.current?.querySelector<HTMLElement>(
        `.${styles.tabItem}[data-id="${activeId}"]`,
      );
      el?.scrollIntoView({ inline: "nearest", block: "nearest" });
      updateScrollState();
    });
  }, [activeId, idsKey]);

  useEffect(() => {
    if (!ctxMenu.show) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (ctxMenuRef.current?.contains(event.target as Node)) return;
      closeContextMenu();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeContextMenu();
    };
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [ctxMenu.show]);

  const ctxTab = tabs.find((tab) => tab.id === ctxMenu.tabId) ?? null;

  return (
    <div className={styles.strip}>
      <Button
        type="text"
        shape="circle"
        size="small"
        className={`pi-interactive ${styles.scrollBtn}`}
        disabled={!canScrollLeft}
        title={t.tabsScrollLeft}
        onClick={() => scrollBy(-1)}
        icon={<ChevronBackOutline size={14} />}
      />
      <div
        ref={barRef}
        className={`${styles.bar}${canScrollLeft ? ` ${styles.canScrollLeft}` : ""}${
          canScrollRight ? ` ${styles.canScrollRight}` : ""
        }`}
        onScroll={updateScrollState}
        onWheel={onWheel}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          const glyph = fileGlyphs.get(tab.id);
          const style = labelStyle(tab);
          const transient = tab.kind === "preview" && tab.transient !== false && !tab.dirty;
          return (
            <div
              key={tab.id}
              className={`${styles.tabItem}${isActive ? ` ${styles.active}` : ""}`}
              data-id={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => useRightTabsStore.getState().selectTab(tab.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                openContextMenu(event, tab);
              }}
            >
              {glyph ? (
                <span
                  className={styles.fileGlyph}
                  style={glyph.color ? { color: glyph.color } : undefined}
                  aria-hidden="true"
                >
                  {glyph.glyph}
                </span>
              ) : (
                <span className={styles.tabIcon} style={style} aria-hidden="true">
                  {iconFor(tab)}
                </span>
              )}
              <span
                className={transient ? `${styles.tabLabel} ${styles.transient}` : styles.tabLabel}
                style={style}
              >
                {displayLabel(tab)}
              </span>
              <button
                type="button"
                className={styles.tabClose}
                title={t.closeTab}
                onClick={(event) => {
                  event.stopPropagation();
                  onTabClose(tab.id);
                }}
              >
                <CloseOutline size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <Button
        type="text"
        shape="circle"
        size="small"
        className={`pi-interactive ${styles.scrollBtn}`}
        disabled={!canScrollRight}
        title={t.tabsScrollRight}
        onClick={() => scrollBy(1)}
        icon={<ChevronForwardOutline size={14} />}
      />
      {onAdd ? (
        <Button
          type="text"
          shape="circle"
          size="small"
          className="pi-interactive"
          title={addTitle ?? t.newTab}
          onClick={onAdd}
          icon={<AddOutline size={14} />}
        />
      ) : null}

      {ctxMenu.show
        ? createPortal(
            <div
              ref={ctxMenuRef}
              className={styles.ctxMenu}
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <Menu
                mode="vertical"
                items={ctxTab ? contextOptions(ctxTab) : []}
                onClick={({ key, domEvent }) => {
                  domEvent.stopPropagation();
                  onContextSelect(key);
                }}
              />
            </div>,
            document.body,
          )
        : null}

      <Modal
        open={renameOpen}
        title={t.renameTab}
        width={360}
        maskClosable
        okText={t.confirm}
        cancelText={t.cancel}
        onOk={submitRename}
        onCancel={() => setRenameOpen(false)}
      >
        <p className={styles.renameHint}>{t.renameTabPrompt}</p>
        <Input
          value={renameDraft}
          placeholder={t.renameTabPlaceholder}
          onChange={(event) => setRenameDraft(event.target.value)}
          onPressEnter={submitRename}
        />
      </Modal>

      <Modal
        open={deletedTargetId !== null}
        title={t.fileDeletedTitle}
        onCancel={() => setDeletedTargetId(null)}
        footer={[
          <Button key="cancel" size="small" onClick={() => setDeletedTargetId(null)}>
            {t.cancel}
          </Button>,
          <Button
            key="dont-save"
            size="small"
            onClick={() => {
              const id = deletedTargetId;
              setDeletedTargetId(null);
              if (id) useRightTabsStore.getState().closeTab(id);
            }}
          >
            {t.dontSave}
          </Button>,
          <Button
            key="save"
            size="small"
            type="primary"
            onClick={() => {
              const id = deletedTargetId;
              if (!id) return;
              void (async () => {
                const ok = await useRightTabsStore.getState().saveTab(id);
                if (!ok) return;
                setDeletedTargetId(null);
                useRightTabsStore.getState().closeTab(id);
              })();
            }}
          >
            {t.save}
          </Button>,
        ]}
      >
        {t.fileDeletedSavePrompt}
      </Modal>
    </div>
  );
}

export default TabStrip;
