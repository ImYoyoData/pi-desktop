import { useState, type ReactNode } from "react";
import CodiconIcon from "@renderer/components/icons/CodiconIcon";
import groupStyles from "@renderer/components/customize/SettingsGroup.module.css";
import ThinkingLanguageSetting from "@renderer/components/customize/ThinkingLanguageSetting";
import HookEventList from "@renderer/components/customize/HookEventList";
import type { CustomizationHook } from "../../../../shared/customizations";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./CustomizeHooks.module.css";

type Props = {
  hooks: CustomizationHook[];
};

export function CustomizeHooks({ hooks }: Props): ReactNode {
  const t = useI18n();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  function toggle(key: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const hookCount = hooks.length;

  return (
    <div className={styles.customizeHooks}>
      <div className={`${groupStyles.card} ${styles.groupBlock}`}>
        <button
          type="button"
          className={styles.groupHeader}
          onClick={() => toggle("desktop")}
        >
          <span className={styles.groupLabel}>{t.customizeHooksDesktop}</span>
          <span className={styles.groupInfo} title={t.customizeHooksDesktopHint}>
            <CodiconIcon name="about" size={14} />
          </span>
          <span className={styles.groupChevron}>
            <CodiconIcon
              name={collapsed.has("desktop") ? "chevronRight" : "chevronDown"}
              size={14}
            />
          </span>
        </button>

        {!collapsed.has("desktop") ? (
          <div className={styles.groupBody}>
            <ThinkingLanguageSetting />

            <div className={styles.modePreambleRow}>
              <div className={styles.rowLabels}>
                <span className={styles.rowTitle}>{t.composerModePreamble}</span>
                <span className={styles.rowHint}>{t.composerModePreambleHint}</span>
              </div>
              <span className={styles.modeBadges}>
                <span className={styles.inlineBadge}>{t.composerModeAgent}</span>
                <span className={styles.inlineBadge}>{t.composerModeAsk}</span>
                <span className={styles.inlineBadge}>{t.composerModePlan}</span>
                <span className={styles.inlineBadge}>{t.composerModeTask}</span>
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className={`${groupStyles.card} ${styles.groupBlock}`}>
        <button
          type="button"
          className={styles.groupHeader}
          onClick={() => toggle("extensions")}
        >
          <span className={styles.groupLabel}>{t.customizeHooksExtensions}</span>
          <span className={styles.groupCount}>{hookCount}</span>
          <span className={styles.groupInfo} title={t.customizeHooksDesc}>
            <CodiconIcon name="about" size={14} />
          </span>
          <span className={styles.groupChevron}>
            <CodiconIcon
              name={collapsed.has("extensions") ? "chevronRight" : "chevronDown"}
              size={14}
            />
          </span>
        </button>

        {!collapsed.has("extensions") ? <HookEventList hooks={hooks} /> : null}
      </div>
    </div>
  );
}

export default CustomizeHooks;
