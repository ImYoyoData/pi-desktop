import type { ReactNode } from "react";
import type { CustomizationHook } from "../../../../shared/customizations";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./HookEventList.module.css";

type Props = {
  hooks: CustomizationHook[];
};

export function HookEventList({ hooks }: Props): ReactNode {
  const t = useI18n();

  return (
    <div className={styles.root}>
      {!hooks.length ? (
        <div className={styles.listEmptyState}>
          <div className={styles.emptyStateText}>{t.customizeHooksExtensionsEmpty}</div>
          <div className={styles.emptyStateSubtext}>
            {t.customizeHooksExtensionsEmptyHint}
          </div>
        </div>
      ) : (
        <div className={styles.listContainer}>
          {hooks.map((hook) => (
            <div key={hook.event} className={styles.hookEventItem}>
              <span className={styles.itemName}>{hook.event}</span>
              <span className={styles.itemBadges}>
                {hook.subscribers.map((name) => (
                  <span key={name} className={styles.itemBadge}>
                    {name}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default HookEventList;
