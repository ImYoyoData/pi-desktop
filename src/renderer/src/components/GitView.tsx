import type { ReactNode } from "react";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./GitView.module.css";

/** Git 页：先提供入口与占位内容，具体功能后续补齐。 */
export function GitView(): ReactNode {
  const t = useI18n();
  return (
    <section className={styles.root}>
      <header className={styles.pageHead}>
        <h1 className={styles.pageTitle}>{t.git}</h1>
      </header>
      <p className={styles.hint}>{t.gitComingSoon}</p>
    </section>
  );
}

export default GitView;
