import { useEffect, useRef, useState, type ReactNode } from "react";
import { Empty, Spin } from "antd";
import ChangesDiffEditor from "@renderer/components/ChangesDiffEditor";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./DiffTab.module.css";

type Props = {
  filePath?: string | null;
  visible?: boolean;
};

export function DiffTab({ filePath, visible }: Props): ReactNode {
  const t = useI18n();
  const [loading, setLoading] = useState(false);
  const [supported, setSupported] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [oldContent, setOldContent] = useState("");
  const [newContent, setNewContent] = useState("");
  const genRef = useRef(0);
  const fsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filePathRef = useRef<string | null | undefined>(filePath);
  const visibleRef = useRef(visible);
  filePathRef.current = filePath;
  visibleRef.current = visible;

  async function load(path: string): Promise<void> {
    const gen = ++genRef.current;
    setLoading(true);
    setErrorText("");
    try {
      const result = await window.api.git.diff(path);
      if (gen !== genRef.current) return;
      setSupported(result.supported);
      if (result.supported) {
        setOldContent(result.oldContent ?? "");
        setNewContent(result.newContent ?? "");
      }
    } catch (err) {
      if (gen !== genRef.current) return;
      setSupported(false);
      setErrorText(err instanceof Error ? err.message : String(err));
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (filePath) void load(filePath);
  }, [filePath]);

  useEffect(() => {
    const onFsChanged = (): void => {
      if (!visibleRef.current || !filePathRef.current) return;
      if (fsTimerRef.current) clearTimeout(fsTimerRef.current);
      fsTimerRef.current = setTimeout(() => {
        fsTimerRef.current = null;
        if (filePathRef.current) void load(filePathRef.current);
      }, 400);
    };
    window.addEventListener("pi-fs-changed", onFsChanged);
    return () => {
      window.removeEventListener("pi-fs-changed", onFsChanged);
      if (fsTimerRef.current) clearTimeout(fsTimerRef.current);
      fsTimerRef.current = null;
      genRef.current += 1;
    };
  }, []);

  return (
    <Spin spinning={loading} size="small" className={styles.diffTab}>
      {!filePath || !supported ? (
        <div className={styles.emptyWrap}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={errorText || t.changesNoDiff}
          />
        </div>
      ) : (
        <ChangesDiffEditor
          filePath={filePath}
          oldContent={oldContent}
          newContent={newContent}
        />
      )}
    </Spin>
  );
}

export default DiffTab;
