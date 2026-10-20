import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Modal, Typography } from "antd";
import { useI18n } from "@renderer/i18n/use-i18n";
import { CONTRIBUTORS, type Contributor } from "../../../shared/contributors";
import styles from "./AboutPanel.module.css";

type AppInfo = {
  version: string;
  author: string;
  githubUrl: string;
};

export function AboutPanel(): ReactNode {
  const t = useI18n();
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Contributor | null>(null);

  /** 按提交数排名，网格与详情弹窗共用同一顺序。 */
  const ranked = useMemo(
    () =>
      [...CONTRIBUTORS]
        .sort((a, b) => b.contributions - a.contributions)
        .map((contributor, index) => ({ contributor, rank: index + 1 })),
    [],
  );

  const selectedRank =
    ranked.find((item) => item.contributor.login === selected?.login)?.rank ?? ranked.length;

  function initialOf(contributor: Contributor): string {
    return (contributor.name.trim() || contributor.login).slice(0, 1).toUpperCase();
  }

  /** 无头像时的占位底色：按用户名散列到固定色相。 */
  function fallbackColor(login: string): string {
    let hash = 0;
    for (const char of login) hash = (hash * 31 + char.charCodeAt(0)) % 360;
    return `hsl(${hash} 64% 46%)`;
  }

  useEffect(() => {
    void (async () => {
      setAppInfo(await window.api.update.getAppInfo());
    })();
    void (async () => {
      const entries = await Promise.all(
        CONTRIBUTORS.map(async (contributor) => {
          const dataUrl = await window.api.contributors.avatar(contributor.avatarUrl);
          return dataUrl ? ([contributor.login, dataUrl] as const) : null;
        }),
      );
      setAvatars(Object.fromEntries(entries.filter((entry) => entry !== null)));
    })();
  }, []);

  function openRepository(): void {
    void window.api.browser.openExternal(appInfo?.githubUrl ?? "");
  }

  function openProfile(contributor: Contributor): void {
    void window.api.browser.openExternal(contributor.htmlUrl);
  }

  return (
    <div className={styles.aboutPanel}>
      <div className={styles.aboutHead}>
        <Typography.Text strong style={{ fontSize: 16 }}>
          {t.appName}
        </Typography.Text>
        {appInfo ? <Typography.Text type="secondary">v{appInfo.version}</Typography.Text> : null}
      </div>

      <div className={styles.aboutBlock}>
        <div className={styles.aboutRow}>
          <span>{t.aboutAuthor}</span>
          <span>{appInfo?.author ?? "—"}</span>
        </div>
        <div className={styles.aboutRow}>
          <span>{t.aboutRepository}</span>
          <button type="button" className={styles.aboutLink} onClick={openRepository}>
            {t.aboutOpenRepository}
          </button>
        </div>
      </div>

      <div className={styles.aboutSection}>
        <div className={styles.aboutSectionTitle}>{t.aboutContributors}</div>
        <div className={styles.contributorGrid}>
          {ranked.map((item) => {
            const avatar = avatars[item.contributor.login];
            return (
              <button
                key={item.contributor.login}
                type="button"
                className={styles.contributorItem}
                onClick={() => setSelected(item.contributor)}
              >
                {avatar ? (
                  <img
                    className={styles.contributorAvatar}
                    src={avatar}
                    alt={item.contributor.name}
                  />
                ) : (
                  <span
                    className={`${styles.contributorAvatar} ${styles.contributorFallback}`}
                    style={{ background: fallbackColor(item.contributor.login) }}
                    aria-hidden="true"
                  >
                    {initialOf(item.contributor)}
                  </span>
                )}
                <span className={styles.contributorLogin}>{item.contributor.login}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Modal
        open={selected !== null}
        className="pi-settings-modal"
        width="min(360px, 92vw)"
        title={selected?.name ?? ""}
        onCancel={() => setSelected(null)}
        footer={
          <div className={styles.detailFooter}>
            {selected ? (
              <Button size="small" onClick={() => openProfile(selected)}>
                {t.aboutContributorOpenProfile}
              </Button>
            ) : null}
          </div>
        }
      >
        {selected ? (
          <div className={styles.detail}>
            {avatars[selected.login] ? (
              <img
                className={styles.detailAvatar}
                src={avatars[selected.login]}
                alt={selected.name}
              />
            ) : (
              <span
                className={`${styles.detailAvatar} ${styles.detailFallback}`}
                style={{ background: fallbackColor(selected.login) }}
                aria-hidden="true"
              >
                {initialOf(selected)}
              </span>
            )}

            <div className={styles.detailLogin}>
              <span>@{selected.login}</span>
              {selected.owner ? (
                <span className={styles.detailBadge}>{t.aboutContributorOwner}</span>
              ) : null}
            </div>

            <div className={styles.detailRows}>
              <div className={styles.detailRow}>
                <span>{t.aboutContributorCommits(selected.contributions)}</span>
                <span>{t.aboutContributorRank(selectedRank, ranked.length)}</span>
              </div>
              <div className={styles.detailRow}>
                <span>{t.aboutContributorFirstCommit}</span>
                <span>{selected.firstCommit}</span>
              </div>
              <div className={styles.detailRow}>
                <span>{t.aboutContributorLatestCommit}</span>
                <span>{selected.latestCommit}</span>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export default AboutPanel;
