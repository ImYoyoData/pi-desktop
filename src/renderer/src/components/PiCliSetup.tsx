import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Modal, Progress, Space, Typography } from "antd";
import { fontSizeRem } from "../../../shared/appearance";
import { useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import type { PiCliInstallProgress, PiCliStatus } from "../../../shared/pi-cli";
import styles from "./PiCliSetup.module.css";

export function PiCliSetup(): ReactNode {
  const t = useI18n();
  const message = useMessage();
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState<PiCliStatus | null>(null);
  const [progress, setProgress] = useState<PiCliInstallProgress | null>(null);

  const platformLabel = (() => {
    const p = status?.platform;
    if (p === "darwin") return "macOS";
    if (p === "win32") return "Windows";
    if (p === "linux") return "Linux";
    return p ?? "";
  })();

  const methodHint = (() => {
    const methods = status?.availableMethods ?? [];
    if (!methods.length) return t.piCliNoMethod;
    const preferred = status?.preferredMethod;
    return t.piCliMethodHint(methods.join(" → "), preferred ?? methods[0]!);
  })();

  const progressPercent = (() => {
    const phase = progress?.phase;
    switch (phase) {
      case "detect":
        return 15;
      case "install":
        return 55;
      case "verify":
        return 85;
      case "done":
        return 100;
      case "error":
        return 100;
      default:
        return installing ? 30 : 0;
    }
  })();

  const checkPrompt = useCallback(async (): Promise<void> => {
    try {
      if (!window.api?.piCli?.shouldPrompt) return;
      const result = await window.api.piCli.shouldPrompt();
      setStatus(result.status);
      setOpen(result.prompt);
    } catch {
      // ignore probe failures on startup — never block the app shell
    }
  }, []);

  const onInstall = useCallback(async (): Promise<void> => {
    if (installing) return;
    setInstalling(true);
    setProgress({ phase: "detect", method: null, message: t.piCliInstalling });
    try {
      const result = await window.api.piCli.install();
      setStatus(result.status);
      if (result.ok) {
        if (result.status.installed) {
          message.success(t.piCliInstallOk, 3.5);
        } else if (result.openedExternal) {
          message.info(t.piCliInstallStarted, 7);
        } else {
          message.info(t.piCliInstallNeedRestart, 7);
        }
        setOpen(false);
      } else {
        message.error(result.error || t.piCliInstallFail, 7);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : t.piCliInstallFail, 7);
    } finally {
      setInstalling(false);
    }
  }, [installing, message, t]);

  const onSkip = useCallback(async (): Promise<void> => {
    await window.api.piCli.skip();
    setOpen(false);
  }, []);

  const onOpenSite = useCallback(async (): Promise<void> => {
    await window.api.piCli.openSite();
  }, []);

  const onOpenDocs = useCallback(async (): Promise<void> => {
    await window.api.piCli.openDocs();
  }, []);

  useEffect(() => {
    const offProgress = window.api.piCli.onProgress((p) => {
      setProgress(p);
    });
    // Defer CLI probe so it never contends with first paint / workspace restore.
    const timer = window.setTimeout(() => {
      void checkPrompt();
    }, 1500);
    return () => {
      offProgress();
      window.clearTimeout(timer);
    };
  }, [checkPrompt]);

  return (
    <Modal
      open={open}
      title={t.piCliMissingTitle}
      className="pi-settings-modal"
      width="min(480px, 92vw)"
      maskClosable={!installing}
      closable={!installing}
      onCancel={() => {
        if (!installing) void onSkip();
      }}
      footer={
        <div className={styles.footer}>
          <Button disabled={installing} onClick={() => void onSkip()}>
            {t.piCliSkip}
          </Button>
          <Space size={8}>
            <Button disabled={installing} onClick={() => void onOpenSite()}>
              {t.piCliOpenSite}
            </Button>
            <Button
              type="primary"
              loading={installing}
              onClick={() => void onInstall()}
            >
              {t.piCliInstall}
            </Button>
          </Space>
        </div>
      }
    >
      <div className="modal-scroll">
        <Typography.Text
          type="secondary"
          style={{ fontSize: fontSizeRem(13), display: "block", lineHeight: 1.55 }}
        >
          {t.piCliMissingBody(platformLabel)}
        </Typography.Text>
        <Typography.Text
          type="secondary"
          style={{
            fontSize: fontSizeRem(12),
            display: "block",
            marginTop: 10,
            lineHeight: 1.5,
          }}
        >
          {methodHint}
        </Typography.Text>
        <Typography.Text
          type="secondary"
          style={{ fontSize: fontSizeRem(12), display: "block", marginTop: 8 }}
        >
          {t.piCliDocsHint}
          <button
            type="button"
            className={styles.link}
            onClick={() => void onOpenSite()}
          >
            pi.dev
          </button>
          ·
          <button
            type="button"
            className={styles.link}
            onClick={() => void onOpenDocs()}
          >
            {t.piCliOpenDocs}
          </button>
        </Typography.Text>

        {installing || progress ? (
          <div className={styles.progress}>
            <Typography.Text style={{ fontSize: fontSizeRem(12) }}>
              {progress?.message || t.piCliInstalling}
            </Typography.Text>
            <Progress
              percent={progressPercent}
              status={progress?.phase === "error" ? "exception" : "normal"}
              showInfo={false}
              style={{ marginTop: 8 }}
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export default PiCliSetup;
