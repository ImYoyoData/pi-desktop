import { useMemo, type ReactNode } from "react";
import { Button, Modal, Progress, Space, Typography } from "antd";
import MarkdownView from "@renderer/components/MarkdownView";
import { useUpdateStore } from "@renderer/stores/update";
import { useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./UpdateCard.module.css";

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdateCard(): ReactNode {
  const t = useI18n();
  const update = useUpdateStore();
  const message = useMessage();

  const title = useMemo(() => {
    if (update.available && update.latestVersion) {
      return t.updateAvailableTitle(update.latestVersion);
    }
    if (update.checking) return t.checkingUpdate;
    return t.checkUpdate;
  }, [t, update.available, update.checking, update.latestVersion]);

  const versionLine = useMemo(() => {
    const cur = update.currentVersion ? `v${update.currentVersion}` : "—";
    const latest = update.latestVersion ? `v${update.latestVersion}` : "—";
    return t.updateVersionLine(cur, latest);
  }, [t, update.currentVersion, update.latestVersion]);

  async function onDownload(): Promise<void> {
    const result = await update.download();
    if (!result) return;
    if (result.status === "downloaded") {
      message.success(t.updateDownloaded, 5);
    } else if (result.status === "cancelled") {
      message.info(t.updateCancelled, 3);
    } else if (result.status === "openedBrowser") {
      message.info(result.message, 5);
    } else if (result.status === "error") {
      message.error(result.message, 5);
    } else if (result.status === "upToDate") {
      message.success(result.message, 3);
    }
  }

  async function onOpenRelease(): Promise<void> {
    if (update.releaseUrl) {
      await window.api.browser.openExternal(update.releaseUrl);
    } else {
      await window.api.update.openReleases();
    }
  }

  async function onRefresh(): Promise<void> {
    await update.check({ openModal: true });
  }

  const progressPhase = update.progress?.phase;
  const progressStatus =
    progressPhase === "error"
      ? "exception"
      : progressPhase === "done"
        ? "success"
        : "normal";

  return (
    <Modal
      open={update.modalOpen}
      className="pi-settings-modal"
      style={{ width: "min(520px, 94vw)" }}
      title={title}
      onCancel={() => update.closeModal()}
      footer={
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Button type="text" disabled={update.busy} onClick={onRefresh}>
            {t.updateRecheck}
          </Button>
          <Space>
            <Button onClick={() => update.closeModal()}>{t.close}</Button>
            <Button disabled={update.busy} onClick={onOpenRelease}>
              {t.updateOpenRelease}
            </Button>
            {update.available && !update.downloading ? (
              <Button type="primary" disabled={update.checking} onClick={onDownload}>
                {t.updateDownload}
              </Button>
            ) : null}
            {update.downloading ? (
              <Button danger loading={update.cancelling} onClick={() => void update.cancel()}>
                {t.updateCancel}
              </Button>
            ) : null}
          </Space>
        </Space>
      }
    >
      <div className="modal-scroll">
        <div className={styles.body}>
          <div className={styles.versionLine}>{versionLine}</div>
          {update.releaseName ? (
            <div className={styles.releaseName}>{update.releaseName}</div>
          ) : null}

          {update.checking ? (
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {t.checkingUpdate}
            </Typography.Text>
          ) : update.available ? (
            <>
              <div className={styles.notesLabel}>{t.updateNotes}</div>
              <div className={styles.notes}>
                {update.releaseNotes ? (
                  <MarkdownView content={update.releaseNotes} />
                ) : (
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    {t.updateNoNotes}
                  </Typography.Text>
                )}
              </div>

              {update.downloading || update.progress ? (
                <div className={styles.progressBlock}>
                  <div className={styles.progressMsg}>
                    {progressPhase === "cancelled"
                      ? t.updateCancelled
                      : update.progress?.message || t.updateDownloading}
                  </div>
                  {progressPhase !== "cancelled" ? (
                    <Progress
                      percent={update.progressPercent ?? (update.downloading ? 0 : 100)}
                      percentPosition={{ type: "inner" }}
                      status={
                        update.downloading && update.progressPercent == null
                          ? "active"
                          : progressStatus
                      }
                    />
                  ) : null}
                  {update.progress?.totalBytes ? (
                    <div className={styles.progressBytes}>
                      {formatBytes(update.progress.receivedBytes)} /{" "}
                      {formatBytes(update.progress.totalBytes)}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : update.lastError ? (
            <Typography.Text type="danger" style={{ fontSize: 13 }}>
              {update.lastError}
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {update.statusMessage || t.updateUpToDate}
            </Typography.Text>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default UpdateCard;
