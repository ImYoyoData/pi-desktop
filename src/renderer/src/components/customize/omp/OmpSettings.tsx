import {
	useCallback,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import { Input, InputNumber, Select, Spin } from "antd";
import { createOmpSettingsWriter } from "@renderer/utils/omp-settings-writer";
import {
	SettingsGroup,
	SettingsRow,
	SettingsSwitch,
} from "@renderer/components/customize/SettingsGroup";
import { useMessage } from "@renderer/services/feedback";
import { useI18n, useUiLocale } from "@renderer/i18n/use-i18n";
import { ompTabTitle } from "@renderer/utils/omp-tab-title";
import {
	ompGroupTitle,
	ompSettingDescription,
	ompSettingLabel,
	ompTabLead,
} from "../../../../../shared/omp-settings-text";
import {
	OMP_SETTINGS_TABS,
	ompEffectiveValue,
	ompSettingVisible,
	ompSettingsForTab,
	type OmpSettingEntry,
	type OmpSettingsSnapshot,
} from "../../../../../shared/omp-settings";
import styles from "./OmpSettings.module.css";

/** 枚举选项文案：omp 给 label 时用它，否则用裸值。 */
function optionLabel(entry: OmpSettingEntry, value: string): string {
	return entry.options?.find((option) => option.value === value)?.label ?? value;
}

function Control({
	entry,
	value,
	onChange,
}: {
	entry: OmpSettingEntry;
	value: unknown;
	onChange: (next: unknown) => void;
}): ReactNode {
	const t = useI18n();
	if (entry.type === "boolean") {
		return (
			<SettingsSwitch
				checked={value === true}
				label={entry.label}
				onChange={(checked) => onChange(checked)}
			/>
		);
	}
	if (entry.type === "number") {
		return (
			<InputNumber
				size="small"
				style={{ width: 140 }}
				value={typeof value === "number" ? value : null}
				onChange={(next) => onChange(typeof next === "number" ? next : null)}
			/>
		);
	}
	if (entry.type === "enum") {
		return (
			<Select
				size="small"
				style={{ width: 220 }}
				allowClear
				placeholder={t.ompPlaceholderDefault}
				value={typeof value === "string" ? value : undefined}
				options={(entry.values ?? []).map((option) => ({
					value: option,
					label: optionLabel(entry, option),
				}))}
				onChange={(next) => onChange(next ?? null)}
			/>
		);
	}
	if (entry.type === "array") {
		const text = Array.isArray(value)
			? value.filter((item): item is string => typeof item === "string").join(", ")
			: "";
		return (
			<Input
				size="small"
				style={{ width: 280 }}
				value={text}
				placeholder={t.ompPlaceholderList}
				onChange={(event) => {
					const items = event.target.value
						.split(",")
						.map((item) => item.trim())
						.filter(Boolean);
					onChange(items.length ? items : null);
				}}
			/>
		);
	}
	const text = typeof value === "string" ? value : "";
	const commit = (next: string): void => onChange(next.trim() ? next : null);
	if (entry.secret || entry.credential) {
		return (
			<Input.Password
				size="small"
				style={{ width: 280 }}
				value={text}
				placeholder={t.ompPlaceholderDefault}
				onChange={(event) => commit(event.target.value)}
			/>
		);
	}
	const options = entry.values;
	if (options?.length) {
		return (
			<Select
				size="small"
				style={{ width: 220 }}
				allowClear
				placeholder={t.ompPlaceholderDefault}
				value={text || undefined}
				options={options.map((option) => ({
					value: option,
					label: optionLabel(entry, option),
				}))}
				onChange={(next) => commit(next ?? "")}
			/>
		);
	}
	return (
		<Input
			size="small"
			style={{ width: 280 }}
			value={text}
			placeholder={t.ompPlaceholderDefault}
			onChange={(event) => commit(event.target.value)}
		/>
	);
}

/**
 * 一个 omp 设置 tab：按 omp 自己的 group 分卡片。
 *
 * 改动即写入 omp 的 config.yml（防抖合并），不再需要保存按钮；
 * 写入失败时提示并回到磁盘上的真实值。
 */
export function OmpSettings({ tab }: { tab: string }): ReactNode {
	const t = useI18n();
	const locale = useUiLocale();
	const message = useMessage();
	const meta = OMP_SETTINGS_TABS.find((entry) => entry.id === tab);
	const lead = ompTabLead(locale, tab) ?? meta?.lead ?? "";
	const entries = useMemo(() => ompSettingsForTab(tab), [tab]);
	const [snapshot, setSnapshot] = useState<OmpSettingsSnapshot | null>(null);
	const [values, setValues] = useState<Record<string, unknown>>({});
	const [query, setQuery] = useState("");

	const load = useCallback(async (): Promise<void> => {
		const next = await window.api.ompSettings.get();
		setSnapshot(next);
		setValues(next.values);
	}, []);

	useEffect(() => {
		void load().catch((err: unknown) => {
			message.error(err instanceof Error ? err.message : String(err));
		});
	}, [load, message]);

	const writer = useMemo(
		() =>
			createOmpSettingsWriter(
				(patch) => window.api.ompSettings.save(patch),
				(err) => {
					const reason = err instanceof Error ? err.message : String(err);
					message.error(`${t.ompSaveFailed}${reason}`);
					// 写失败：回到磁盘上的真实状态，不留与磁盘不一致的界面。
					void load().catch(() => {
						// 读也失败时只能保留当前界面值。
					});
				},
			),
		[load, message, t.ompSaveFailed],
	);

	// 切 tab 或卸载前把未写入的改动落盘。
	useEffect(() => () => writer.flush(), [writer]);

	const needle = query.trim().toLowerCase();
	const groups = useMemo(() => {
		const byGroup = new Map<string, OmpSettingEntry[]>();
		const order = meta?.groups ?? [];
		for (const entry of entries) {
			// 条件不满足的项不显示：桌面端按 omp 同样的依据判定。
			if (!ompSettingVisible(entry, values)) continue;
			if (
				needle &&
				!entry.id.toLowerCase().includes(needle) &&
				!entry.label.toLowerCase().includes(needle) &&
				!entry.description.toLowerCase().includes(needle)
			) {
				continue;
			}
			const key = entry.group ?? "";
			const rows = byGroup.get(key) ?? [];
			rows.push(entry);
			byGroup.set(key, rows);
		}
		const ungrouped = byGroup.get("") ?? [];
		const titled = order
			.map((group) => ({ title: group, rows: byGroup.get(group) ?? [] }))
			.filter((group) => group.rows.length > 0);
		return ungrouped.length
			? [{ title: t.ompSettingsGeneral, rows: ungrouped }, ...titled]
			: titled;
	}, [entries, meta, values, needle, t.ompSettingsGeneral]);

	function setValue(id: string, next: unknown): void {
		setValues((prev) => {
			const draft = { ...prev };
			if (next === null || next === undefined) delete draft[id];
			else draft[id] = next;
			return draft;
		});
		writer.queue({ [id]: next });
	}

	/** 恢复默认：删掉该键，让 omp 回到自身默认值。 */
	function resetValue(entry: OmpSettingEntry): void {
		setValue(entry.id, null);
	}

	if (!snapshot) {
		return (
			<div className={styles.loading}>
				<Spin />
			</div>
		);
	}

	return (
		<div className={styles.page}>
			<header className={styles.header}>
				<div className={styles.headerText}>
					<h2 className={styles.title}>{ompTabTitle(t, tab)}</h2>
					{lead ? <p className={styles.hint}>{lead}</p> : null}
				</div>
				<div className={styles.headerActions}>
					<Input
						size="small"
						allowClear
						style={{ width: 200 }}
						placeholder={t.customizeSearchPlaceholder}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
				</div>
			</header>

			<div className={styles.scroll}>
				{groups.length === 0 ? (
					<p className={styles.empty}>{t.ompNoSettings}</p>
				) : null}
				{groups.map((group) => (
					<SettingsGroup
						key={group.title}
						title={ompGroupTitle(locale, group.title) ?? group.title}
					>
						{group.rows.map((entry) => {
							const description = ompSettingDescription(
								locale,
								entry.id,
								entry.description,
							);
							const isSet = Object.prototype.hasOwnProperty.call(
								values,
								entry.id,
							);
							const value = ompEffectiveValue(entry, values);
							return (
								<SettingsRow
									key={entry.id}
									label={ompSettingLabel(locale, entry.id, entry.label)}
									description={
										entry.warning
											? `⚠ ${entry.warning} ${description}`
											: description
									}
								>
									<div className={styles.control}>
										<Control
											entry={entry}
											value={value}
											onChange={(next) => setValue(entry.id, next)}
										/>
										{isSet ? (
											<button
												type="button"
												className={styles.resetButton}
												title={t.ompRestoreDefault}
												onClick={() => resetValue(entry)}
											>
												{t.ompRestoreDefault}
											</button>
										) : null}
									</div>
								</SettingsRow>
							);
						})}
					</SettingsGroup>
				))}
			</div>
		</div>
	);
}
