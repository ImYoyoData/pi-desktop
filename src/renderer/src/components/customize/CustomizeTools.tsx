import { useEffect, useState, type ReactNode } from "react";
import { InputNumber, Select } from "antd";
import CodiconIcon from "@renderer/components/icons/CodiconIcon";
import groupStyles from "@renderer/components/customize/SettingsGroup.module.css";
import {
  SettingsRow,
  SettingsSwitch,
} from "@renderer/components/customize/SettingsGroup";
import type {
  BuiltinExtensionItem,
  BuiltinToolItem,
  CustomizationItem,
  CustomizationScope,
} from "../../../../shared/customizations";
import { useCustomizationsStore } from "@renderer/stores/customizations";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./CustomizeTools.module.css";

type Props = {
  tools: CustomizationItem[];
  builtinExtensions: BuiltinExtensionItem[];
};

type ToolGroup = {
  key: string;
  label: string;
  hint: string;
  items: CustomizationItem[];
};

export function CustomizeTools({ tools, builtinExtensions }: Props): ReactNode {
  const store = useCustomizationsStore();
  const workspace = useWorkspaceStore();
  const message = useMessage();
  const t = useI18n();

  const [builtinCollapsed, setBuiltinCollapsed] = useState(false);
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [codemodeMode, setCodemodeMode] = useState<"on" | "only">("on");
  const [inlineBudget, setInlineBudget] = useState<number | null>(null);
  const [maxWorkers, setMaxWorkers] = useState<number | null>(null);

  const toolToggles = store.snapshot.toolToggles ?? [];
  const codemodeState = store.snapshot.codemode ?? { mode: "on" as const };
  const runtimeTools = store.snapshot.runtimeTools?.tools ?? [];
  const runtimeNamespaceCount = new Set(
    runtimeTools.map((tool) => tool.namespace).filter(Boolean),
  ).size;
  const runtimeReachCount = runtimeTools.filter((tool) => tool.reaches).length;

  useEffect(() => {
    setCodemodeMode(codemodeState.mode);
    setInlineBudget(codemodeState.inlineBudget ?? null);
    setMaxWorkers(codemodeState.maxWorkers ?? null);
  }, [codemodeState]);

  function builtinDescription(name: string): string {
    return t.customizeBuiltinExtensionDescription(name);
  }

  function builtinToolDescription(name: string): string {
    return t.customizeBuiltinToolDescription(name);
  }

  /** 开关内置工具：主进程写全局 defaultTools，返回最新列表后本地覆盖。 */
  async function toggleTool(item: BuiltinToolItem, enabled: boolean): Promise<void> {
    try {
      const items = await window.api.customizations.setToolEnabled(
        item.name,
        enabled,
        workspace.root ?? undefined,
      );
      store.setToolToggles(items);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  /** codemode / tool_search 工具所属的内置扩展名。 */
  function toolExtensionName(name: string): string {
    return name === "tool_search" ? "tool-search" : name;
  }

  /** 对应的内置扩展被关闭时工具无法加载，开关只作提示。 */
  function toolExtensionOff(item: BuiltinToolItem): boolean {
    const extension = builtinExtensions.find(
      (entry) => entry.name === toolExtensionName(item.name),
    );
    return extension?.enabled === false;
  }

  function toolToggleTitle(item: BuiltinToolItem): string {
    if (item.overridden) return t.customizeBuiltinOverriddenHint;
    if (toolExtensionOff(item)) return t.customizeBuiltinToolNeedsExtension;
    return item.enabled ? t.customizeDisable : t.customizeEnable;
  }

  /** 只有 codemode 启用时才展示它的呈现设置。 */
  const codemodeEnabled = toolToggles.find((item) => item.name === "codemode")?.enabled === true;

  const codemodeModeOptions = [
    { label: t.customizeCodemodeModeOn, value: "on" },
    { label: t.customizeCodemodeModeOnly, value: "only" },
  ];

  async function saveCodemodeMode(mode: "on" | "only"): Promise<void> {
    try {
      store.setCodemode(
        await window.api.customizations.setCodemodeSettings(
          { mode },
          workspace.root ?? undefined,
        ),
      );
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveInlineBudget(): Promise<void> {
    try {
      const value = inlineBudget;
      store.setCodemode(
        await window.api.customizations.setCodemodeSettings(
          { inlineBudget: value == null || Number.isNaN(value) ? null : value },
          workspace.root ?? undefined,
        ),
      );
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  /** 并发上限存在桌面端偏好里，pi 只认 PI_CODEMODE_MAX_WORKERS。 */
  async function saveMaxWorkers(): Promise<void> {
    try {
      const value = maxWorkers;
      store.setCodemode(
        await window.api.customizations.setCodemodeSettings(
          { maxWorkers: value == null || Number.isNaN(value) ? null : value },
          workspace.root ?? undefined,
        ),
      );
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  /** 开关内置扩展：主进程写全局 settings，返回最新列表后本地覆盖。 */
  async function toggleBuiltin(item: BuiltinExtensionItem, enabled: boolean): Promise<void> {
    try {
      const items = await window.api.customizations.setBuiltinExtensionEnabled(
        item.name,
        enabled,
        workspace.root ?? undefined,
      );
      store.setBuiltinExtensionEnabled(items);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  function localizeDescription(tool: CustomizationItem): CustomizationItem {
    if (tool.scope !== "builtin" && tool.scope !== "desktop") return tool;
    const description = t.customizeToolDescription(tool.name) || tool.description;
    return { ...tool, description };
  }

  function toggleGroup(key: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function scopeGroup(
    scope: CustomizationScope,
    label: string,
    hint: string,
    items: CustomizationItem[],
  ): ToolGroup {
    return { key: scope, label, hint, items: items.filter((tool) => tool.scope === scope) };
  }

  function pluginLabel(source: string): string {
    return source.startsWith("npm:") ? source.slice(4) : source;
  }

  function pluginGroups(items: CustomizationItem[]): ToolGroup[] {
    const order: string[] = [];
    const byPlugin = new Map<string, CustomizationItem[]>();
    for (const tool of items) {
      if (tool.scope !== "extension") continue;
      const source = tool.source ?? t.customizeGroupExtension;
      const list = byPlugin.get(source);
      if (list) list.push(tool);
      else {
        byPlugin.set(source, [tool]);
        order.push(source);
      }
    }
    return order.map((source) => ({
      key: `extension:${source}`,
      label: pluginLabel(source),
      hint: t.customizeGroupExtensionHint,
      items: byPlugin.get(source) ?? [],
    }));
  }

  function buildGroups(): ToolGroup[] {
    const items = tools.map(localizeDescription);
    return [
      scopeGroup("builtin", t.customizeGroupBuiltin, t.customizeGroupBuiltinHint, items),
      scopeGroup("desktop", t.customizeGroupDesktop, t.customizeGroupDesktopHint, items),
      ...pluginGroups(items),
    ].filter((group) => group.items.length > 0);
  }

  const groups: ToolGroup[] = buildGroups();

  return (
    <div className={styles.customizeTools}>
      {!tools.length && !builtinExtensions.length ? (
        <div className={styles.listEmptyState}>
          <div>
            <span className={styles.emptyStateText}>{t.customizeEmpty(t.customizeTools)}</span>
          </div>
          <div className={styles.emptyStateSubtext}>{t.customizeEmptyHint}</div>
        </div>
      ) : (
        <div className={styles.listContainer}>
          {builtinExtensions.length ? (
            <div className={`${groupStyles.card} ${styles.groupCard}`}>
              <button
                type="button"
                className={styles.groupHeader}
                onClick={() => setBuiltinCollapsed((value) => !value)}
              >
                <span className={styles.groupLabel}>{t.customizeBuiltinExtensions}</span>
                <span className={styles.groupCount}>
                  {builtinExtensions.filter((item) => item.enabled).length}/
                  {builtinExtensions.length}
                </span>
                <span className={styles.groupInfo} title={t.customizeBuiltinExtensionsHint}>
                  <CodiconIcon name="about" size={14} />
                </span>
                <span className={styles.groupChevron}>
                  <CodiconIcon
                    name={builtinCollapsed ? "chevronRight" : "chevronDown"}
                    size={14}
                  />
                </span>
              </button>

              {!builtinCollapsed ? (
                <div className={styles.groupBody}>
                  {builtinExtensions.map((item) => (
                    <SettingsRow
                      key={item.id}
                      label={item.name}
                      description={builtinDescription(item.name)}
                    >
                      <SettingsSwitch
                        checked={item.enabled}
                        label={
                          item.overridden
                            ? t.customizeBuiltinOverriddenHint
                            : item.enabled
                              ? t.customizeDisable
                              : t.customizeEnable
                        }
                        disabled={item.overridden}
                        onChange={(value) => void toggleBuiltin(item, value)}
                      />
                    </SettingsRow>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {toolToggles.length ? (
            <div className={`${groupStyles.card} ${styles.groupCard}`}>
              <button
                type="button"
                className={styles.groupHeader}
                onClick={() => setToolsCollapsed((value) => !value)}
              >
                <span className={styles.groupLabel}>{t.customizeBuiltinTools}</span>
                <span className={styles.groupCount}>
                  {toolToggles.filter((item) => item.enabled).length}/{toolToggles.length}
                </span>
                <span className={styles.groupInfo} title={t.customizeBuiltinToolsHint}>
                  <CodiconIcon name="about" size={14} />
                </span>
                <span className={styles.groupChevron}>
                  <CodiconIcon
                    name={toolsCollapsed ? "chevronRight" : "chevronDown"}
                    size={14}
                  />
                </span>
              </button>

              {!toolsCollapsed ? (
                <div className={styles.groupBody}>
                  {toolToggles.map((item) => (
                    <SettingsRow
                      key={item.id}
                      label={item.name}
                      description={builtinToolDescription(item.name)}
                    >
                      <SettingsSwitch
                        checked={item.enabled}
                        label={toolToggleTitle(item)}
                        disabled={item.overridden || toolExtensionOff(item)}
                        onChange={(value) => void toggleTool(item, value)}
                      />
                    </SettingsRow>
                  ))}

                  {codemodeEnabled ? (
                    <>
                      <SettingsRow
                        label={t.customizeCodemodeMode}
                        description={t.customizeCodemodeModeHint}
                      >
                        <Select
                          className={styles.fieldControl}
                          size="small"
                          value={codemodeMode}
                          options={codemodeModeOptions}
                          onChange={(value: "on" | "only") => void saveCodemodeMode(value)}
                        />
                      </SettingsRow>

                      <SettingsRow
                        label={t.customizeCodemodeInlineBudget}
                        description={t.customizeCodemodeInlineBudgetHint}
                      >
                        <InputNumber
                          className={styles.fieldControl}
                          size="small"
                          value={inlineBudget}
                          min={0}
                          controls={false}
                          placeholder="3000"
                          onChange={(value: number | null) => setInlineBudget(value)}
                          onBlur={() => void saveInlineBudget()}
                        />
                      </SettingsRow>

                      <SettingsRow
                        label={t.customizeCodemodeMaxWorkers}
                        description={t.customizeCodemodeMaxWorkersHint}
                      >
                        <InputNumber
                          className={styles.fieldControl}
                          size="small"
                          value={maxWorkers}
                          min={1}
                          controls={false}
                          placeholder="2"
                          onChange={(value: number | null) => setMaxWorkers(value)}
                          onBlur={() => void saveMaxWorkers()}
                        />
                      </SettingsRow>

                      <SettingsRow
                        label={t.customizeCodemodeRuntimeTools}
                        description={
                          runtimeTools.length
                            ? t.customizeCodemodeRuntimeToolsHint(
                                runtimeTools.length,
                                runtimeNamespaceCount,
                                runtimeReachCount,
                              )
                            : t.customizeCodemodeRuntimeToolsEmpty
                        }
                      />
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {groups.map((group) => (
            <div key={group.key} className={`${groupStyles.card} ${styles.groupCard}`}>
              <button
                type="button"
                className={styles.groupHeader}
                onClick={() => toggleGroup(group.key)}
              >
                <span className={styles.groupLabel}>{group.label}</span>
                <span className={styles.groupCount}>{group.items.length}</span>
                <span className={styles.groupInfo} title={group.hint}>
                  <CodiconIcon name="about" size={14} />
                </span>
                <span className={styles.groupChevron}>
                  <CodiconIcon
                    name={collapsed.has(group.key) ? "chevronRight" : "chevronDown"}
                    size={14}
                  />
                </span>
              </button>

              {!collapsed.has(group.key) ? (
                <div className={styles.groupBody}>
                  {group.items.map((tool) => (
                    <SettingsRow key={tool.id} label={tool.name} description={tool.description} />
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default CustomizeTools;
