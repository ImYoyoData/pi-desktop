import { useEffect, useState, type ReactNode } from "react";
import { Select } from "antd";
import {
  normalizeThinkingLanguage,
  type ThinkingLanguage,
} from "../../../../shared/thinking-language";
import { SettingsRow } from "@renderer/components/customize/SettingsGroup";
import { useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./ThinkingLanguageSetting.module.css";

export function ThinkingLanguageSetting(): ReactNode {
  const message = useMessage();
  const t = useI18n();
  const [language, setLanguage] = useState<ThinkingLanguage>("default");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  // 另一窗口改了思考语言时跟着变。
  useEffect(() => {
    const onChanged = (): void => {
      void load();
    };
    window.addEventListener("pi-thinking-language-changed", onChanged);
    return () => window.removeEventListener("pi-thinking-language-changed", onChanged);
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

  const languageOptions = [
    { label: t.thinkingLanguageDefault, value: "default" },
    { label: t.thinkingLanguageZh, value: "zh" },
  ];

  return (
    <SettingsRow label={t.thinkingLanguage} description={t.thinkingLanguageHint}>
      <Select
        className={styles.rowSelect}
        size="small"
        value={language}
        options={languageOptions}
        disabled={saving}
        onChange={(value) => void save(value)}
      />
    </SettingsRow>
  );
}

export default ThinkingLanguageSetting;
