import {
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { fontSizePx, resolveMonoFontStack } from "../../../shared/appearance";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { sanitizeTerminalCommandLabel, truncateTabLabel } from "../../../shared/tab-label";
import { useDialog } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import { handleAppLinkClick } from "@renderer/utils/open-link";
import { ProgramStatusScanner } from "@renderer/utils/osc-program-status";
import { xtermTheme } from "@renderer/utils/xterm-theme";
import styles from "./TerminalTab.module.css";

type Props = {
  /** Unique id for this terminal pane (dynamic right tab) */
  instanceId?: string;
  /** Tab is visible — refit when shown so height matches the pane */
  visible?: boolean;
  /** Existing pty to re-attach (kept alive across workspace switches). */
  ptyId?: string | null;
  /** Cwd used when the pty was created. */
  cwd?: string | null;
  /** Shell id chosen for this tab (empty = default shell). */
  shellId?: string | null;
};

const MAX_WRITE_BUF = 512 * 1024;
const WRITE_PER_FRAME = 64 * 1024;

function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function TerminalTab({
  instanceId,
  visible,
  ptyId,
  cwd,
  shellId,
}: Props): ReactNode {
  const t = useI18n();
  const workspace = useWorkspaceStore();
  const appearance = useAppearanceStore();
  const dialog = useDialog();

  const hostRef = useRef<HTMLDivElement | null>(null);
  const activePtyIdRef = useRef<string | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const fitRafRef = useRef(0);
  const writeBufRef = useRef("");
  const writeRafRef = useRef(0);
  const inputLineBufRef = useRef("");
  const autoTitledRef = useRef(false);
  const ansiSkipRef = useRef<"none" | "esc" | "csi" | "osc">("none");
  const instanceIdRef = useRef(instanceId);
  const visibleRef = useRef(visible);
  const programStatusScannerRef = useRef(new ProgramStatusScanner());
  instanceIdRef.current = instanceId;
  visibleRef.current = visible;

  function currentTerm(): Terminal | null {
    return termRef.current;
  }

  function flushWriteBuf(): void {
    writeRafRef.current = 0;
    const term = termRef.current;
    if (!term || !writeBufRef.current) return;
    const chunk = writeBufRef.current.slice(0, WRITE_PER_FRAME);
    writeBufRef.current = writeBufRef.current.slice(WRITE_PER_FRAME);
    term.write(chunk);
    if (writeBufRef.current) {
      writeRafRef.current = requestAnimationFrame(flushWriteBuf);
    }
  }

  function enqueueWrite(data: string): void {
    if (!data) return;
    writeBufRef.current += data;
    if (writeBufRef.current.length > MAX_WRITE_BUF) {
      writeBufRef.current = writeBufRef.current.slice(
        writeBufRef.current.length - MAX_WRITE_BUF,
      );
    }
    if (writeRafRef.current) return;
    writeRafRef.current = requestAnimationFrame(flushWriteBuf);
  }

  function fitTerm(): void {
    const term = termRef.current;
    const fit = fitRef.current;
    const host = hostRef.current;
    if (!term || !fit || !activePtyIdRef.current || !host) return;
    if (visibleRef.current === false) return;
    const rect = host.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    try {
      fit.fit();
      const { cols, rows } = term;
      void window.api.terminal.resize(activePtyIdRef.current, cols, rows);
    } catch {
      // container may not be laid out yet
    }
  }

  function scheduleFit(): void {
    if (fitRafRef.current) cancelAnimationFrame(fitRafRef.current);
    fitRafRef.current = requestAnimationFrame(() => {
      fitRafRef.current = requestAnimationFrame(() => {
        fitTerm();
      });
    });
  }

  function onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const term = termRef.current;
    if (!term) return;

    if (term.hasSelection()) {
      const text = term.getSelection();
      term.clearSelection();
      if (text) {
        void navigator.clipboard.writeText(text).catch(() => {
          // ignore clipboard write failures
        });
      }
      term.focus();
      return;
    }

    void navigator.clipboard
      .readText()
      .then((text) => {
        if (text && termRef.current) termRef.current.paste(text);
      })
      .catch(() => {
        // ignore clipboard read failures (permission / empty)
      });
    term.focus();
  }

  function noteUserInput(data: string): void {
    if (autoTitledRef.current || !instanceIdRef.current) return;
    for (const ch of data) {
      if (ansiSkipRef.current === "esc") {
        if (ch === "[") {
          ansiSkipRef.current = "csi";
          continue;
        }
        if (ch === "]") {
          ansiSkipRef.current = "osc";
          continue;
        }
        ansiSkipRef.current = "none";
        continue;
      }
      if (ansiSkipRef.current === "csi") {
        if (ch >= "@" && ch <= "~") ansiSkipRef.current = "none";
        continue;
      }
      if (ansiSkipRef.current === "osc") {
        if (ch === "\u0007") {
          ansiSkipRef.current = "none";
          continue;
        }
        if (ch === "\x1b") {
          ansiSkipRef.current = "esc";
          continue;
        }
        continue;
      }
      if (ch === "\x1b") {
        ansiSkipRef.current = "esc";
        continue;
      }
      if (ch === "\r" || ch === "\n") {
        const cmd = sanitizeTerminalCommandLabel(inputLineBufRef.current);
        inputLineBufRef.current = "";
        ansiSkipRef.current = "none";
        if (!cmd) continue;
        autoTitledRef.current = true;
        useRightTabsStore.getState().autoTitleTab(instanceIdRef.current, truncateTabLabel(cmd));
        return;
      }
      if (ch === "\u007f" || ch === "\b") {
        inputLineBufRef.current = inputLineBufRef.current.slice(0, -1);
        continue;
      }
      if (ch === "\t" || ch >= " ") inputLineBufRef.current += ch;
    }
  }

  function bindXterm(host: HTMLDivElement): void {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: fontSizePx(13, useAppearanceStore.getState().fontSize),
      fontFamily: resolveMonoFontStack(useAppearanceStore.getState().fonts),
      rightClickSelectsWord: false,
      scrollback: 5000,
      windowOptions: {},
      allowTransparency: true,
      theme: xtermTheme(useAppearanceStore.getState().resolvedTheme === "dark"),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        handleAppLinkClick(event, uri, dialog);
      }),
    );
    term.open(host);
    term.onData((data) => {
      noteUserInput(data);
      const id = activePtyIdRef.current;
      if (id) void window.api.terminal.write(id, data);
    });
    host.addEventListener("contextmenu", onContextMenu, true);
    termRef.current = term;
    fitRef.current = fit;
  }

  function detachUi(): void {
    hostRef.current?.removeEventListener("contextmenu", onContextMenu, true);
    if (writeRafRef.current) {
      cancelAnimationFrame(writeRafRef.current);
      writeRafRef.current = 0;
    }
    writeBufRef.current = "";
    termRef.current?.dispose();
    termRef.current = null;
    fitRef.current = null;
  }

  async function start(root: string | null): Promise<void> {
    const host = hostRef.current;
    if (!host || currentTerm()) return;

    const preferredCwd = (cwd || root || "").trim();
    if (!preferredCwd && !ptyId) return;

    let id = ptyId?.trim() || null;
    if (id) {
      const alive = await window.api.terminal.isAlive(id);
      if (!alive) id = null;
    }

    if (!id) {
      if (!preferredCwd) return;
      id = await window.api.terminal.create(preferredCwd, shellId || undefined);
      if (instanceIdRef.current) {
        useRightTabsStore.getState().patchTab(instanceIdRef.current, {
          ptyId: id,
          cwd: preferredCwd,
          shellId: shellId || undefined,
        });
      }
    }

    activePtyIdRef.current = id;
    bindXterm(host);

    const history = await window.api.terminal.getScrollback(id);
    if (history && termRef.current) {
      enqueueWrite(history);
    }

    await nextFrame();
    scheduleFit();
    currentTerm()?.focus();
  }

  useEffect(() => {
    let cancelled = false;
    const offData = window.api.terminal.onData(({ id, data }) => {
      if (id !== activePtyIdRef.current) return;
      const scan = programStatusScannerRef.current.scan(data);
      for (const reply of scan.replies) {
        void window.api.terminal.write(id, reply);
      }
      for (const report of scan.reports) {
        const tabId = instanceIdRef.current;
        if (tabId) useRightTabsStore.getState().setPiStatus(tabId, report);
      }
      enqueueWrite(data);
    });
    const observer = new ResizeObserver(() => scheduleFit());
    if (hostRef.current) observer.observe(hostRef.current);
    resizeObserverRef.current = observer;
    const boot = async (): Promise<void> => {
      const store = useWorkspaceStore.getState();
      if (!store.root) await store.getWorkspace();
      if (cancelled) return;
      const root = useWorkspaceStore.getState().root;
      if (ptyId || cwd || root) await start(root);
    };
    void boot();
    return () => {
      cancelled = true;
      if (fitRafRef.current) cancelAnimationFrame(fitRafRef.current);
      offData();
      observer.disconnect();
      resizeObserverRef.current = null;
      detachUi();
      activePtyIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term || !visible) return;
    term.options.theme = xtermTheme(appearance.resolvedTheme === "dark");
    scheduleFit();
  }, [visible, appearance.resolvedTheme]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSizePx(13, appearance.fontSize);
    term.options.fontFamily = resolveMonoFontStack(useAppearanceStore.getState().fonts);
    scheduleFit();
  }, [appearance.fontSize, appearance.fonts]);

  return (
    <div className={styles.terminalTab}>
      {!ptyId && !cwd && !workspace.root ? (
        <div className={styles.empty}>{t.terminalEmpty}</div>
      ) : (
        <div ref={hostRef} className={styles.termHost} />
      )}
    </div>
  );
}

export default TerminalTab;
