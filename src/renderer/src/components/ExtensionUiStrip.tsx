import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Input, Typography } from "antd";
import {
	ChatbubbleEllipsesOutline,
	CheckmarkCircle,
	CheckmarkOutline,
	ChevronBackOutline,
	ChevronDownOutline,
	ChevronForwardOutline,
	CloseOutline,
} from "@renderer/components/icons/ionicons";
import type {
	ExtensionUiPending,
	ExtensionUiReply,
} from "../../../shared/extension-ui";
import { useI18n } from "@renderer/i18n/use-i18n";
import type { Messages } from "@renderer/i18n";
import { useChatStore } from "@renderer/stores/chat";
import styles from "./ExtensionUiStrip.module.css";

const TEXT_KEYS = {
	"Review Mode": "extensionUiReviewMode",
	"1. Review against a base branch (PR Style)": "extensionUiReviewBaseBranch",
	"2. Review uncommitted changes": "extensionUiReviewUncommitted",
	"3. Review a specific commit": "extensionUiReviewCommit",
	"4. Review a specific PR/MR": "extensionUiReviewPr",
	"5. Custom review instructions": "extensionUiReviewCustom",
	"Enter custom review instructions": "extensionUiReviewCustomTitle",
	"Select base branch to compare against": "extensionUiReviewBaseTitle",
	"Select commit to review": "extensionUiReviewCommitTitle",
} as const satisfies Record<string, keyof Messages>;

export function ExtensionUiStrip(): ReactNode {
	const t = useI18n();
	const chat = useChatStore();
	const [replying, setReplying] = useState(false);
	const [textDraft, setTextDraft] = useState("");
	const [selectedOption, setSelectedOption] = useState<string | null>(null);
	const [collapsed, setCollapsed] = useState(false);

	const prompt = chat.activePendingExtensionUi;

	useEffect(() => {
		const p = useChatStore.getState().activePendingExtensionUi;
		setReplying(false);
		setSelectedOption(null);
		setCollapsed(false);
		if (p?.method === "input") {
			setTextDraft("");
		} else if (p?.method === "editor") {
			setTextDraft(p.prefill ?? "");
		} else {
			setTextDraft("");
		}
	}, [prompt]);

	const localize = useCallback(
		(text: string): string => {
			const key = Object.prototype.hasOwnProperty.call(TEXT_KEYS, text)
				? TEXT_KEYS[text as keyof typeof TEXT_KEYS]
				: undefined;
			return key ? t[key] : text;
		},
		[t],
	);

	const reply = useCallback(
		async (body: ExtensionUiReply): Promise<void> => {
			if (replying) return;
			setReplying(true);
			try {
				await useChatStore.getState().replyExtensionUi(body);
			} finally {
				setReplying(false);
			}
		},
		[replying],
	);

	const onCancel = useCallback(
		async (p: ExtensionUiPending): Promise<void> => {
			await reply({ requestId: p.requestId, cancelled: true });
		},
		[reply],
	);

	const onBack = useCallback(
		async (p: ExtensionUiPending): Promise<void> => {
			await reply({ requestId: p.requestId, back: true });
		},
		[reply],
	);

	const onConfirmYes = useCallback(
		async (
			p: Extract<ExtensionUiPending, { method: "confirm" }>,
		): Promise<void> => {
			await reply({ requestId: p.requestId, confirmed: true });
		},
		[reply],
	);

	const onConfirmNo = useCallback(
		async (
			p: Extract<ExtensionUiPending, { method: "confirm" }>,
		): Promise<void> => {
			await reply({ requestId: p.requestId, confirmed: false });
		},
		[reply],
	);

	const onSelect = useCallback(
		async (
			p: Extract<ExtensionUiPending, { method: "select" }>,
			value: string,
		): Promise<void> => {
			setSelectedOption(value);
			await reply({ requestId: p.requestId, value });
		},
		[reply],
	);

	const onSubmitText = useCallback(
		async (p: ExtensionUiPending | null): Promise<void> => {
			if (!p || (p.method !== "input" && p.method !== "editor")) return;
			const value = textDraft;
			await reply({ requestId: p.requestId, value });
		},
		[reply, textDraft],
	);

	if (!prompt) return null;

	const title = localize(prompt.title);
	const canRewind =
		prompt.method === "editor" &&
		prompt.title === "Enter custom review instructions";

	return (
		<div className={styles.extUiWrap}>
			<div
				className={styles.extUiCard}
				role="dialog"
				aria-label={t.extensionUiTitle}
			>
				<header className={styles.stripHead}>
					<button
						type="button"
						className={`pi-interactive ${styles.headToggle}`}
						aria-expanded={!collapsed}
						onClick={() => setCollapsed((prev) => !prev)}
					>
						<span className={styles.headBadge} aria-hidden="true">
							<ChatbubbleEllipsesOutline size={14} />
						</span>
						<span className={styles.headTitle}>{t.extensionUiTitle}</span>
					</button>
					<button
						type="button"
						className={`pi-interactive ${styles.chevBtn}`}
						aria-label={collapsed ? t.extensionUiExpand : t.extensionUiCollapse}
						onClick={() => setCollapsed((prev) => !prev)}
					>
						{collapsed ? (
							<ChevronForwardOutline size={14} />
						) : (
							<ChevronDownOutline size={14} />
						)}
					</button>
				</header>

				{collapsed ? null : (
					<>
						<div className={styles.stripBody}>
							<div className={styles.qPrompt}>
								<span className={styles.qText}>{title}</span>
							</div>

							{prompt.method === "confirm" ? (
								<Typography.Text type="secondary" className={styles.message}>
									{prompt.message}
								</Typography.Text>
							) : null}

							{prompt.method === "select" ? (
								<>
									{prompt.message ? (
										<Typography.Text type="secondary" className={styles.message}>
											{prompt.message}
										</Typography.Text>
									) : null}
									<div className={styles.optList}>
										{prompt.options.map((opt) => (
											<button
												key={opt}
												type="button"
												className={`pi-interactive ${styles.optRow} ${
													selectedOption === opt ? styles.selected : ""
												}`}
												disabled={replying}
												onClick={() => void onSelect(prompt, opt)}
											>
												<span className={styles.optCheck} aria-hidden="true">
													{selectedOption === opt ? (
														<CheckmarkCircle size={18} />
													) : (
														<span className={styles.optRing} />
													)}
												</span>
												<span className={styles.optLabel}>{localize(opt)}</span>
											</button>
										))}
									</div>
								</>
							) : null}

							{prompt.method === "input" || prompt.method === "editor" ? (
								prompt.method === "input" ? (
									<Input
										value={textDraft}
										size="small"
										placeholder={prompt.placeholder || t.extensionUiInputPlaceholder}
										disabled={replying}
										onChange={(event) => setTextDraft(event.target.value)}
										onKeyDown={(event) => {
											if (event.key !== "Enter") return;
											event.preventDefault();
											void onSubmitText(prompt);
										}}
									/>
								) : (
									<Input.TextArea
										value={textDraft}
										rows={4}
										size="small"
										placeholder={t.extensionUiEditorPlaceholder}
										disabled={replying}
										onChange={(event) => setTextDraft(event.target.value)}
									/>
								)
							) : null}
						</div>

						<footer className={styles.stripFoot}>
							{canRewind ? (
								<Button
									type="text"
									shape="round"
									className={`pi-interactive ${styles.cancelBtn}`}
									disabled={replying}
									icon={<ChevronBackOutline />}
									onClick={() => void onBack(prompt)}
								>
									{t.extensionUiBack}
								</Button>
							) : null}
							<Button
								type="text"
								shape="round"
								className={`pi-interactive ${styles.cancelBtn}`}
								disabled={replying}
								icon={<CloseOutline />}
								onClick={() => void onCancel(prompt)}
							>
								{t.extensionUiCancel}
							</Button>
							{prompt.method === "confirm" ? (
								<div className={styles.footActions}>
									<Button
										shape="round"
										className="pi-interactive"
										disabled={replying}
										onClick={() => void onConfirmNo(prompt)}
									>
										{t.extensionUiNo}
									</Button>
									<Button
										type="primary"
										shape="round"
										className="pi-interactive"
										disabled={replying}
										loading={replying}
										icon={<CheckmarkOutline />}
										onClick={() => void onConfirmYes(prompt)}
									>
										{t.extensionUiYes}
									</Button>
								</div>
							) : null}
							{prompt.method === "input" || prompt.method === "editor" ? (
								<div className={styles.footActions}>
									<Button
										type="primary"
										shape="round"
										className="pi-interactive"
										disabled={replying}
										loading={replying}
										onClick={() => void onSubmitText(prompt)}
									>
										{t.extensionUiSubmit}
									</Button>
								</div>
							) : null}
						</footer>
					</>
				)}
			</div>
		</div>
	);
}

export default ExtensionUiStrip;
