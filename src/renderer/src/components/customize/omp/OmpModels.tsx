import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Input, InputNumber, Select, Spin } from "antd";
import {
	AddOutline,
	TrashOutline,
} from "@renderer/components/icons/ionicons";
import CodiconIcon from "@renderer/components/icons/CodiconIcon";
import {
	SettingsGroup,
	SettingsRow,
	SettingsSwitch,
} from "@renderer/components/customize/SettingsGroup";
import { useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import {
	OMP_MODEL_APIS,
	newOmpModel,
	newOmpProvider,
	type OmpModelRow,
	type OmpModelsSnapshot,
	type OmpProviderRow,
} from "../../../../../shared/omp-models";
import {
	THINKING_LEVELS,
	type ThinkingLevel,
} from "../../../../../shared/thinking-level";
import modelsStyles from "../CustomizeModels.module.css";
import styles from "./OmpModels.module.css";

/** 判断草稿是否偏离磁盘内容（保存/重置按钮据此启用）。 */
function draftKey(providers: OmpProviderRow[]): string {
	return JSON.stringify(providers);
}

function providerHint(provider: OmpProviderRow, modelCount: number): string {
	const address = provider.baseUrl.trim() || provider.api.trim();
	const parts = [address, String(modelCount)].filter(Boolean);
	return parts.join(" · ");
}

/** OMP 的模型与供应商：读写 ~/.omp/agent/models.yml，与 pi 的 models.json 无关。 */
export function OmpModels(): ReactNode {
	const t = useI18n();
	const message = useMessage();
	const [snapshot, setSnapshot] = useState<OmpModelsSnapshot | null>(null);
	const [providers, setProviders] = useState<OmpProviderRow[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [saving, setSaving] = useState(false);
	/** 模型行用稳定 key，删除行时不串展开状态。 */
	const [rowKeys, setRowKeys] = useState<string[]>([]);
	const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
	const rowKeySeq = useRef(0);

	useEffect(() => {
		void (async () => {
			try {
				const next = await window.api.ompModels.get();
				setSnapshot(next);
				setProviders(next.providers);
				resetRowKeys(next.providers[0]?.models.length ?? 0);
			} catch (err) {
				message.error(err instanceof Error ? err.message : String(err));
			}
		})();
	}, [message]);

	const selected = providers[selectedIndex] ?? null;
	const dirty = snapshot ? draftKey(providers) !== draftKey(snapshot.providers) : false;

	function nextRowKey(): string {
		rowKeySeq.current += 1;
		return `m-${rowKeySeq.current}`;
	}

	function resetRowKeys(count: number): void {
		const keys: string[] = [];
		for (let i = 0; i < count; i += 1) keys.push(nextRowKey());
		setRowKeys(keys);
	}

	function toggleRow(key: string): void {
		setExpandedRows((prev) => ({ ...prev, [key]: !prev[key] }));
	}

	function selectProvider(index: number): void {
		setSelectedIndex(index);
		resetRowKeys(providers[index]?.models.length ?? 0);
	}

	function patchProvider(index: number, patch: Partial<OmpProviderRow>): void {
		setProviders((prev) =>
			prev.map((provider, i) =>
				i === index ? { ...provider, ...patch } : provider,
			),
		);
	}

	function patchModel(
		index: number,
		modelIndex: number,
		patch: Partial<OmpModelRow>,
	): void {
		setProviders((prev) =>
			prev.map((provider, i) =>
				i === index
					? {
							...provider,
							models: provider.models.map((model, j) =>
								j === modelIndex ? { ...model, ...patch } : model,
							),
						}
					: provider,
			),
		);
	}

	function addProvider(): void {
		const index = providers.length;
		setProviders((prev) => [...prev, newOmpProvider()]);
		setSelectedIndex(index);
		resetRowKeys(0);
	}

	function removeProvider(index: number): void {
		const remaining = providers.filter((_, i) => i !== index);
		const nextIndex =
			selectedIndex > 0 && selectedIndex >= index ? selectedIndex - 1 : selectedIndex;
		const clamped = Math.min(Math.max(nextIndex, 0), Math.max(remaining.length - 1, 0));
		setProviders(remaining);
		setSelectedIndex(clamped);
		resetRowKeys(remaining[clamped]?.models.length ?? 0);
	}

	function addModel(): void {
		if (!selected) return;
		const key = nextRowKey();
		patchProvider(selectedIndex, {
			models: [...selected.models, newOmpModel()],
		});
		setRowKeys((prev) => [...prev, key]);
	}

	function removeModel(modelIndex: number): void {
		if (!selected) return;
		patchProvider(selectedIndex, {
			models: selected.models.filter((_, i) => i !== modelIndex),
		});
		setRowKeys((prev) => prev.filter((_, i) => i !== modelIndex));
	}

	function reset(): void {
		if (!snapshot) return;
		setProviders(snapshot.providers);
		resetRowKeys(snapshot.providers[selectedIndex]?.models.length ?? 0);
	}

	async function save(): Promise<void> {
		setSaving(true);
		try {
			const next = await window.api.ompModels.save(providers);
			setSnapshot(next);
			setProviders(next.providers);
			resetRowKeys(next.providers[selectedIndex]?.models.length ?? 0);
			message.success(t.ompSaved);
		} catch (err) {
			message.error(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	}

	if (!snapshot) {
		return (
			<div className={styles.loading}>
				<Spin />
			</div>
		);
	}

	return (
		<div className={modelsStyles.customizeModels}>
			<div className={modelsStyles.modelsLayout}>
				<aside className={modelsStyles.modelsSidebar}>
					{providers.length === 0 ? (
						<div className={modelsStyles.sidebarEmpty}>
							<span className={modelsStyles.sidebarEmptyTitle}>
								{t.ompNoProviders}
							</span>
						</div>
					) : (
						<div className={modelsStyles.providerList}>
							{providers.map((provider, index) => (
								<button
									key={index}
									type="button"
									className={
										index === selectedIndex
											? `${modelsStyles.providerItem} ${modelsStyles.selected}`
											: modelsStyles.providerItem
									}
									onClick={() => selectProvider(index)}
								>
									<span className={modelsStyles.providerHead}>
										<span className={modelsStyles.providerName}>
											{provider.id.trim() || t.ompUnnamed}
										</span>
									</span>
									<span className={modelsStyles.providerSub}>
										{providerHint(provider, provider.models.length)}
									</span>
								</button>
							))}
						</div>
					)}
					<button
						type="button"
						className={modelsStyles.sidebarAdd}
						onClick={addProvider}
					>
						<AddOutline size={14} />
						<span>{t.ompProviderAdd}</span>
					</button>
				</aside>

				<section className={modelsStyles.modelsDetail}>
					<div className={modelsStyles.detailScroll}>
						{!selected ? (
							<div className={modelsStyles.detailEmpty}>
								<span className={modelsStyles.detailEmptyTitle}>
									{t.ompSelectProvider}
								</span>
							</div>
						) : (
							<>
								<header className={modelsStyles.detailHeader}>
									<div className={modelsStyles.detailHeading}>
										<h3 className={modelsStyles.detailTitle}>
											{selected.id.trim() || t.ompUnnamed}
										</h3>
										<span className={modelsStyles.detailSubtitle}>
											{providerHint(selected, selected.models.length)}
										</span>
									</div>
									{dirty ? (
										<span className={modelsStyles.inlineBadge}>{t.ompDirty}</span>
									) : null}
									<span className={modelsStyles.detailSpacer} />
									<button
										type="button"
										className={modelsStyles.detailRemove}
										title={t.ompProviderRemove}
										aria-label={t.ompProviderRemove}
										onClick={() => removeProvider(selectedIndex)}
									>
										<TrashOutline size={14} />
									</button>
								</header>

								<SettingsGroup title={t.ompProviderSection}>
									<SettingsRow label={t.ompProviderId}>
										<Input
											size="small"
											style={{ width: 220 }}
											value={selected.id}
											placeholder="magpie"
											onChange={(event) =>
												patchProvider(selectedIndex, {
													id: event.target.value,
												})
											}
										/>
									</SettingsRow>
									<SettingsRow label={t.ompProviderApi}>
										<Select
											size="small"
											style={{ width: 220 }}
											value={selected.api || undefined}
											placeholder="openai-completions"
											options={OMP_MODEL_APIS.map((api) => ({
												value: api,
												label: api,
											}))}
											onChange={(api) =>
												patchProvider(selectedIndex, { api })
											}
										/>
									</SettingsRow>
									<SettingsRow label={t.ompProviderBaseUrl}>
										<Input
											size="small"
											style={{ width: 280 }}
											value={selected.baseUrl}
											placeholder="https://api.example.com/v1"
											onChange={(event) =>
												patchProvider(selectedIndex, {
													baseUrl: event.target.value,
												})
											}
										/>
									</SettingsRow>
									<SettingsRow label={t.ompProviderApiKey}>
										<Input.Password
											size="small"
											style={{ width: 280 }}
											value={selected.apiKey}
											placeholder="sk-..."
											onChange={(event) =>
												patchProvider(selectedIndex, {
													apiKey: event.target.value,
												})
											}
										/>
									</SettingsRow>
								</SettingsGroup>

								<SettingsGroup title={t.ompModelsSection}>
									{selected.models.length === 0 ? (
										<p className={modelsStyles.detailSubtitle}>
											{t.ompEmptyModels}
										</p>
									) : (
											selected.models.map((model, modelIndex) => {
												const rowKey =
													rowKeys[modelIndex] ?? String(modelIndex);
												const expanded = Boolean(expandedRows[rowKey]);
												return (
													<div key={rowKey} className={modelsStyles.modelRow}>
														<div className={modelsStyles.modelRowMain}>
															<button
																type="button"
																className={
																	expanded
																		? `${modelsStyles.modelExpander} ${modelsStyles.modelExpanderOpen}`
																		: modelsStyles.modelExpander
																}
																title={t.ompModelSettings}
																aria-label={t.ompModelSettings}
																aria-expanded={expanded}
																onClick={() => toggleRow(rowKey)}
															>
																<CodiconIcon
																	name={
																		expanded
																			? "chevronDown"
																			: "chevronRight"
																	}
																	size={14}
																/>
															</button>
															<Input
																size="small"
																value={model.id}
																aria-label={t.ompModelId}
																placeholder={t.ompModelId}
																onChange={(event) =>
																	patchModel(
																		selectedIndex,
																		modelIndex,
																		{ id: event.target.value },
																	)
																}
															/>
															<Input
																size="small"
																value={model.name}
																aria-label={t.ompModelName}
																placeholder={t.ompModelName}
																onChange={(event) =>
																	patchModel(
																		selectedIndex,
																		modelIndex,
																		{ name: event.target.value },
																	)
																}
															/>
															<span className={modelsStyles.modelToggle}>
																<span className={modelsStyles.modelToggleLabel}>
																	{t.ompModelReasoning}
																</span>
																<SettingsSwitch
																	checked={model.reasoning}
																	label={t.ompModelReasoning}
																	onChange={(reasoning) =>
																		patchModel(
																			selectedIndex,
																			modelIndex,
																			{ reasoning },
																		)
																	}
																/>
															</span>
															<span className={modelsStyles.modelToggle}>
																<span className={modelsStyles.modelToggleLabel}>
																	{t.ompModelVision}
																</span>
																<SettingsSwitch
																	checked={model.vision}
																	label={t.ompModelVision}
																	onChange={(vision) =>
																		patchModel(
																			selectedIndex,
																			modelIndex,
																			{ vision },
																		)
																	}
																/>
															</span>
															<Select
																className={modelsStyles.levelSelect}
																mode="multiple"
																size="small"
																disabled={!model.reasoning}
																showSearch={false}
																defaultActiveFirstOption={false}
																maxTagCount="responsive"
																maxTagPlaceholder={(omitted) =>
																	omitted.length ? `+${omitted.length}` : ""
																}
																classNames={{
																	popup: { root: modelsStyles.levelPopup },
																}}
																title={t.modelsCustomThinkingLevels}
																aria-label={t.modelsCustomThinkingLevels}
																value={model.thinkingEfforts ?? []}
																placeholder={t.modelsCustomThinkingLevels}
																options={THINKING_LEVELS.filter(
																	(level) => level.value !== "off",
																).map((level) => ({
																	label: level.label.toLowerCase(),
																	value: level.value,
																}))}
																tagRender={(props) => (
																	<span className={modelsStyles.levelTag}>
																		{props.label}
																	</span>
																)}
																onChange={(values: ThinkingLevel[]) =>
																	patchModel(
																		selectedIndex,
																		modelIndex,
																		{
																			thinkingEfforts: THINKING_LEVELS.map(
																				(level) => level.value,
																			).filter(
																				(value) =>
																					value !== "off" &&
																					values.includes(value),
																			),
																		},
																	)
																}
															/>
															<button
																type="button"
																className={`${modelsStyles.modelAction} ${modelsStyles.modelRemove}`}
																title={t.ompModelRemove}
																aria-label={t.ompModelRemove}
																onClick={() => removeModel(modelIndex)}
															>
																<TrashOutline size={14} />
															</button>
														</div>

														{expanded ? (
															<div className={modelsStyles.modelRowBody}>
																<label className={modelsStyles.modelField}>
																	<span
																		className={modelsStyles.modelFieldLabel}
																	>
																		{t.ompModelContext}
																	</span>
																	<InputNumber
																		size="small"
																		controls={false}
																		value={model.contextWindow}
																		placeholder={t.ompModelContext}
																		min={1}
																		onChange={(value: number | null) =>
																			patchModel(
																				selectedIndex,
																				modelIndex,
																				{
																					contextWindow:
																						typeof value ===
																						"number"
																							? value
																							: null,
																				},
																			)
																		}
																	/>
																</label>
																<label className={modelsStyles.modelField}>
																	<span
																		className={modelsStyles.modelFieldLabel}
																	>
																		{t.ompModelMaxTokens}
																	</span>
																	<InputNumber
																		size="small"
																		controls={false}
																		value={model.maxTokens}
																		placeholder={t.ompModelMaxTokens}
																		min={1}
																		onChange={(value: number | null) =>
																			patchModel(
																				selectedIndex,
																				modelIndex,
																				{
																					maxTokens:
																						typeof value ===
																						"number"
																							? value
																							: null,
																				},
																			)
																		}
																	/>
																</label>
															</div>
														) : null}
													</div>
												);
											})
										)}
										<div className={styles.modelActions}>
											<Button type="text" size="small" onClick={addModel}>
												<AddOutline size={14} />
												<span>{t.ompModelAdd}</span>
											</Button>
										</div>
								</SettingsGroup>
							</>
						)}
					</div>

					{selected ? (
						<footer className={modelsStyles.detailFooter}>
							<span className={modelsStyles.detailSpacer} />
							<div className={modelsStyles.footerActions}>
								<Button size="small" disabled={!dirty} onClick={reset}>
									{t.ompReset}
								</Button>
								<Button
									size="small"
									type="primary"
									loading={saving}
									disabled={!dirty}
									onClick={() => void save()}
								>
									{t.ompSave}
								</Button>
							</div>
						</footer>
					) : null}
				</section>
			</div>
		</div>
	);
}
