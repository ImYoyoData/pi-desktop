import { useEffect, useRef, useState, type ReactNode } from "react";
import { Spin } from "antd";
import ChangesDiffView from "@renderer/components/ChangesDiffView";
import styles from "./DiffTab.module.css";

type Props = {
  filePath?: string | null;
  visible?: boolean;
};

export function DiffTab({ filePath, visible }: Props): ReactNode {
  const [loading, setLoading] = useState(false);
  const [patch, setPatch] = useState("");
  const genRef = useRef(0);
  const patchRef = useRef("");
  const fsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filePathRef = useRef<string | null | undefined>(filePath);
  const visibleRef = useRef(visible);
  filePathRef.current = filePath;
  visibleRef.current = visible;
  patchRef.current = patch;

  async function load(path: string): Promise<void> {
    const gen = ++genRef.current;
    if (!patchRef.current) setLoading(true);
    try {
      const result = await window.api.git.diff(path);
      if (gen !== genRef.current) return;
      setPatch(result.supported ? (result.patch ?? "") : "");
    } catch {
      if (gen !== genRef.current) return;
      setPatch("");
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    setPatch("");
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
      {patch ? <ChangesDiffView patch={patch} /> : null}
    </Spin>
  );
}

export default DiffTab;
