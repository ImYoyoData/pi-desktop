import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Progress, Space, Typography } from "antd";
import { CloseOutline, DownloadOutline } from "@renderer/components/icons/ionicons";
import { useAppUpdateStore } from "@renderer/stores/app-update";
import { useI18n } from "@renderer/i18n/use-i18n";
import { formatBytes, formatSpeed, etaSeconds } from "@renderer/utils/update-format";
import styles from "./UpdateProgress.module.css";

/** 桌面右下角的更新下载进度框：下载、就绪安装、失败重试都在这里完成。 */
export function UpdateProgress(): ReactNode {
	const t = useI18n();
	const status = useAppUpdateStore((s) => s.state.status);
	const info = useAppUpdateStore((s) => s.state.info);
	const progress = useAppUpdateStore((s) => s.state.progress);
	const error = useAppUpdateStore((s) => s.state.error);
	const panelOpen = useAppUpdateStore((s) => s.panelOpen);
	const retryUpdate = useAppUpdateStore((s) => s.retry);
	const cancelDownload = useAppUpdateStore((s) => s.cancel);
	const installUpdate = useAppUpdateStore((s) => s.install);
	const closePanel = useAppUpdateStore((s) => s.closePanel);
	const [platform, setPlatform] = useState<NodeJS.Platform>("win32");

	useEffect(() => {
		void window.api.window
			.platform()
			.then(setPlatform)
			.catch(() => undefined);
	}, []);

	if (!panelOpen) return null;
	if (status === "idle" || status === "available") return null;

	const percent = progress?.percent ?? 0;
	const transferred = progress?.transferred ?? 0;
	const total = progress?.total ?? info?.size ?? 0;
	const remaining = Math.max(0, total - transferred);
	const eta = progress ? etaSeconds(remaining, progress.bytesPerSecond) : null;

	const title = ((): string => {
		if (status === "checking") return t.updateChecking;
		if (status === "downloading") return t.updateDownloading;
		if (status === "ready") return t.updateReady;
		return t.updateFailed;
	})();

	return createPortal(
		<div className={`pi-update-panel ${styles.panel}`} role="status" aria-live="polite">
			<div className={styles.head}>
				<span className={styles.title}>{title}</span>
				<button
					type="button"
					className={styles.close}
					aria-label={t.updateClose}
					title={t.updateClose}
					onClick={() => closePanel()}
				>
					<CloseOutline size={13} />
				</button>
			</div>

			<div className={styles.body}>
				{status === "downloading" ? (
					<>
						<Progress
							percent={percent}
							size="small"
							showInfo={false}
							status="active"
							railColor="var(--border-strong)"
						/>
						<div className={styles.meta}>
							<span>{formatSpeed(progress?.bytesPerSecond ?? 0)}</span>
							<span>
								{formatBytes(transferred)}
								{total > 0 ? ` / ${formatBytes(total)}` : ""}
							</span>
							{eta !== null ? <span>{t.updateEta(eta)}</span> : null}
						</div>
					</>
				) : null}

				{status === "ready" && info ? (
					<>
						<Typography.Text type="secondary" style={{ fontSize: 12 }}>
							{t.updateReadyDetail(info.version)}
						</Typography.Text>
						{platform === "darwin" ? (
							<Typography.Text
								type="secondary"
								style={{ fontSize: 12, display: "block", marginTop: 6 }}
							>
								{t.updateMacManual}
							</Typography.Text>
						) : null}
					</>
				) : null}

				{status === "error" ? (
					<Typography.Text type="danger" style={{ fontSize: 12 }}>
						{error || t.updateFailed}
					</Typography.Text>
				) : null}

				{status === "checking" ? (
					<Typography.Text type="secondary" style={{ fontSize: 12 }}>
						{t.updateCheckingHint}
					</Typography.Text>
				) : null}
			</div>

			<div className={styles.footer}>
				{status === "downloading" ? (
					<Button size="small" onClick={() => void cancelDownload()}>
						{t.updateCancel}
					</Button>
				) : null}

				{status === "ready" ? (
					<Space size={8}>
						<Button size="small" onClick={() => closePanel()}>
							{t.updateLater}
						</Button>
						<Button
							size="small"
							type="primary"
							icon={<DownloadOutline size={13} />}
							onClick={() => void installUpdate()}
						>
							{platform === "darwin"
								? t.updateInstallOpenImage
								: t.updateInstallRestart}
						</Button>
					</Space>
				) : null}

				{status === "error" ? (
					<Space size={8}>
						<Button size="small" onClick={() => closePanel()}>
							{t.updateClose}
						</Button>
						<Button size="small" type="primary" onClick={() => void retryUpdate()}>
							{t.updateRetry}
						</Button>
					</Space>
				) : null}
			</div>
		</div>,
		document.body,
	);
}

export default UpdateProgress;
