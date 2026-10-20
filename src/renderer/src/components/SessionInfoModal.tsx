import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, Modal, Spin, Typography } from "antd";
import {
  ChevronDownOutline,
  ChevronForwardOutline,
  DocumentOutline,
  ExtensionPuzzleOutline,
  FileTrayFullOutline,
  SparklesOutline,
  TerminalOutline,
} from "@renderer/components/icons/ionicons";
import { useChatStore } from "@renderer/stores/chat";
import { usePreviewStore } from "@renderer/stores/preview";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { isReadTool, toolCardFor } from "@renderer/utils/tool-diff";
import type { WorkerResourceSummary } from "../../../shared/worker-resources";
import type { SessionExtensionInfo } from "../../../shared/protocol";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./SessionInfoModal.module.css";

type Props = {
  open: boolean;
  sessionId: string | null;
  onClose: () => void;
};

export function SessionInfoModal({
  open,
  sessionId,
  onClose,
}: Props): ReactNode {
  const t = useI18n();
  const activeMessages = useChatStore((s) => s.activeMessages);

  const [resources, setResources] = useState<WorkerResourceSummary | null>(null);
  const [extensions, setExtensions] = useState<SessionExtensionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [filesRead, setFilesRead] = useState<string[]>([]);

  /** Collapse state per section (default: all open). */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const filesReadTimer = useRef(0);
  const openRef = useRef(open);
  const sessionIdRef = useRef(sessionId);

  useLayoutEffect(() => {
    openRef.current = open;
    sessionIdRef.current = sessionId;
  }, [open, sessionId]);

  const toggleSection = useCallback((key: string): void => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const isCollapsed = useCallback(
    (key: string): boolean => Boolean(collapsed[key]),
    [collapsed],
  );

  /** Files the agent read in this session (from read tool calls). */
  const computeFilesRead = useCallback((): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const msg of useChatStore.getState().activeMessages) {
      if (msg.role !== "tool" || !isReadTool(msg.toolName)) continue;
      try {
        const card = toolCardFor(msg);
        if (card.kind !== "read" || !card.path) continue;
        const p = card.path.replace(/\\/g, "/");
        if (!seen.has(p)) {
          seen.add(p);
          out.push(p);
        }
      } catch {
        // ignore malformed rows
      }
    }
    return out;
  }, []);

  /** Open a read file in the right-side preview tab (same as tool cards). */
  const openReadFile = useCallback(
    (filePath: string): void => {
      usePreviewStore.getState().openPreview(filePath);
      useRightTabsStore.getState().addTab("preview", {
        filePath,
        label: filePath.split(/[/\\]/).pop() || t.preview,
      });
    },
    [t],
  );

  const load = useCallback(async (id: string | null): Promise<void> => {
    if (!id) return;
    setLoading(true);
    setResources(null);
    setExtensions([]);
    try {
      const info = await window.api.sessions.getInfo(id);
      setResources(info.resources ?? null);
      setExtensions(info.extensions ?? []);
    } catch {
      setResources(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setFilesRead(computeFilesRead());
    void load(sessionId);
  }, [open, sessionId, computeFilesRead, load]);

  useEffect(() => {
    if (!open) return;
    if (filesReadTimer.current) return;
    filesReadTimer.current = window.setTimeout(() => {
      filesReadTimer.current = 0;
      setFilesRead(computeFilesRead());
    }, 120);
  }, [activeMessages, open, computeFilesRead]);

  // Auto-refresh while open: when the session worker finishes loading its
  // extensions/skills/tools, update the panel without requiring a re-click.
  useEffect(() => {
    const offWorkerReady = window.api.sessions.onWorkerReady((id) => {
      if (openRef.current && sessionIdRef.current === id) {
        void load(sessionIdRef.current);
      }
    });
    return () => {
      offWorkerReady();
      if (filesReadTimer.current) window.clearTimeout(filesReadTimer.current);
    };
  }, [load]);

  return (
    <Modal
      open={open}
      title={t.sessionInfoTitle}
      className="pi-settings-modal"
      width="min(680px, 94vw)"
      onCancel={onClose}
      footer={
        <div className={styles.footer}>
          <Button size="small" onClick={onClose}>
            {t.close}
          </Button>
        </div>
      }
    >
      <Typography.Text type="secondary" className={styles.infoHint}>
        {t.sessionInfoHint}
      </Typography.Text>
      <Spin spinning={loading} className={styles.spinFill}>
        <div className={`modal-scroll ${styles.infoScroll}`}>
          {/* Tools */}
          <section className={styles.card}>
            <button
              type="button"
              className={`${styles.cardTitle} ${styles.sectToggle}`}
              aria-expanded={!isCollapsed("tools")}
              onClick={() => toggleSection("tools")}
            >
              <TerminalOutline size={15} />
              <span>{t.sessionInfoTools}</span>
              <span className={styles.count}>
                {resources?.activeTools.length ?? 0}
              </span>
              {isCollapsed("tools") ? (
                <ChevronForwardOutline className={styles.chev} size={13} />
              ) : (
                <ChevronDownOutline className={styles.chev} size={13} />
              )}
            </button>
            {!isCollapsed("tools") ? (
              <div className={styles.sectBody}>
                {resources?.activeTools.length ? (
                  <div className={styles.cardGrid}>
                    {resources.activeTools.map((tool) => (
                      <div key={tool.name} className={styles.itemCard}>
                        <div className={styles.itemName} title={tool.name}>
                          {tool.name}
                        </div>
                        {tool.brief ? (
                          <div
                            className={styles.itemBrief}
                            title={tool.brief}
                          >
                            {tool.brief}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <Typography.Text
                    type="secondary"
                    className={styles.empty}
                  >
                    {t.sessionInfoEmpty}
                  </Typography.Text>
                )}
              </div>
            ) : null}
          </section>

          {/* Extensions */}
          <section className={styles.card}>
            <button
              type="button"
              className={`${styles.cardTitle} ${styles.sectToggle}`}
              aria-expanded={!isCollapsed("ext")}
              onClick={() => toggleSection("ext")}
            >
              <ExtensionPuzzleOutline size={15} />
              <span>{t.sessionInfoExtensions}</span>
              <span className={styles.count}>{extensions.length}</span>
              {isCollapsed("ext") ? (
                <ChevronForwardOutline className={styles.chev} size={13} />
              ) : (
                <ChevronDownOutline className={styles.chev} size={13} />
              )}
            </button>
            {!isCollapsed("ext") ? (
              <div className={styles.sectBody}>
                {extensions.length ? (
                  <div className={styles.cardGrid}>
                    {extensions.map((ext) => (
                      <div key={ext.path} className={styles.itemCard}>
                        <div className={styles.itemName} title={ext.name}>
                          {ext.name}
                        </div>
                        {ext.brief ? (
                          <div
                            className={styles.itemBrief}
                            title={ext.brief}
                          >
                            {ext.brief}
                          </div>
                        ) : null}
                        <div className={styles.itemPath} title={ext.path}>
                          {ext.path}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Typography.Text
                    type="secondary"
                    className={styles.empty}
                  >
                    {t.sessionInfoEmpty}
                  </Typography.Text>
                )}
              </div>
            ) : null}
          </section>

          {/* Skills */}
          <section className={styles.card}>
            <button
              type="button"
              className={`${styles.cardTitle} ${styles.sectToggle}`}
              aria-expanded={!isCollapsed("skills")}
              onClick={() => toggleSection("skills")}
            >
              <SparklesOutline size={15} />
              <span>{t.sessionInfoSkills}</span>
              <span className={styles.count}>
                {resources?.skillNames.length ?? 0}
              </span>
              {isCollapsed("skills") ? (
                <ChevronForwardOutline className={styles.chev} size={13} />
              ) : (
                <ChevronDownOutline className={styles.chev} size={13} />
              )}
            </button>
            {!isCollapsed("skills") ? (
              <div className={styles.sectBody}>
                {resources?.skillNames.length ? (
                  <div className={styles.cardGrid}>
                    {resources.skillNames.map((sk) => (
                      <div key={sk.name} className={styles.itemCard}>
                        <div className={styles.itemName} title={sk.name}>
                          {sk.name}
                        </div>
                        {sk.brief ? (
                          <div
                            className={styles.itemBrief}
                            title={sk.brief}
                          >
                            {sk.brief}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <Typography.Text
                    type="secondary"
                    className={styles.empty}
                  >
                    {t.sessionInfoEmpty}
                  </Typography.Text>
                )}
              </div>
            ) : null}
          </section>

          {/* Files read */}
          <section className={styles.card}>
            <button
              type="button"
              className={`${styles.cardTitle} ${styles.sectToggle}`}
              aria-expanded={!isCollapsed("files")}
              onClick={() => toggleSection("files")}
            >
              <FileTrayFullOutline size={15} />
              <span>{t.sessionInfoFilesRead}</span>
              <span className={styles.count}>{filesRead.length}</span>
              {isCollapsed("files") ? (
                <ChevronForwardOutline className={styles.chev} size={13} />
              ) : (
                <ChevronDownOutline className={styles.chev} size={13} />
              )}
            </button>
            {!isCollapsed("files") ? (
              <div className={styles.sectBody}>
                {filesRead.length ? (
                  <ul className={styles.fileList}>
                    {filesRead.map((p) => (
                      <li key={p}>
                        <button
                          type="button"
                          className={styles.fileRow}
                          title={p}
                          onClick={() => openReadFile(p)}
                        >
                          <DocumentOutline size={13} className={styles.fileIcon} />
                          <span className={styles.filePath}>{p}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Typography.Text
                    type="secondary"
                    className={styles.empty}
                  >
                    {t.sessionInfoEmpty}
                  </Typography.Text>
                )}
              </div>
            ) : null}
          </section>
        </div>
      </Spin>
    </Modal>
  );
}

export default SessionInfoModal;
