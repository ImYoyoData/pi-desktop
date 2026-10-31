import { useEffect, useRef, useState, type ReactNode } from "react";
import { Spin } from "antd";
import ChangesDiffView from "@renderer/components/ChangesDiffView";
import { subscribeFsChanges } from "@renderer/utils/fs-changed-bus";
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
      const next = result.supported ? (result.patch ?? "") : "";
      setPatch((current) => (current === next ? current : next));
    } catch {
      if (gen !== genRef.current) return;
      setPatch((current) => (current === "" ? current : ""));
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    setPatch("");
    patchRef.current = "";
    if (filePath) void load(filePath);
  }, [filePath]);

  useEffect(() => {
    const stop = subscribeFsChanges(() => {
      if (!visibleRef.current || !filePathRef.current) return;
      void load(filePathRef.current);
    });
    return () => {
      stop();
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
