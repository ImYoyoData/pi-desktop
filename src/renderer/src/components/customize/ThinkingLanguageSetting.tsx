import { useEffect, useState, type ReactNode } from "react";
import { Radio, Typography } from "antd";
import {
  normalizeThinkingLanguage,
  type ThinkingLanguage,
} from "../../../../shared/thinking-language";
import { useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./ThinkingLanguageSetting.module.css";

export function ThinkingLanguageSetting(): ReactNode {
  const message = useMessage();
  const t = useI18n();
  const [language, setLanguage] = useState<ThinkingLanguage>("en");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load(): Promise<void> {
    try {
      setLanguage((await window.api.thinkingLanguage.get()).language);
    } catch {
      // 读取失败时保留默认值
    }
  }

  async function save(value: string | number): Promise<void> {
    const next = normalizeThinkingLanguage(value);
    setLanguage(next);
    setSaving(true);
    try {
      setLanguage((await window.api.thinkingLanguage.set({ language: next })).language);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.rowLabels}>
        <Typography.Text strong>{t.thinkingLanguage}</Typography.Text>
        <Typography.Text type="secondary" className={styles.rowHint}>
          {t.thinkingLanguageHint}
        </Typography.Text>
      </div>
      <Radio.Group
        className={styles.rowRadio}
        size="small"
        value={language}
        disabled={saving}
        onChange={(event) => void save(event.target.value)}
      >
        <Radio.Button value="zh">{t.thinkingLanguageZh}</Radio.Button>
        <Radio.Button value="en">{t.thinkingLanguageEn}</Radio.Button>
      </Radio.Group>
    </div>
  );
}

export default ThinkingLanguageSetting;
