import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Progress } from "antd";
import {
	CheckmarkCircleOutline,
	CloseCircleOutline,
	CloseOutline,
	DownloadOutline,
} from "@renderer/components/icons/ionicons";
import { useAppUpdateStore } from "@renderer/stores/app-update";
import { useI18n } from "@renderer/i18n/use-i18n";
import { formatBytes, formatSpeed, etaSeconds } from "@renderer/utils/update-format";
import styles from "./UpdateProgress.module.css";

/**
 * 桌面右下角的更新悬浮卡片：下载、就绪安装、失败重试都在这里完成。
 * 卡片所在窗口是独立的透明置顶窗，高度随内容上报给主进程。
 */
export function UpdateProgress(): ReactNode {
	const t = useI18n();
	const status = useAppUpdateStore((s) => s.state.status);
	const info = useAppUpdateStore((s) => s.state.info);
	const progress = useAppUpdateStore((s) => s.state.progress);
	const error = useAppUpdateStore((s) => s.state.error);
	const retryUpdate = useAppUpdateStore((s) => s.retry);
	const cancelDownload = useAppUpdateStore((s) => s.cancel);
	const installUpdate = useAppUpdateStore((s) => s.install);
	const [platform, setPlatform] = useState<NodeJS.Platform>("win32");
	const cardObserver = useRef<ResizeObserver | null>(null);

	/**
	 * 卡片在 idle/available 时不渲染，取消下载再重下会换一个 DOM 节点；
	 * 用 ref 回调在每次挂载时重建观察者，否则窗口高度会停在上一张卡片。
	 */
	const cardRef = useCallback((card: HTMLDivElement | null) => {
		cardObserver.current?.disconnect();
		cardObserver.current = null;
		if (!card) return;
		const reportHeight = (): void => {
			window.api.update.setToastHeight(card.getBoundingClientRect().height);
		};
		reportHeight();
		const observer = new ResizeObserver(reportHeight);
		observer.observe(card);
		cardObserver.current = observer;
	}, []);

	useEffect(() => {
		void window.api.window
			.platform()
			.then(setPlatform)
			.catch(() => undefined);
	}, []);

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

	const statusIcon =
		status === "error" ? (
			<CloseCircleOutline size={13} />
		) : status === "ready" ? (
			<CheckmarkCircleOutline size={13} />
		) : (
			<DownloadOutline size={13} />
		);

	return (
		<div
			ref={cardRef}
			className={`pi-update-panel ${styles.panel}`}
			role="status"
			aria-live="polite"
		>
			<div className={styles.head}>
				<span className={`${styles.icon} ${status === "error" ? styles.iconError : ""}`}>
					{statusIcon}
				</span>
				<span className={styles.title}>{title}</span>
				<button
					type="button"
					className={styles.close}
					aria-label={t.updateClose}
					title={t.updateClose}
					onClick={() => window.api.update.dismissToast()}
				>
					<CloseOutline size={14} />
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
							strokeLinecap="round"
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
						<p className={styles.detail}>{t.updateReadyDetail(info.version)}</p>
						{platform === "darwin" ? (
							<p className={styles.detail}>{t.updateMacManual}</p>
						) : null}
					</>
				) : null}

				{status === "error" ? (
					<p className={`${styles.detail} ${styles.errorText}`}>
						{error || t.updateFailed}
					</p>
				) : null}

				{status === "checking" ? (
					<p className={styles.detail}>{t.updateCheckingHint}</p>
				) : null}
			</div>

			<div className={styles.footer}>
				{status === "downloading" ? (
					<Button size="small" onClick={() => void cancelDownload()}>
						{t.updateCancel}
					</Button>
				) : null}

				{status === "ready" ? (
					<>
						<Button size="small" onClick={() => window.api.update.dismissToast()}>
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
					</>
				) : null}

				{status === "error" ? (
					<>
						<Button size="small" onClick={() => window.api.update.dismissToast()}>
							{t.updateClose}
						</Button>
						<Button size="small" type="primary" onClick={() => void retryUpdate()}>
							{t.updateRetry}
						</Button>
					</>
				) : null}
			</div>
		</div>
	);
}

export default UpdateProgress;
