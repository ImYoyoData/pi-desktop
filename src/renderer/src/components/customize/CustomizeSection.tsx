import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Button, Dropdown, Input, Select } from "antd";
import type { MenuProps } from "antd";
import CodiconIcon from "@renderer/components/icons/CodiconIcon";
import ToggleButton from "@renderer/components/ToggleButton";
import McpAddModal from "@renderer/components/customize/McpAddModal";
import McpLoginModal from "@renderer/components/customize/McpLoginModal";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useScopedWorkspaces } from "@renderer/utils/scoped-workspaces";
import { useCustomizationsStore } from "@renderer/stores/customizations";
import { usePluginUpdatesStore } from "@renderer/stores/plugin-updates";
import type {
  CustomizationItem,
  CustomizationScope,
  McpAuthState,
  McpAuthTarget,
  McpEditTarget,
  McpProjectOverride,
  McpTestResult,
} from "../../../../shared/customizations";
import type { PluginUpdateProgress, PluginVersionInfo } from "../../../../shared/pi-market";
import { useDialog, useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./CustomizeSection.module.css";

type SectionKind = "agents" | "skills" | "instructions" | "prompts" | "mcp" | "plugins";
type MenuItem = NonNullable<MenuProps["items"]>[number];

type Props = {
  kind: SectionKind;
  items: CustomizationItem[];
  onRefresh?: () => void;
  onMarket?: () => void;
  onOpen?: (payload: { filePath: string; title: string; rename: boolean }) => void;
  onNewDraft?: (payload: {
    kind: "skills" | "agents" | "instructions" | "prompts";
    scope: "user" | "project";
    workspace: string | null;
  }) => void;
};

const GROUP_ORDER: CustomizationScope[] = ["project", "user", "builtin", "extension"];

export function CustomizeSection({
  kind,
  items,
  onRefresh,
  onMarket,
  onOpen,
  onNewDraft,
}: Props): ReactNode {
  const workspace = useWorkspaceStore();
  const store = useCustomizationsStore();
  const dialog = useDialog();
  const message = useMessage();
  const t = useI18n();

  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [mcpEdit, setMcpEdit] = useState<McpEditTarget | null>(null);
  const [mcpTesting, setMcpTesting] = useState(false);
  const [mcpTestResults, setMcpTestResults] = useState<Record<string, McpTestResult>>({});
  const [mcpAuthStates, setMcpAuthStates] = useState<Record<string, McpAuthState>>({});
  const [mcpOverrides, setMcpOverrides] = useState<Record<string, "enabled" | "disabled">>({});
  const [mcpLoginTarget, setMcpLoginTarget] = useState<McpAuthTarget | null>(null);
  const [collapsed, setCollapsed] = useState<Set<CustomizationScope>>(() => new Set());
  const pluginUpdates = usePluginUpdatesStore();

  function groupLabel(scope: CustomizationScope): string {
    switch (scope) {
      case "project":
        return t.customizeGroupProject;
      case "user":
        return t.customizeGroupUser;
      case "builtin":
        return t.customizeGroupBuiltin;
      default:
        return t.customizeGroupExtension;
    }
  }

  function groupHint(scope: CustomizationScope): string {
    switch (scope) {
      case "project":
        return t.customizeGroupProjectHint;
      case "user":
        return t.customizeGroupUserHint;
      case "builtin":
        return t.customizeGroupBuiltinHint;
      default:
        return t.customizeGroupExtensionHint;
    }
  }

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? items.filter(
        (item) =>
          item.name.toLowerCase().includes(needle) ||
          item.description.toLowerCase().includes(needle) ||
          (item.detail ?? "").toLowerCase().includes(needle),
      )
    : items;

  const grouped = GROUP_ORDER.map((scope) => ({
    scope,
    label: groupLabel(scope),
    hint: groupHint(scope),
    items: filtered.filter((item) => item.scope === scope),
  })).filter((group) => group.items.length > 0);

  function emptyLabel(): string {
    switch (kind) {
      case "agents":
        return t.customizeAgents;
      case "skills":
        return t.customizeSkills;
      case "instructions":
        return t.customizeInstructions;
      case "prompts":
        return t.customizePrompts;
      case "mcp":
        return t.customizeMcp;
      default:
        return t.customizePlugins;
    }
  }

  function createLabel(): string {
    switch (kind) {
      case "agents":
        return t.customizeNewAgent;
      case "skills":
        return t.customizeNewSkill;
      case "prompts":
        return t.customizeNewPrompt;
      default:
        return t.customizeNewInstructions;
    }
  }

  function toggleGroup(scope: CustomizationScope): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  /** 新建或配置文件的名字：技能取父目录名，其余取去掉扩展名的文件名。 */
  function titleFromPath(filePath: string): string {
    const parts = filePath.split(/[/\\]/);
    const file = (parts.pop() ?? filePath).replace(/\.disabled$/i, "");
    const stem = file.replace(/\.[^.]+$/, "");
    return stem.toLowerCase() === "skill" ? (parts.pop() ?? stem) : stem;
  }

  function openItem(item: CustomizationItem): void {
    if (kind === "plugins") {
      if (!item.filePath) {
        message.error(t.customizePluginPathMissing);
        return;
      }
      void window.api.workspace.revealInFolder(item.filePath).catch((err) => {
        message.error(err instanceof Error ? err.message : String(err));
      });
      return;
    }
    if (!item.filePath) return;
    onOpen?.({
      filePath: item.filePath,
      title: item.name,
      rename:
        (kind === "skills" || kind === "agents") &&
        (item.scope === "user" || item.scope === "project"),
    });
  }

  async function copyPath(item: CustomizationItem): Promise<void> {
    if (!item.filePath) return;
    try {
      await navigator.clipboard.writeText(item.filePath);
      message.success(t.customizePathCopied);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  function pluginScope(item: CustomizationItem): "global" | "project" {
    return item.scope === "project" ? "project" : "global";
  }

  async function setEnabled(item: CustomizationItem, enabled: boolean): Promise<void> {
    try {
      if (kind === "skills" && item.filePath) {
        // 先本地生效，写入失败再回滚，避免列表整表刷新。
        store.setSkillEnabled(item.id, enabled);
        try {
          await window.api.skills.setDisabled(
            item.filePath,
            !enabled,
            workspace.root ?? undefined,
          );
        } catch (err) {
          store.setSkillEnabled(item.id, !enabled);
          throw err;
        }
        return;
      } else if (kind === "agents" && item.filePath) {
        const { filePath } = await window.api.customizations.setItemEnabled(
          item.filePath,
          enabled,
          workspace.root ?? undefined,
        );
        store.setFileItemEnabled(kind, item.id, enabled, filePath);
        return;
      } else if (kind === "prompts" && item.filePath) {
        const { filePath } = await window.api.customizations.setItemEnabled(
          item.filePath,
          enabled,
          workspace.root ?? undefined,
        );
        store.setFileItemEnabled(kind, item.id, enabled, filePath);
        return;
      } else if (kind === "plugins" && item.source) {
        // 先本地生效，写入失败再回滚，避免列表整表刷新。
        store.setPluginEnabled(item.id, enabled);
        try {
          await window.api.plugins.setEnabled(
            item.source,
            pluginScope(item),
            enabled,
            workspace.root ?? undefined,
          );
        } catch (err) {
          store.setPluginEnabled(item.id, !enabled);
          throw err;
        }
        return;
      } else if (kind === "mcp") {
        // 先本地生效，写入失败再回滚，避免列表整表刷新。
        store.setMcpEnabled(item.id, enabled);
        try {
          await window.api.customizations.setMcpEnabled(
            item.name,
            item.scope === "project" ? "project" : "user",
            enabled,
            workspace.root ?? undefined,
          );
        } catch (err) {
          store.setMcpEnabled(item.id, !enabled);
          throw err;
        }
        return;
      }
      onRefresh?.();
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  /** 用户级与工作区级的智能体文件可启停、可删除。 */
  function isEditableItem(item: CustomizationItem): boolean {
    return (item.scope === "user" || item.scope === "project") && Boolean(item.filePath);
  }

  function canToggle(item: CustomizationItem): boolean {
    if (kind === "skills") return Boolean(item.filePath) && item.enabled !== undefined;
    if (kind === "mcp") return item.enabled !== undefined;
    if (kind === "agents" || kind === "prompts") return isEditableItem(item);
    return kind === "plugins" && Boolean(item.source);
  }

  /** 检查插件版本，结果缓存到 store，切换设置页后仍显示版本徽标与升级按钮。 */
  async function checkPluginUpdateState(): Promise<void> {
    try {
      const list = await pluginUpdates.check(workspace.root ?? undefined);
      if (!list) return;
      const count = list.filter((info) => info.hasUpdate).length;
      if (count > 0) message.success(t.customizeUpdatesFound(count));
      else message.success(t.customizeNoUpdates);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  function versionInfoOf(item: CustomizationItem): PluginVersionInfo | undefined {
    return item.source ? pluginUpdates.versions[item.id] : undefined;
  }

  /** 行内版本文案：有更新时显示「本地 → 最新」，否则只显示本地版本。 */
  function versionLabel(item: CustomizationItem): string {
    const info = versionInfoOf(item);
    if (!info?.currentVersion) return "";
    if (info.hasUpdate && info.latestVersion) {
      return `${info.currentVersion} → ${info.latestVersion}`;
    }
    return info.currentVersion;
  }

  function progressOf(item: CustomizationItem): PluginUpdateProgress | undefined {
    return item.source ? pluginUpdates.progress[item.id] : undefined;
  }

  /** 进度文案：git 显示真实百分比，npm 显示正在获取的包名。 */
  function progressLabel(progress: PluginUpdateProgress): string {
    if (progress.phase === "fetch") {
      if (progress.percent !== undefined) return t.pluginUpdateDownloading(progress.percent);
      if (progress.packageName) return t.pluginUpdateFetching(progress.packageName);
    }
    return t.pluginUpdatePreparing;
  }

  function progressLabelOf(item: CustomizationItem): string {
    const progress = progressOf(item);
    return progress ? progressLabel(progress) : "";
  }

  function isUpgrading(id: string): boolean {
    return pluginUpdates.upgrading.has(id);
  }

  /** 升级单个插件：就地更新该行版本，不整页刷新，也不影响其他行的按钮。 */
  async function upgradePlugin(item: CustomizationItem): Promise<void> {
    if (!item.source) return;
    try {
      const done = await pluginUpdates.upgrade(
        item.id,
        item.source,
        pluginScope(item),
        workspace.root ?? undefined,
      );
      if (done) message.success(t.customizeUpdated(item.name));
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  const { paths: scopedWorkspaces, label: workspaceLabel } = useScopedWorkspaces();

  /** 新建技能/智能体/指令时先选择保存位置：用户级或某个工作区。 */
  const draftScopeOptions: MenuItem[] = [
    { label: t.customizeGroupUser, key: "user" },
    ...scopedWorkspaces.map((target) => ({
      label: workspaceLabel(target),
      key: `project:${target}`,
    })),
  ];

  type DraftKind = "skills" | "agents" | "instructions";

  /** 需要先选作用域的定制项。 */
  const draftKind: DraftKind | null =
    kind === "skills" || kind === "agents" || kind === "instructions" ? kind : null;

  function onDraftScopeSelect(key: string): void {
    const draft = draftKind;
    if (!draft) return;
    if (key.startsWith("project:")) {
      onNewDraft?.({ kind: draft, scope: "project", workspace: key.slice("project:".length) });
      return;
    }
    onNewDraft?.({ kind: draft, scope: "user", workspace: null });
  }

  const editConfigOptions: MenuItem[] = [
    { label: t.customizeGroupUser, key: "user" },
    ...scopedWorkspaces.map((target) => ({ label: workspaceLabel(target), key: `project:${target}` })),
  ];

  /** 打开 MCP 配置文件供手动编辑，不存在时由主进程写入空骨架。 */
  async function onEditConfigSelect(key: string): Promise<void> {
    const isProject = key.startsWith("project:");
    const target = isProject ? key.slice("project:".length) : "";
    if (isProject && !target) {
      message.error(t.slashNeedWorkspace);
      return;
    }
    try {
      const { filePath } = await window.api.customizations.ensureMcpConfig(
        isProject ? "project" : "user",
        isProject ? target : undefined,
      );
      onOpen?.({ filePath, title: titleFromPath(filePath), rename: false });
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  function onMcpAdded(): void {
    onRefresh?.();
  }

  function openMcpAdd(): void {
    setMcpEdit(null);
    setAddOpen(true);
  }

  /** 打开编辑弹窗；项目级工作区路径从配置文件位置反推。 */
  function openMcpEdit(item: CustomizationItem): void {
    if (item.scope !== "user" && item.scope !== "project") return;
    setMcpEdit({
      name: item.name,
      scope: item.scope,
      workspace: workspaceOf(item) ?? null,
    });
    setAddOpen(true);
  }

  const enabledMcpItems = items.filter((item) => item.enabled !== false);

  /** 从 `<workspace>/.pi/mcp.json` 反推出工作区路径。 */
  function workspaceOf(item: CustomizationItem): string | undefined {
    if (item.scope !== "project" || !item.filePath) return undefined;
    return item.filePath.replace(/[\\/]\.pi[\\/][^\\/]+$/, "");
  }

  /** 逐一测试已启用的 MCP 服务器可用性（initialize 握手 + tools/list）。 */
  async function testMcpServers(): Promise<void> {
    const target = enabledMcpItems;
    if (target.length === 0 || mcpTesting) return;
    setMcpTesting(true);
    setMcpTestResults({});
    try {
      const results = await window.api.customizations.testMcpServers(
        target.map((item) => ({
          name: item.name,
          scope: item.scope === "project" ? ("project" as const) : ("user" as const),
          workspace: workspaceOf(item),
        })),
      );
      const next: Record<string, McpTestResult> = {};
      for (const result of results) {
        const item = target.find(
          (entry) =>
            entry.name === result.name &&
            (entry.scope === "project" ? "project" : "user") === result.scope,
        );
        if (item) next[item.id] = result;
      }
      setMcpTestResults(next);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setMcpTesting(false);
    }
  }

  function testBadge(item: CustomizationItem): { text: string; tone: "ok" | "fail" | "pending" } | null {
    if (item.enabled === false) return null;
    if (mcpTesting) return { text: t.customizeMcpTesting, tone: "pending" };
    const result = mcpTestResults[item.id];
    if (!result) return null;
    if (result.ok) {
      return {
        text: t.customizeMcpTestOk(result.toolCount, (result.durationMs / 1000).toFixed(1)),
        tone: "ok",
      };
    }
    const error = result.error === "timeout" ? t.customizeMcpTestTimeout : (result.error ?? "");
    return { text: t.customizeMcpTestFailed(error), tone: "fail" };
  }

  /** MCP OAuth：登录目标、凭据状态与登录弹窗。 */
  function mcpTarget(item: CustomizationItem): McpAuthTarget {
    const target = workspaceOf(item);
    return {
      name: item.name,
      scope: item.scope === "project" ? "project" : "user",
      ...(target ? { workspace: target } : {}),
    };
  }

  function mcpAuthStateOf(item: CustomizationItem): McpAuthState | null {
    const scope = item.scope === "project" ? "project" : "user";
    return mcpAuthStates[`${scope}:${item.name}`] ?? null;
  }

  async function refreshMcpAuth(): Promise<void> {
    if (kind !== "mcp") return;
    const targets = items
      .filter((item) => item.scope === "user" || item.scope === "project")
      .map(mcpTarget);
    if (targets.length === 0) {
      setMcpAuthStates({});
      return;
    }
    try {
      setMcpAuthStates(await window.api.customizations.mcpAuthStates(targets));
    } catch {
      // 凭据状态获取失败不影响列表展示
    }
  }

  /** pi 1.0.1 项目覆盖：用户级服务器在当前工作区的启用态覆盖（.pi/mcp.json）。 */
  async function refreshMcpOverrides(): Promise<void> {
    if (kind !== "mcp" || !workspace.root) {
      setMcpOverrides({});
      return;
    }
    try {
      setMcpOverrides(await window.api.customizations.listMcpProjectOverrides(workspace.root));
    } catch {
      // 覆盖状态获取失败不影响列表展示
    }
  }

  useEffect(() => {
    void refreshMcpAuth();
    void refreshMcpOverrides();
  }, [kind, items]);

  const mcpOverrideOptions = [
    { label: t.customizeMcpOverrideInherit, value: "inherit" },
    { label: t.customizeMcpOverrideEnabled, value: "enabled" },
    { label: t.customizeMcpOverrideDisabled, value: "disabled" },
  ];

  function showMcpOverride(item: CustomizationItem): boolean {
    return kind === "mcp" && item.scope === "user" && Boolean(workspace.root);
  }

  function mcpOverrideOf(item: CustomizationItem): McpProjectOverride {
    return mcpOverrides[item.name] ?? "inherit";
  }

  async function setMcpOverride(
    item: CustomizationItem,
    value: McpProjectOverride,
  ): Promise<void> {
    const root = workspace.root;
    if (!root) return;
    const previous = mcpOverrideOf(item);
    setMcpOverrides((prev) => {
      const next = { ...prev };
      if (value === "inherit") delete next[item.name];
      else next[item.name] = value;
      return next;
    });
    try {
      await window.api.customizations.setMcpProjectOverride(item.name, value, root);
      onRefresh?.();
    } catch (err) {
      setMcpOverrides((prev) => {
        const rollback = { ...prev };
        if (previous === "inherit") delete rollback[item.name];
        else rollback[item.name] = previous;
        return rollback;
      });
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  function openMcpLogin(item: CustomizationItem): void {
    setMcpLoginTarget(mcpTarget(item));
  }

  function onMcpLoginChanged(): void {
    void refreshMcpAuth();
  }

  function confirmMcpLogout(item: CustomizationItem): void {
    dialog.warning({
      title: t.customizeMcpSignOut,
      content: t.customizeMcpSignOutConfirm(item.name),
      positiveText: t.customizeMcpSignOut,
      negativeText: t.cancel,
      onPositiveClick: async () => {
        try {
          await window.api.customizations.mcpLogout(mcpTarget(item));
          message.success(t.customizeMcpSignOutSuccess);
          await refreshMcpAuth();
        } catch (err) {
          message.error(err instanceof Error ? err.message : String(err));
        }
      },
    });
  }

  /** 技能规范校验问题标签（仅技能列表显示）。 */
  function skillWarning(item: CustomizationItem): { text: string; hint: string } | null {
    if (kind !== "skills" || !item.warning) return null;
    switch (item.warning) {
      case "missing-description":
        return {
          text: t.customizeSkillIssueMissingDescription,
          hint: t.customizeSkillIssueMissingDescriptionHint,
        };
      case "description-too-long":
        return {
          text: t.customizeSkillIssueLongDescription,
          hint: t.customizeSkillIssueLongDescriptionHint,
        };
      default:
        return {
          text: t.customizeSkillIssueInvalidName,
          hint: t.customizeSkillIssueInvalidNameHint,
        };
    }
  }

  function canRemove(item: CustomizationItem): boolean {
    if (kind === "skills") return Boolean(item.filePath);
    if (kind === "mcp") return true;
    if (kind === "agents" || kind === "prompts") return isEditableItem(item);
    if (kind === "instructions") return item.removable === true;
    return kind === "plugins" && Boolean(item.source);
  }

  function removeLabel(): string {
    if (kind === "mcp") return t.customizeMcpRemove;
    if (kind === "agents" || kind === "instructions" || kind === "prompts") {
      return t.customizeDelete;
    }
    return kind === "plugins" ? t.customizeUninstallPlugin : t.customizeUninstall;
  }

  /** 行内按钮用短文案，避免「卸载插件」撑宽操作区。 */
  function removeButtonLabel(): string {
    return kind === "plugins" ? t.customizeUninstall : removeLabel();
  }

  function confirmRemove(item: CustomizationItem): void {
    dialog.warning({
      title: removeLabel(),
      content:
        kind === "mcp"
          ? t.customizeMcpRemoveConfirm(item.name)
          : kind === "instructions" || kind === "agents" || kind === "prompts"
            ? t.customizeDeleteConfirm(item.description || item.name)
            : t.customizeUninstallConfirm(item.name),
      positiveText: removeLabel(),
      negativeText: t.cancel,
      onPositiveClick: async () => {
        try {
          if (kind === "skills" && item.filePath) {
            await window.api.skills.uninstall(item.filePath, workspace.root ?? undefined);
            store.removeFileItem(kind, item.id);
            return;
          } else if (kind === "agents" && item.filePath) {
            await window.api.customizations.removeItem(item.filePath, workspace.root ?? undefined);
            store.removeFileItem(kind, item.id);
            return;
          } else if (kind === "prompts" && item.filePath) {
            await window.api.customizations.removeItem(item.filePath, workspace.root ?? undefined);
            store.removeFileItem(kind, item.id);
            return;
          } else if (kind === "instructions" && item.filePath) {
            await window.api.customizations.removeItem(item.filePath, workspace.root ?? undefined);
          } else if (kind === "plugins" && item.source) {
            await window.api.plugins.remove(
              item.source,
              pluginScope(item),
              workspace.root ?? undefined,
            );
          } else if (kind === "mcp") {
            await window.api.customizations.removeMcpServer(
              item.name,
              item.scope === "project" ? "project" : "user",
              workspace.root ?? undefined,
            );
            store.removeMcp(item.id);
            return;
          }
          onRefresh?.();
        } catch (err) {
          message.error(err instanceof Error ? err.message : String(err));
        }
      },
    });
  }

  /** 右键菜单（对应 VS Code 的行上下文菜单）。 */
  function ctxOptionsFor(item: CustomizationItem): MenuItem[] {
    const options: MenuItem[] = [
      { label: t.customizeOpen, key: "open", disabled: !item.filePath },
    ];
    if (kind !== "plugins") {
      options.push({ label: t.customizeCopyPath, key: "copy", disabled: !item.filePath });
    }
    if (kind === "mcp" && (item.scope === "user" || item.scope === "project")) {
      options.push({ label: t.customizeEdit, key: "edit" });
    }
    if (canToggle(item)) {
      options.push({
        label: item.enabled === false ? t.customizeEnable : t.customizeDisable,
        key: "toggle",
      });
    }
    if (canRemove(item)) {
      options.push({ label: removeLabel(), key: "remove" });
    }
    return options;
  }

  function onCtxSelect(item: CustomizationItem, key: string): void {
    switch (key) {
      case "open":
        openItem(item);
        break;
      case "copy":
        void copyPath(item);
        break;
      case "edit":
        openMcpEdit(item);
        break;
      case "toggle":
        void setEnabled(item, item.enabled === false);
        break;
      case "remove":
        confirmRemove(item);
        break;
    }
  }

  function onItemClick(event: ReactMouseEvent<HTMLDivElement>, item: CustomizationItem): void {
    if ((event.target as HTMLElement).closest("[data-row-action]")) return;
    openItem(item);
  }

  return (
    <div className={styles.customizeList}>
      <div className={styles.listSearchAndButtonContainer}>
        <div className={styles.listSearchContainer}>
          <Input
            value={query}
            size="small"
            allowClear
            placeholder={t.customizeSearchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className={styles.listAddButtonContainer}>
          <Button size="small" onClick={() => onRefresh?.()}>
            {t.reload}
          </Button>
          {draftKind ? (
            <Dropdown
              trigger={["click"]}
              menu={{
                items: draftScopeOptions,
                onClick: ({ key }) => onDraftScopeSelect(String(key)),
              }}
            >
              <Button size="small">{createLabel()}</Button>
            </Dropdown>
          ) : null}
          {kind === "plugins" ? (
            <Button size="small" onClick={() => onMarket?.()}>
              {t.customizeBrowseMarket}
            </Button>
          ) : null}
          {kind === "plugins" ? (
            <Button
              size="small"
              loading={pluginUpdates.checking}
              onClick={() => void checkPluginUpdateState()}
            >
              {t.customizeCheckUpdates}
            </Button>
          ) : null}
          {kind === "mcp" ? (
            <Button size="small" onClick={openMcpAdd}>
              {t.customizeMcpAdd}
            </Button>
          ) : null}
          {kind === "mcp" ? (
            <Dropdown
              trigger={["click"]}
              menu={{
                items: editConfigOptions,
                onClick: ({ key }) => void onEditConfigSelect(String(key)),
              }}
            >
              <Button size="small">{t.customizeMcpEditConfig}</Button>
            </Dropdown>
          ) : null}
          {kind === "mcp" ? (
            <Button
              size="small"
              loading={mcpTesting}
              disabled={enabledMcpItems.length === 0}
              onClick={() => void testMcpServers()}
            >
              {t.customizeMcpTest}
            </Button>
          ) : null}
        </div>
      </div>

      {!grouped.length ? (
        <div className={styles.listEmptyState}>
          <div>
            <span className={styles.emptyStateText}>{t.customizeEmpty(emptyLabel())}</span>
          </div>
          <div className={styles.emptyStateSubtext}>{t.customizeEmptyHint}</div>
        </div>
      ) : (
        <div className={styles.listContainer}>
          {grouped.map((group) => (
            <div key={group.scope} className={styles.groupBlock}>
              <button
                type="button"
                className={styles.aiCustomizationGroupHeader}
                onClick={() => toggleGroup(group.scope)}
              >
                <span className={styles.groupLabelGroup}>
                  <span className={styles.groupLabel}>{group.label}</span>
                </span>
                <span className={styles.groupCount}>{group.items.length}</span>
                <span className={styles.groupInfo} title={group.hint}>
                  <CodiconIcon name="about" size={14} />
                </span>
                <span className={styles.groupChevron}>
                  <CodiconIcon
                    name={collapsed.has(group.scope) ? "chevronRight" : "chevronDown"}
                    size={14}
                  />
                </span>
              </button>

              {!collapsed.has(group.scope)
                ? group.items.map((item) => {
                    const badge = testBadge(item);
                    const warning = skillWarning(item);
                    const auth = mcpAuthStateOf(item);
                    return (
                      <Dropdown
                        key={item.id}
                        trigger={["contextMenu"]}
                        placement="bottomLeft"
                        menu={{
                          items: ctxOptionsFor(item),
                          onClick: ({ key }) => onCtxSelect(item, String(key)),
                        }}
                      >
                        <div
                          className={styles.aiCustomizationListItem}
                          onClick={(event) => onItemClick(event, item)}
                        >
                          <div className={styles.itemLeft}>
                            <div className={styles.itemText}>
                              <div className={styles.itemNameRow}>
                                <span className={styles.itemName}>{item.name}</span>
                                {item.current ? (
                                  <span className={styles.inlineBadge}>
                                    {t.customizeCurrentWorkspace}
                                  </span>
                                ) : null}
                                {progressOf(item) ? (
                                  <span
                                    className={`${styles.inlineBadge} ${styles.progressBadge}`}
                                  >
                                    {progressLabelOf(item)}
                                  </span>
                                ) : versionLabel(item) ? (
                                  <span className={`${styles.inlineBadge} ${styles.versionBadge}`}>
                                    {versionLabel(item)}
                                  </span>
                                ) : null}
                                {item.enabled === false ? (
                                  <span className={styles.inlineBadge}>
                                    {t.customizeDisabled}
                                  </span>
                                ) : null}
                                {badge ? (
                                  <span
                                    className={`${styles.inlineBadge} ${styles.testBadge}${
                                      badge.tone === "ok"
                                        ? ` ${styles.isOk}`
                                        : badge.tone === "fail"
                                          ? ` ${styles.isFail}`
                                          : ""
                                    }`}
                                  >
                                    {badge.text}
                                  </span>
                                ) : null}
                                {auth?.authenticated ? (
                                  <span className={`${styles.inlineBadge} ${styles.authBadge}`}>
                                    {t.customizeMcpSignedIn}
                                  </span>
                                ) : null}
                                {warning ? (
                                  <span
                                    className={`${styles.inlineBadge} ${styles.warningBadge}`}
                                    title={warning.hint}
                                  >
                                    {warning.text}
                                  </span>
                                ) : null}
                              </div>
                              {item.description ? (
                                <div className={styles.itemDescription}>{item.description}</div>
                              ) : null}
                            </div>
                          </div>
                          <div
                            className={
                              canToggle(item)
                                ? `${styles.itemRight} ${styles.itemRightPinned}`
                                : styles.itemRight
                            }
                            data-row-action
                          >
                            {versionInfoOf(item)?.hasUpdate ? (
                              <Button
                                className={styles.itemUpdateButton}
                                size="small"
                                type="primary"
                                loading={isUpgrading(item.id)}
                                onClick={() => void upgradePlugin(item)}
                              >
                                {t.customizeUpdate}
                              </Button>
                            ) : null}
                            {canToggle(item) ? (
                              <ToggleButton
                                value={item.enabled !== false}
                                title={item.enabled === false ? t.customizeEnable : t.customizeDisable}
                                onValueChange={(value) => void setEnabled(item, value)}
                              />
                            ) : null}
                            {showMcpOverride(item) ? (
                              <span
                                className={styles.itemOverride}
                                title={t.customizeMcpProjectOverride}
                              >
                                <Select
                                  className={styles.itemOverrideSelect}
                                  size="small"
                                  value={mcpOverrideOf(item)}
                                  options={mcpOverrideOptions}
                                  onChange={(value: McpProjectOverride) =>
                                    void setMcpOverride(item, value)
                                  }
                                />
                              </span>
                            ) : null}
                            {kind === "mcp" && (item.scope === "user" || item.scope === "project") ? (
                              <button
                                type="button"
                                className={styles.itemAction}
                                title={t.customizeEdit}
                                onClick={() => openMcpEdit(item)}
                              >
                                {t.customizeEdit}
                              </button>
                            ) : null}
                            {kind === "mcp" && auth?.oauth && !auth.authenticated ? (
                              <button
                                type="button"
                                className={styles.itemAction}
                                title={t.customizeMcpSignIn}
                                onClick={() => openMcpLogin(item)}
                              >
                                {t.customizeMcpSignIn}
                              </button>
                            ) : kind === "mcp" && auth?.authenticated ? (
                              <button
                                type="button"
                                className={styles.itemAction}
                                title={t.customizeMcpSignOut}
                                onClick={() => confirmMcpLogout(item)}
                              >
                                {t.customizeMcpSignOut}
                              </button>
                            ) : null}
                            {canRemove(item) ? (
                              <button
                                type="button"
                                className={styles.itemAction}
                                title={removeLabel()}
                                onClick={() => confirmRemove(item)}
                              >
                                {removeButtonLabel()}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </Dropdown>
                    );
                  })
                : null}
            </div>
          ))}
        </div>
      )}

      <McpAddModal
        show={addOpen}
        workspaces={scopedWorkspaces}
        edit={mcpEdit}
        onClose={() => setAddOpen(false)}
        onAdded={onMcpAdded}
      />

      <McpLoginModal
        show={mcpLoginTarget !== null}
        target={mcpLoginTarget}
        onClose={() => setMcpLoginTarget(null)}
        onChanged={onMcpLoginChanged}
      />
    </div>
  );
}

export default CustomizeSection;
