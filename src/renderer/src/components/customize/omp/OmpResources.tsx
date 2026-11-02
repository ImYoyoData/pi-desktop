import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Input } from "antd";
import path from "node:path";
import CodiconIcon from "@renderer/components/icons/CodiconIcon";
import ToggleButton from "@renderer/components/ToggleButton";
import { useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import type {
	OmpMcpTestResult,
	OmpResourceItem,
	OmpResourceKind,
	OmpResourcesSnapshot,
} from "../../../../../shared/omp-resources";
import listStyles from "../CustomizeSection.module.css";

/** OMP 的资源列表：技能 / 指令 / MCP / 扩展。 */
export function OmpResources({ kind }: { kind: OmpResourceKind }): ReactNode {
	const t = useI18n();
	const message = useMessage();
	const [snapshot, setSnapshot] = useState<OmpResourcesSnapshot | null>(null);
	const [query, setQuery] = useState("");
	const [busyId, setBusyId] = useState<string | null>(null);
	const [testing, setTesting] = useState(false);
	const [testResults, setTestResults] = useState<
		Record<string, OmpMcpTestResult>
	>({});

	useEffect(() => {
		void (async () => {
			try {
				setSnapshot(await window.api.ompResources.list());
			} catch (err) {
				message.error(err instanceof Error ? err.message : String(err));
			}
		})();
	}, [message]);

	const items = snapshot?.[kind] ?? [];
	const needle = query.trim().toLowerCase();
	const filtered = useMemo(
		() =>
			needle
				? items.filter(
						(item) =>
							item.name.toLowerCase().includes(needle) ||
							item.description.toLowerCase().includes(needle),
					)
				: items,
		[items, needle],
	);

	const groups = useMemo(() => {
		const byScope = new Map<string, OmpResourceItem[]>();
		for (const item of filtered) {
			const rows = byScope.get(item.scope) ?? [];
			rows.push(item);
			byScope.set(item.scope, rows);
		}
		return [
			{ scope: "project", rows: byScope.get("project") ?? [] },
			{ scope: "user", rows: byScope.get("user") ?? [] },
		].filter((group) => group.rows.length > 0);
	}, [filtered]);

	async function setEnabled(item: OmpResourceItem, enabled: boolean): Promise<void> {
		setBusyId(item.id);
		try {
			await window.api.ompResources.setEnabled(item, enabled);
			setSnapshot((prev) =>
				prev
					? {
							...prev,
							[kind]: prev[kind].map((row) =>
								row.id === item.id ? { ...row, enabled } : row,
							),
						}
					: prev,
			);
		} catch (err) {
			message.error(err instanceof Error ? err.message : String(err));
		} finally {
			setBusyId(null);
		}
	}

	function scopeLabel(scope: string): string {
		return scope === "project" ? t.customizeGroupProject : t.customizeGroupUser;
	}

	function scopeHint(scope: string): string {
		return scope === "project"
			? t.ompResourceProjectHint
			: t.ompResourceUserHint;
	}

	/** 逐个测试已启用的 MCP 服务器（initialize 握手 + tools/list）。 */
	async function testMcpServers(): Promise<void> {
		const targets = items.filter(
			(item) => item.kind === "mcp" && item.enabled,
		);
		if (!targets.length || testing) return;
		setTesting(true);
		setTestResults({});
		try {
			const results = await window.api.ompResources.testMcp(
				targets.map((item) => ({
					name: item.name,
					scope: item.scope,
					workspace: item.scope === "project" ? workspaceOf(item) : undefined,
				})),
			);
			const next: Record<string, OmpMcpTestResult> = {};
			for (const result of results) next[result.name] = result;
			setTestResults(next);
		} catch (err) {
			message.error(err instanceof Error ? err.message : String(err));
		} finally {
			setTesting(false);
		}
	}

	/** 项目级条目反推工作区路径：`<workspace>/.omp/mcp.json`。 */
	function workspaceOf(item: OmpResourceItem): string | undefined {
		if (item.scope !== "project") return undefined;
		const marker = `${path.sep}.omp${path.sep}`;
		const index = item.filePath.lastIndexOf(marker);
		return index > 0 ? item.filePath.slice(0, index) : undefined;
	}

	/** 测试结果徽标：与 pi 侧同一套样式。 */
	function testBadge(
		item: OmpResourceItem,
	): { text: string; tone: "ok" | "fail" | "pending" } | null {
		if (item.kind !== "mcp" || !item.enabled) return null;
		if (testing) return { text: t.customizeMcpTesting, tone: "pending" };
		const result = testResults[item.name];
		if (!result) return null;
		if (result.ok) {
			return {
				text: t.customizeMcpTestOk(
					result.toolCount,
					(result.durationMs / 1000).toFixed(1),
				),
				tone: "ok",
			};
		}
		const error = result.error === "timeout" ? t.customizeMcpTestTimeout : (result.error ?? "");
		return { text: t.customizeMcpTestFailed(error), tone: "fail" };
	}

	return (
		<div className={listStyles.customizeList}>
			<div className={listStyles.listSearchAndButtonContainer}>
				<div className={listStyles.listSearchContainer}>
					<Input
						value={query}
						size="small"
						allowClear
						placeholder={t.customizeSearchPlaceholder}
						onChange={(event) => setQuery(event.target.value)}
					/>
				</div>
				<div className={listStyles.listAddButtonContainer}>
					{kind === "mcp" ? (
						<Button
							size="small"
							loading={testing}
							disabled={!items.some((item) => item.enabled)}
							onClick={() => void testMcpServers()}
						>
							{t.customizeMcpTest}
						</Button>
					) : null}
					<Button
						size="small"
						onClick={() => {
							void (async () => {
								try {
									setSnapshot(await window.api.ompResources.list());
								} catch (err) {
									message.error(
										err instanceof Error ? err.message : String(err),
									);
								}
							})();
						}}
					>
						{t.reload}
					</Button>
				</div>
			</div>

			{!groups.length ? (
				<div className={listStyles.listEmptyState}>
					<div>
						<span className={listStyles.emptyStateText}>
							{t.ompResourceEmpty}
						</span>
					</div>
					<div className={listStyles.emptyStateSubtext}>
						{t.ompResourceEmptyHint}
					</div>
				</div>
			) : (
				<div className={listStyles.listContainer}>
					{groups.map((group) => (
						<div key={group.scope} className={listStyles.groupBlock}>
							<div className={listStyles.aiCustomizationGroupHeader}>
								<span className={listStyles.groupLabelGroup}>
									<span className={listStyles.groupLabel}>
										{scopeLabel(group.scope)}
									</span>
								</span>
								<span className={listStyles.groupCount}>
									{group.rows.length}
								</span>
								<span
									className={listStyles.groupInfo}
									title={scopeHint(group.scope)}
								>
									<CodiconIcon name="about" size={14} />
								</span>
							</div>

							{group.rows.map((item) => {
								const badge = testBadge(item);
								return (
									<div
										key={item.id}
										className={listStyles.aiCustomizationListItem}
									>
										<div className={listStyles.itemLeft}>
											<div className={listStyles.itemText}>
												<div className={listStyles.itemNameRow}>
													<span className={listStyles.itemName}>
														{item.name}
													</span>
													{item.enabled ? null : (
														<span className={listStyles.inlineBadge}>
															{t.customizeDisabled}
														</span>
													)}
													{badge ? (
														<span
															className={`${listStyles.inlineBadge} ${listStyles.testBadge}${
																badge.tone === "ok"
																	? ` ${listStyles.isOk}`
																	: badge.tone === "fail"
																		? ` ${listStyles.isFail}`
																		: ""
															}`}
														>
															{badge.text}
														</span>
													) : null}
												</div>
												{item.description ? (
													<div className={listStyles.itemDescription}>
														{item.description}
													</div>
												) : null}
											</div>
										</div>
										<div
											className={`${listStyles.itemRight} ${listStyles.itemRightPinned}`}
										>
											{item.extensionId || item.kind === "mcp" ? (
												<ToggleButton
													value={item.enabled}
													title={
														item.enabled
															? t.customizeDisable
															: t.customizeEnable
													}
													loading={busyId === item.id}
													onValueChange={(value) =>
														void setEnabled(item, value)
													}
												/>
											) : null}
										</div>
									</div>
								);
							})}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
