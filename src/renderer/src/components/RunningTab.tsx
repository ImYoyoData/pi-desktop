import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { Button, Empty } from "antd";
import type { AgentRunSnapshot } from "../../../shared/agent-runs";
import { useAgentRunsStore } from "@renderer/stores/agent-runs";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useDialog, useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import { handleAppLinkClick } from "@renderer/utils/open-link";
import { xtermTheme } from "@renderer/utils/xterm-theme";
import styles from "./RunningTab.module.css";

type Props = {
  /** Tab is visible — refit when shown so height matches the pane */
  visible?: boolean;
};

const MAX_WRITE_BUF = 512 * 1024;
const WRITE_PER_FRAME = 64 * 1024;

function currentSelectedRun(): AgentRunSnapshot | null {
  const state = useAgentRunsStore.getState();
  if (!state.selectedId) return null;
  return state.runs.find((r) => r.id === state.selectedId) ?? null;
}

export function RunningTab({ visible }: Props): ReactNode {
  const t = useI18n();
  const store = useAgentRunsStore();
  const sessions = useSessionsStore();
  const appearance = useAppearanceStore();
  const message = useMessage();
  const dialog = useDialog();

  const [now, setNow] = useState(() => Date.now());
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const fitRafRef = useRef(0);
  const writeBufRef = useRef("");
  const writeRafRef = useRef(0);
  const syncedRunIdRef = useRef<string | null>(null);
  const lastWrittenTailRef = useRef("");

  const selectedRun = useMemo(
    () => (store.selectedId ? (store.runs.find((r) => r.id === store.selectedId) ?? null) : null),
    [store.runs, store.selectedId],
  );
  const selectedOutputTail = selectedRun?.outputTail ?? "";

  function flushWriteBuf(): void {
    writeRafRef.current = 0;
    const term = termRef.current;
    if (!term || !writeBufRef.current) return;
    const chunk = writeBufRef.current.slice(0, WRITE_PER_FRAME);
    writeBufRef.current = writeBufRef.current.slice(WRITE_PER_FRAME);
    term.write(chunk, () => {
      termRef.current?.scrollToBottom();
    });
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
    if (!term || !fit || !host) return;
    if (visible === false) return;
    const rect = host.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    try {
      fit.fit();
      if (term.rows > 0) {
        term.refresh(0, term.rows - 1);
      }
      term.scrollToBottom();
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
    if (!term || !term.hasSelection()) return;
    const text = term.getSelection();
    term.clearSelection();
    if (text) {
      void navigator.clipboard.writeText(text).catch(() => {
        // ignore clipboard write failures
      });
    }
  }

  function resetSync(): void {
    syncedRunIdRef.current = null;
    lastWrittenTailRef.current = "";
    writeBufRef.current = "";
    if (writeRafRef.current) {
      cancelAnimationFrame(writeRafRef.current);
      writeRafRef.current = 0;
    }
  }

  function syncOutput(forceFull = false): void {
    const term = termRef.current;
    if (!term) return;
    const run = currentSelectedRun();
    if (!run) {
      if (syncedRunIdRef.current !== null || lastWrittenTailRef.current) {
        term.reset();
        resetSync();
      }
      return;
    }
    const tail = run.outputTail ?? "";
    const mustFull = forceFull || run.id !== syncedRunIdRef.current;
    if (mustFull) {
      term.reset();
      writeBufRef.current = "";
      if (writeRafRef.current) {
        cancelAnimationFrame(writeRafRef.current);
        writeRafRef.current = 0;
      }
      enqueueWrite(tail);
      syncedRunIdRef.current = run.id;
      lastWrittenTailRef.current = tail;
      return;
    }
    if (tail === lastWrittenTailRef.current) return;
    if (tail.startsWith(lastWrittenTailRef.current)) {
      enqueueWrite(tail.slice(lastWrittenTailRef.current.length));
      lastWrittenTailRef.current = tail;
      return;
    }
    term.reset();
    writeBufRef.current = "";
    if (writeRafRef.current) {
      cancelAnimationFrame(writeRafRef.current);
      writeRafRef.current = 0;
    }
    enqueueWrite(tail);
    lastWrittenTailRef.current = tail;
  }

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      disableStdin: true,
      convertEol: true,
      cursorBlink: false,
      cursorInactiveStyle: "none",
      fontSize: 13,
      fontFamily: "Cascadia Code, Consolas, Menlo, monospace",
      rightClickSelectsWord: false,
      scrollback: 5000,
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
    termRef.current = term;
    fitRef.current = fit;
    host.addEventListener("contextmenu", onContextMenu, true);
    const observer = new ResizeObserver(() => scheduleFit());
    observer.observe(host);
    resizeObserverRef.current = observer;
    syncOutput(true);
    scheduleFit();
    return () => {
      if (fitRafRef.current) cancelAnimationFrame(fitRafRef.current);
      if (writeRafRef.current) cancelAnimationFrame(writeRafRef.current);
      host.removeEventListener("contextmenu", onContextMenu, true);
      observer.disconnect();
      resizeObserverRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      resetSync();
    };
  }, [dialog]);

  const selectedIdRef = useRef(store.selectedId);

  useEffect(() => {
    if (selectedIdRef.current === store.selectedId) return;
    selectedIdRef.current = store.selectedId;
    syncOutput(true);
    if (visible !== false) scheduleFit();
  }, [store.selectedId]);

  useEffect(() => {
    syncOutput(false);
  }, [selectedOutputTail]);

  useEffect(() => {
    const term = termRef.current;
    if (!term || visible === false) return;
    term.options.theme = xtermTheme(appearance.resolvedTheme === "dark");
  }, [appearance.resolvedTheme, visible]);

  useEffect(() => {
    const term = termRef.current;
    if (!term || !visible) return;
    term.options.theme = xtermTheme(useAppearanceStore.getState().resolvedTheme === "dark");
    syncOutput(true);
    scheduleFit();
  }, [visible]);

  function truncate(cmd: string, max = 72): string {
    const oneLine = cmd.replace(/\s+/g, " ").trim();
    if (oneLine.length <= max) return oneLine;
    return `${oneLine.slice(0, max - 1)}…`;
  }

  function sessionLabel(sessionId: string): string {
    const name = sessions.sessions.find((s) => s.id === sessionId)?.name?.trim();
    if (name) return name;
    return sessionId.slice(0, 8);
  }

  function elapsed(startedAt: number): string {
    const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
    return t.runningElapsed(secs);
  }

  async function onTerminate(runId: string): Promise<void> {
    try {
      await useAgentRunsStore.getState().terminate(runId);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t.runningTerminateFailed);
    }
  }

  function onRowKeydown(event: KeyboardEvent<HTMLDivElement>, runId: string): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    useAgentRunsStore.getState().select(runId);
  }

  return (
    <div className={styles.runningTab}>
      <aside className={styles.runList}>
        {store.runs.length ? null : (
          <div className={styles.emptyWrap}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t.runningEmpty} />
          </div>
        )}
        {store.runs.map((run) => (
          <div
            key={run.id}
            role="button"
            tabIndex={0}
            className={
              run.id === store.selectedId
                ? `run-row ${styles.runRow} active`
                : `run-row ${styles.runRow}`
            }
            onClick={() => useAgentRunsStore.getState().select(run.id)}
            onKeyDown={(event) => onRowKeydown(event, run.id)}
          >
            <div className={styles.runMain}>
              <div className={styles.cmd} title={run.command}>
                {truncate(run.command)}
              </div>
              <div className={styles.meta}>
                {sessionLabel(run.sessionId)} · {elapsed(run.startedAt)}
                {run.detached ? (
                  <span className={styles.status}> · {t.runningDetached}</span>
                ) : null}
                {run.status === "terminating" ? (
                  <span className={styles.status}> · …</span>
                ) : null}
              </div>
            </div>
            <Button
              size="small"
              disabled={run.status === "terminating"}
              onClick={(event) => {
                event.stopPropagation();
                void onTerminate(run.id);
              }}
            >
              {t.runningTerminate}
            </Button>
          </div>
        ))}
      </aside>
      <div className={styles.runOut}>
        <div ref={hostRef} className={styles.termHost} />
        {selectedRun ? null : (
          <div className={styles.outEmpty}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t.runningSelectHint} />
          </div>
        )}
      </div>
    </div>
  );
}

export default RunningTab;
