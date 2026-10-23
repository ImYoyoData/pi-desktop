import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type {
  EditContextMenuAction,
  EditContextMenuPayload,
} from "../../../shared/context-menu";
import styles from "./AppContextMenu.module.css";

/** 自绘右键编辑菜单：跟随自定义外观（半透明/模糊），命令仍由主进程执行。 */
interface MenuEntry {
  action: EditContextMenuAction;
  label: string;
  accel: string;
  enabled: boolean;
}

const MARGIN = 8;

export function AppContextMenu(): ReactNode {
  const [menu, setMenu] = useState<EditContextMenuPayload | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const menuElRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<EditContextMenuPayload | null>(null);

  const isMac = navigator.userAgent.includes("Mac");

  const updateMenu = useCallback((next: EditContextMenuPayload | null): void => {
    menuRef.current = next;
    setMenu(next);
  }, []);

  const close = useCallback((): void => {
    updateMenu(null);
  }, [updateMenu]);

  const entries = useMemo<(MenuEntry | "separator")[]>(() => {
    const payload = menu;
    if (!payload) return [];
    const key = (win: string, mac: string): string => (isMac ? mac : win);
    const { labels } = payload;
    if (!payload.isEditable) {
      return [
        {
          action: "copy",
          label: labels.copy,
          accel: key("Ctrl+C", "⌘C"),
          enabled: payload.canCopy,
        },
      ];
    }
    return [
      { action: "undo", label: labels.undo, accel: key("Ctrl+Z", "⌘Z"), enabled: payload.canUndo },
      { action: "redo", label: labels.redo, accel: key("Ctrl+Y", "⇧⌘Z"), enabled: payload.canRedo },
      "separator",
      { action: "cut", label: labels.cut, accel: key("Ctrl+X", "⌘X"), enabled: payload.canCut },
      { action: "copy", label: labels.copy, accel: key("Ctrl+C", "⌘C"), enabled: payload.canCopy },
      { action: "paste", label: labels.paste, accel: key("Ctrl+V", "⌘V"), enabled: payload.canPaste },
      { action: "delete", label: labels.delete, accel: key("Delete", "⌫"), enabled: payload.canDelete },
      "separator",
      {
        action: "selectAll",
        label: labels.selectAll,
        accel: key("Ctrl+A", "⌘A"),
        enabled: payload.canSelectAll,
      },
    ];
  }, [isMac, menu]);

  const open = useCallback(
    (payload: EditContextMenuPayload): void => {
      updateMenu(payload);
      setPos({ x: payload.x, y: payload.y });
    },
    [updateMenu],
  );

  useLayoutEffect(() => {
    if (!menu) return;
    const el = menuElRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos((current) => ({
      x: Math.max(MARGIN, Math.min(current.x, window.innerWidth - width - MARGIN)),
      y: Math.max(MARGIN, Math.min(current.y, window.innerHeight - height - MARGIN)),
    }));
  }, [menu]);

  const pick = useCallback(
    (entry: MenuEntry): void => {
      if (!entry.enabled) return;
      void window.api.window.runContextMenuAction(entry.action);
      close();
    },
    [close],
  );

  useEffect(() => {
    const offContextMenu = window.api.window.onContextMenu((payload) => open(payload));
    const onPointerDown = (event: PointerEvent): void => {
      if (!menuRef.current) return;
      if (menuElRef.current?.contains(event.target as Node)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("wheel", close, { capture: true, passive: true });
    window.addEventListener("blur", close);
    return () => {
      offContextMenu();
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("wheel", close, { capture: true });
      window.removeEventListener("blur", close);
    };
  }, [close, open]);

  return createPortal(
    menu ? (
      <div
        ref={menuElRef}
        className={`app-context-menu ${styles.root}`}
        style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
        onContextMenu={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
      >
        {entries.map((entry, index) =>
          entry === "separator" ? (
            <div key={index} className={styles.separator} />
          ) : (
            <button
              key={index}
              type="button"
              className={styles.item}
              disabled={!entry.enabled}
              onClick={() => pick(entry)}
            >
              <span>{entry.label}</span>
              {entry.accel ? <span className={styles.accel}>{entry.accel}</span> : null}
            </button>
          ),
        )}
      </div>
    ) : null,
    document.body,
  );
}

export default AppContextMenu;
