import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Button, Input, Modal, Space, Spin } from "antd";
import type { InputRef } from "antd";
import { CodeSlashOutline, RefreshOutline } from "@renderer/components/icons/ionicons";
import BrowserIcon from "@renderer/components/icons/BrowserIcon";
import type { IoniconProps } from "@renderer/components/icons/ionicons";
import CodiconIcon, { type CodiconName } from "@renderer/components/icons/CodiconIcon";
import PreviewTab, { type PreviewTabHandle } from "@renderer/components/PreviewTab";
import AppearancePanel from "@renderer/components/AppearancePanel";
import KeybindingsSettings from "@renderer/components/KeybindingsSettings";
import AboutPanel from "@renderer/components/AboutPanel";
import NotifySettings from "@renderer/components/NotifySettings";
import GeneralSettings from "@renderer/components/GeneralSettings";
import CustomizeNetwork from "@renderer/components/customize/CustomizeNetwork";
import CustomizeSection from "@renderer/components/customize/CustomizeSection";
import McpServerForm from "@renderer/components/customize/McpServerForm";
import CustomizeHooks from "@renderer/components/customize/CustomizeHooks";
import CustomizeTools from "@renderer/components/customize/CustomizeTools";
import CustomizeModels from "@renderer/components/customize/CustomizeModels";
import CustomizeRuntime from "@renderer/components/customize/CustomizeRuntime";
import CustomizeRetry from "@renderer/components/customize/CustomizeRetry";
import CustomizeDeveloper from "@renderer/components/customize/CustomizeDeveloper";
import CustomizeBrowser from "@renderer/components/customize/CustomizeBrowser";
import MarketSettings from "@renderer/components/MarketSettings";
import { useCustomizationsStore } from "@renderer/stores/customizations";
import { useLayoutStore } from "@renderer/stores/layout";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useDialog, useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useScopedWorkspaces } from "@renderer/utils/scoped-workspaces";
import * as prefs from "@renderer/utils/prefs";
import { registerStateApplier } from "@renderer/utils/state-sync";
import type { McpEditTarget, SkillIssueCode } from "../../../shared/customizations";
import styles from "./AiCustomizationPage.module.css";

type Props = {
  section: string;
  visible: boolean;
};

type DraftKind = "skills" | "instructions";

type EditingTarget =
  | { kind: "file"; filePath: string; title: string; rename: boolean }
  | { kind: "draft"; draftKind: DraftKind; scope: "user" | "project"; workspace: string | null };

/** MCP 新建/编辑表单：edit 为空表示新建。 */
type McpFormTarget = { edit: McpEditTarget | null };

/** 导航图标：codicon 名，或直接给一个图标组件（如 ionicons 的 refresh）。 */
type SectionIcon = CodiconName | ComponentType<IoniconProps>;

/** 类型守卫：区分 codicon 名与组件图标。 */
function isCodiconName(icon: SectionIcon): icon is CodiconName {
  return typeof icon === "string";
}

/** 设置页分两组独立页：系统设置面向界面与运行环境，配置管理面向 pi 的配置与扩展。 */
type SettingsGroup = "system" | "config";

const GROUP_IDS: readonly SettingsGroup[] = ["system", "config"];

const SECTION_GROUP: Record<string, SettingsGroup> = {
  general: "system",
  appearance: "system",
  notifications: "system",
  network: "system",
  keys: "system",
  about: "system",
  developer: "system",
  browser: "system",
  models: "config",
  retry: "config",
  runtime: "config",
  skills: "config",
  instructions: "config",
  hooks: "config",
  mcp: "config",
  plugins: "config",
  tools: "config",
};

function groupOf(section: string): SettingsGroup {
  return SECTION_GROUP[section] ?? "system";
}

const SECTION_IDS = [
  "general",
  "appearance",
  "notifications",
  "network",
  "keys",
  "models",
  "retry",
  "runtime",
  "skills",
  "instructions",
  "hooks",
  "mcp",
  "plugins",
  "tools",
  "developer",
  "browser",
  "about",
] as const;

const LIST_KINDS = ["skills", "instructions", "mcp", "plugins"] as const;
type ListKind = (typeof LIST_KINDS)[number];

/** VS Code 侧栏常量：默认 224px，可拖拽 190–380。 */
const SIDEBAR_DEFAULT_WIDTH = 224;
const SIDEBAR_MIN_WIDTH = 190;
const SIDEBAR_MAX_WIDTH = 380;
const WIDTH_KEY = "pi-desktop:customize-sidebar-width:v2";

/** 各类草稿的初始内容：指令是纯 markdown，技能带 frontmatter。 */
const DRAFT_TEMPLATES: Record<DraftKind, string> = {
  skills: ["---", "name: ", 'description: ""', "---", ""].join("\n"),
  instructions: "",
};

function readWidth(): number {
  const raw = Number(prefs.getItem(WIDTH_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(Math.max(raw, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
}

/** 旧版本持久化的失效页签（如已移除的「通用」）回落到首个分区。 */
function resolveSection(id: string): string {
  return (SECTION_IDS as readonly string[]).includes(id) ? id : "appearance";
}

export function AiCustomizationPage({ section, visible }: Props): ReactNode {
  const t = useI18n();
  const message = useMessage();
  const dialog = useDialog();
  const store = useCustomizationsStore();
  const layout = useLayoutStore();
  const workspace = useWorkspaceStore();
  const scopedWorkspaces = useScopedWorkspaces();

  const [active, setActive] = useState<string>(() => resolveSection(section));
  const [modal, setModal] = useState<string | null>(null);
  const [width, setWidth] = useState<number>(readWidth);
  const [editing, setEditing] = useState<EditingTarget | null>(null);
  const [mcpForm, setMcpForm] = useState<McpFormTarget | null>(null);
  const [editorName, setEditorName] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const [leaveLabel, setLeaveLabel] = useState<string | null>(null);

  const editorRef = useRef<PreviewTabHandle | null>(null);
  const nameInputRef = useRef<InputRef | null>(null);
  const activeRef = useRef(active);
  const widthRef = useRef(width);
  const leaveCallbackRef = useRef<(() => void) | null>(null);
  const lastSectionRef = useRef<Partial<Record<SettingsGroup, string>>>({});
  activeRef.current = active;
  widthRef.current = width;
  lastSectionRef.current[groupOf(active)] = active;

  const sections: { id: string; icon: SectionIcon; label: string; description: string }[] = [
    {
      id: "general",
      icon: "settings",
      label: t.customizeGeneral,
      description: t.customizeGeneralDesc,
    },
    {
      id: "appearance",
      icon: "appearance",
      label: t.customizeAppearance,
      description: t.customizeAppearanceDesc,
    },
    {
      id: "notifications",
      icon: "notify",
      label: t.customizeNotifications,
      description: t.customizeNotificationsDesc,
    },
    {
      id: "network",
      icon: "proxy",
      label: t.customizeNetwork,
      description: t.customizeNetworkDesc,
    },
    { id: "keys", icon: "keyboard", label: t.customizeKeys, description: t.customizeKeysDesc },
    { id: "models", icon: "models", label: t.customizeModels, description: t.customizeModelsDesc },
    { id: "retry", icon: RefreshOutline, label: t.customizeRetry, description: t.customizeRetryDesc },
    { id: "runtime", icon: "run", label: t.customizeRuntime, description: t.customizeRuntimeDesc },
    { id: "skills", icon: "skills", label: t.customizeSkills, description: t.customizeSkillsDesc },
    {
      id: "instructions",
      icon: "instructions",
      label: t.customizeInstructions,
      description: t.customizeInstructionsDesc,
    },
    { id: "hooks", icon: "hooks", label: t.customizeHooks, description: t.customizeHooksDesc },
    { id: "mcp", icon: "mcp", label: t.customizeMcp, description: t.customizeMcpDesc },
    { id: "plugins", icon: "plugins", label: t.customizePlugins, description: t.customizePluginsDesc },
    { id: "tools", icon: "tools", label: t.customizeTools, description: t.customizeToolsDesc },
    {
      id: "developer",
      icon: CodeSlashOutline,
      label: t.customizeDeveloper,
      description: t.customizeDeveloperDesc,
    },
    {
      id: "browser",
      icon: BrowserIcon,
      label: t.customizeBrowser,
      description: t.customizeBrowserDesc,
    },
    { id: "about", icon: "about", label: t.aboutTitle, description: t.customizeAboutDesc },
  ];

  const current = sections.find((entry) => entry.id === active) ?? sections[0];
  const activeGroup = groupOf(current.id);
  const groupSections = sections.filter((entry) => groupOf(entry.id) === activeGroup);

  const listKind: ListKind = (LIST_KINDS as readonly string[]).includes(active)
    ? (active as ListKind)
    : "skills";

  const snapshot = store.snapshot;

  const listItems = (() => {
    switch (listKind) {
      case "skills":
        return snapshot.skills;
      case "instructions":
        return snapshot.instructions;
      case "mcp":
        return snapshot.mcp;
      case "plugins":
        return snapshot.plugins;
      default:
        return snapshot.skills;
    }
  })();

  const counts: Record<string, number> = {
    skills: snapshot.skills.length,
    instructions: snapshot.instructions.length,
    hooks: snapshot.hooks.length,
    mcp: snapshot.mcp.length,
    plugins: snapshot.plugins.length,
    tools: snapshot.tools.length,
  };

  const draftTarget = editing?.kind === "draft" ? editing : null;

  const editorTitle = (() => {
    const target = editing;
    if (!target) return "";
    if (target.kind === "file") return target.title;
    return target.draftKind === "instructions" ? t.customizeNewInstructions : "";
  })();

  /** 标题可编辑：技能草稿可改名，指令文件名固定；已保存技能按列表来源可改名。 */
  const nameEditable = (() => {
    const target = editing;
    if (!target) return false;
    if (target.kind === "draft") return target.draftKind !== "instructions";
    return target.rename;
  })();

  const editorFilePath = editing?.kind === "file" ? editing.filePath : null;
  const editorDraftContent = draftTarget ? DRAFT_TEMPLATES[draftTarget.draftKind] : null;

  /** 重命名预览：路径行实时显示改名后的完整路径，保存后才真正生效。 */
  const editorFilePathPreview = (() => {
    const target = editing;
    if (!target || target.kind !== "file") return null;
    const next = editorName.trim();
    if (!target.rename || !next || next === target.title) return target.filePath;
    const sep = target.filePath.includes("\\") ? "\\" : "/";
    const marker = `${sep}${target.title}${sep}`;
    return target.filePath.includes(marker)
      ? target.filePath.replace(marker, `${sep}${next}${sep}`)
      : target.filePath;
  })();

  /** 标题改名也算未保存改动，保存按钮一并高亮。 */
  const nameChanged = (() => {
    const target = editing;
    if (!target || target.kind !== "file" || !target.rename) return false;
    const next = editorName.trim();
    return Boolean(next) && next !== target.title;
  })();

  const editorDirtyTotal = editorDirty || nameChanged;

  /** 草稿创建后的完整路径（页头路径行展示，跟随名称输入实时变化）。 */
  const draftLocation = (() => {
    const draft = draftTarget;
    if (!draft) return "";
    if (draft.scope === "project" && draft.workspace) {
      const sep = draft.workspace.includes("\\") ? "\\" : "/";
      const base = `${draft.workspace}${sep}.pi`;
      if (draft.draftKind === "instructions") return `${draft.workspace}${sep}AGENTS.md`;
      const name = editorName.trim() || "new-skill";
      return `${base}${sep}skills${sep}${name}${sep}SKILL.md`;
    }
    if (draft.draftKind === "instructions") return "~/.pi/agent/AGENTS.md";
    const name = editorName.trim() || "new-skill";
    return `~/.pi/agent/skills/${name}/SKILL.md`;
  })();

  /** 编辑器页头删除：草稿直接丢弃，文件按当前列表类型删除。 */
  const canDeleteEditing = (() => {
    const target = editing;
    if (!target) return false;
    if (target.kind === "draft") return true;
    return listKind === "skills";
  })();

  const attachEditor = useCallback((handle: PreviewTabHandle | null): void => {
    editorRef.current = handle;
    setEditorDirty(handle?.dirty === true);
  }, []);

  const saveHandlerRef = useRef<(content: string) => Promise<boolean>>(() => Promise.resolve(false));
  saveHandlerRef.current = saveEditorContent;
  const handleSave = useCallback((content: string) => saveHandlerRef.current(content), []);

  useEffect(() => {
    if (!section) return;
    const next = resolveSection(section);
    if (next !== activeRef.current) {
      setEditing(null);
      setActive(next);
    }
  }, [section]);

  useEffect(() => {
    if (visible) void store.load();
    else setModal(null);
  }, [visible, workspace.root]);

  // 另一窗口改了设置页宽度时跟着变。
  useEffect(() => {
    return registerStateApplier((change) => {
      if (change.scope !== "prefs") return;
      if (!(change.keys ?? []).includes(WIDTH_KEY)) return;
      setWidth(readWidth());
    });
  }, []);

  useEffect(() => {
    if (!editing || editing.kind !== "draft" || editing.draftKind === "instructions") return;
    nameInputRef.current?.focus();
  }, [editing]);

  /** 离开 MCP 分区时收起内嵌表单。 */
  useEffect(() => {
    if (active !== "mcp") setMcpForm(null);
  }, [active]);

  function selectSection(id: string): void {
    leaveEditor(() => {
      setActive(id);
      layout.setCustomizeSection(id);
    });
  }

  /** 切换分组页：回到该组上次停留的分区，没有则取该组首个分区。 */
  function selectGroup(group: SettingsGroup): void {
    if (group === activeGroup) return;
    const remembered = lastSectionRef.current[group];
    const next = remembered && groupOf(remembered) === group ? remembered : firstSectionOf(group);
    selectSection(next);
  }

  function firstSectionOf(group: SettingsGroup): string {
    return sections.find((entry) => groupOf(entry.id) === group)?.id ?? "appearance";
  }

  function openMcpAdd(): void {
    setMcpForm({ edit: null });
  }

  function openMcpEdit(target: McpEditTarget): void {
    setMcpForm({ edit: target });
  }

  function openInPage(payload: { filePath: string; title: string; rename: boolean }): void {
    setEditorName(payload.title);
    setEditing({
      kind: "file",
      filePath: payload.filePath,
      title: payload.title,
      rename: payload.rename,
    });
  }

  function openDraft(payload: {
    kind: DraftKind;
    scope: "user" | "project";
    workspace: string | null;
  }): void {
    setEditorName("");
    setEditing({
      kind: "draft",
      draftKind: payload.kind,
      scope: payload.scope,
      workspace: payload.workspace,
    });
  }

  function draftTitle(kind: DraftKind): string {
    switch (kind) {
      case "instructions":
        return t.customizeNewInstructions;
      default:
        return t.customizeNewSkill;
    }
  }

  /** 草稿态：标题即名称，实时同步正文 frontmatter 的 name 行（指令无 frontmatter）。 */
  function onEditorNameInput(value: string): void {
    const draft = draftTarget;
    if (!draft || draft.draftKind === "instructions") return;
    const editor = editorRef.current;
    if (!editor) return;
    const content = editor.getContent();
    const updated = content.replace(/^(name:[ \t]*).*$/m, `$1${value}`);
    if (updated !== content) editor.setContent(updated);
  }

  async function saveSkillDraft(content: string): Promise<boolean> {
    const draft = draftTarget;
    if (!draft) return false;
    if (draft.scope === "project" && !draft.workspace) {
      message.error(t.slashNeedWorkspace);
      return false;
    }
    try {
      const saved = await window.api.skills.createFromDraft(
        content,
        draft.scope,
        draft.scope === "project" ? draft.workspace ?? undefined : undefined,
      );
      if (!saved.ok) {
        message.error(skillIssuesText(saved.issues));
        return false;
      }
      await store.load(true);
      setEditing({ kind: "file", filePath: saved.filePath, title: saved.name, rename: true });
      setEditorName(saved.name);
      message.success(t.saved);
      return true;
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async function saveInstructionsDraft(content: string): Promise<boolean> {
    const draft = draftTarget;
    if (!draft) return false;
    try {
      const saved = await window.api.customizations.createInstructionsFromDraft(
        content,
        draft.scope,
        draft.scope === "project" ? draft.workspace ?? undefined : undefined,
      );
      if (!saved.ok) {
        message.error(t.instructionsExists);
        return false;
      }
      await store.load(true);
      setEditing({ kind: "file", filePath: saved.filePath, title: "AGENTS.md", rename: false });
      message.success(t.saved);
      return true;
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  /** 已保存文件落盘：技能走 skills.save（校验 + 改名），其余直接写盘。 */
  async function saveFileTarget(
    target: Extract<EditingTarget, { kind: "file" }>,
    content: string,
  ): Promise<boolean> {
    const kind = listKind;
    const nextName = editorName.trim();
    const shouldRename = Boolean(nextName) && nextName !== target.title;
    if (kind === "skills" && target.rename) {
      try {
        const saved = await window.api.skills.save(
          target.filePath,
          content,
          shouldRename ? nextName : undefined,
          workspace.root ?? undefined,
        );
        if (!saved.ok) {
          message.error(skillIssuesText(saved.issues));
          return false;
        }
        await store.load(true);
        setEditing({ kind: "file", filePath: saved.filePath, title: saved.name, rename: true });
        setEditorName(saved.name);
        message.success(t.saved);
        return true;
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
        return false;
      }
    }
    try {
      await window.api.preview.write(target.filePath, content);
      await store.load(true);
      message.success(t.saved);
      return true;
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  function skillIssueText(code: SkillIssueCode): string {
    switch (code) {
      case "name-required":
        return t.skillIssueNameRequired;
      case "name-invalid":
        return t.skillIssueNameInvalid;
      case "name-too-long":
        return t.skillIssueNameTooLong;
      case "description-required":
        return t.skillIssueDescriptionRequired;
      default:
        return t.skillIssueDescriptionTooLong;
    }
  }

  /** 多条规范问题合并提示。 */
  function skillIssuesText(issues: SkillIssueCode[]): string {
    return issues.map(skillIssueText).join("；");
  }

  /** 保存按钮与 Ctrl+S 统一入口。 */
  async function saveEditorContent(content: string): Promise<boolean> {
    const target = editing;
    if (!target) return false;
    if (target.kind === "draft") {
      switch (target.draftKind) {
        case "skills":
          return saveSkillDraft(content);
        default:
          return saveInstructionsDraft(content);
      }
    }
    return saveFileTarget(target, content);
  }

  function saveEditingFile(): void {
    void editorRef.current?.save();
  }

  /** 离开编辑器前：有未保存改动时询问保存 / 不保存 / 取消。 */
  function leaveEditor(onLeave: () => void): void {
    const target = editing;
    if (!target) {
      onLeave();
      return;
    }
    if (!editorDirtyTotal) {
      setEditing(null);
      onLeave();
      return;
    }
    leaveCallbackRef.current = onLeave;
    setLeaveLabel(
      target.kind === "file" ? target.title : editorName.trim() || draftTitle(target.draftKind),
    );
  }

  function cancelLeave(): void {
    leaveCallbackRef.current = null;
    setLeaveLabel(null);
  }

  function leaveWithoutSaving(): void {
    const callback = leaveCallbackRef.current;
    leaveCallbackRef.current = null;
    setLeaveLabel(null);
    setEditing(null);
    callback?.();
  }

  async function leaveAfterSaving(): Promise<void> {
    const ok = await editorRef.current?.save();
    if (!ok) return;
    const callback = leaveCallbackRef.current;
    leaveCallbackRef.current = null;
    setLeaveLabel(null);
    setEditing(null);
    callback?.();
  }

  function closeEditor(): void {
    leaveEditor(() => {});
  }

  function deleteEditing(): void {
    const target = editing;
    if (!target) return;
    if (target.kind === "draft") {
      dialog.warning({
        title: t.customizeDelete,
        content: t.customizeDiscardDraftConfirm,
        positiveText: t.customizeDelete,
        negativeText: t.cancel,
        onPositiveClick: () => {
          setEditing(null);
        },
      });
      return;
    }
    if (!canDeleteEditing) return;
    const kind = listKind;
    dialog.create({
      title: t.customizeDelete,
      content: t.customizeUninstallConfirm(target.title),
      positiveText: t.customizeDelete,
      negativeText: t.cancel,
      onPositiveClick: async () => {
        try {
          if (kind === "skills") {
            await window.api.skills.uninstall(target.filePath, workspace.root ?? undefined);
          } else {
            await window.api.customizations.removeItem(
              target.filePath,
              workspace.root ?? undefined,
            );
          }
          await store.load(true);
          setEditing(null);
        } catch (err) {
          message.error(err instanceof Error ? err.message : String(err));
        }
      },
    });
  }

  function onResizeStart(event: ReactMouseEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (move: MouseEvent): void => {
      setWidth(
        Math.min(
          Math.max(startWidth + move.clientX - startX, SIDEBAR_MIN_WIDTH),
          SIDEBAR_MAX_WIDTH,
        ),
      );
    };
    const onUp = (): void => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      prefs.setItem(WIDTH_KEY, String(widthRef.current));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function renderSectionContent(): ReactNode {
    if (active === "general") return <GeneralSettings />;
    if (active === "browser") return <CustomizeBrowser />;
    if (store.loading) return <Spin size="small" className={styles.contentSpin} />;
    switch (active) {
      case "notifications":
        return <NotifySettings />;
      case "network":
        return <CustomizeNetwork />;
      case "appearance":
        return <AppearancePanel />;
      case "keys":
        return <KeybindingsSettings />;
      case "about":
        return <AboutPanel />;
      case "developer":
        return <CustomizeDeveloper />;
      case "models":
        return <CustomizeModels />;
      case "retry":
        return <CustomizeRetry />;
      case "runtime":
        return <CustomizeRuntime />;
      case "hooks":
        return <CustomizeHooks hooks={snapshot.hooks} />;
      case "tools":
        return (
          <CustomizeTools
            tools={snapshot.tools}
            builtinExtensions={snapshot.builtinExtensions}
          />
        );
      default:
        return (
          <CustomizeSection
            kind={listKind}
            items={listItems}
            onRefresh={() => void store.load(true)}
            onMarket={() => setModal("market")}
            onOpen={openInPage}
            onNewDraft={openDraft}
            onMcpAdd={openMcpAdd}
            onMcpEdit={openMcpEdit}
          />
        );
    }
  }

  return (
    <div className={styles.aiCustomizationManagementEditor}>
      <aside className={styles.managementSidebar} style={{ width: `${width}px` }}>
        <div className={styles.sidebarContent}>
          <div className={styles.sidebarGroupSwitcher} role="tablist">
            {GROUP_IDS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={id === activeGroup}
                className={
                  id === activeGroup
                    ? `${styles.groupTab} ${styles.groupTabActive}`
                    : styles.groupTab
                }
                onClick={() => selectGroup(id)}
              >
                {id === "system" ? t.customizeGroupSystem : t.customizeGroupConfig}
              </button>
            ))}
          </div>
          <div className={styles.sidebarSectionsList} role="tablist">
            {groupSections.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                className={
                  entry.id === active
                    ? `${styles.sectionListItem} ${styles.selected}`
                    : styles.sectionListItem
                }
                aria-selected={entry.id === active}
                title={entry.description}
                onClick={() => selectSection(entry.id)}
              >
                <span className={styles.sectionIcon}>
                  {isCodiconName(entry.icon) ? (
                    <CodiconIcon name={entry.icon} size={18} />
                  ) : (
                    <entry.icon size={18} />
                  )}
                </span>
                <span className={`section-label ${styles.sectionLabel}`}>{entry.label}</span>
                {counts[entry.id] ? (
                  <span className={styles.sectionCount}>{counts[entry.id]}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div
        className={styles.managementSash}
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onResizeStart}
      />

      <section className={styles.managementContent}>
        {mcpForm && active === "mcp" ? (
          <div className={styles.contentInner}>
            <McpServerForm
              workspaces={scopedWorkspaces.paths}
              edit={mcpForm.edit}
              onClose={() => setMcpForm(null)}
              onAdded={() => void store.load(true)}
            />
          </div>
        ) : editing ? (
          <div className={`${styles.contentInner} ${styles.editorInner}`}>
            <header className={styles.editorPageHeader}>
              <button
                type="button"
                className={styles.editorBackButton}
                title={t.customizeBackToList}
                aria-label={t.customizeBackToList}
                onClick={closeEditor}
              >
                <CodiconIcon name="back" size={16} />
              </button>
              <div className={styles.editorHeading}>
                {nameEditable ? (
                  <Input
                    ref={nameInputRef}
                    value={editorName}
                    size="small"
                    className={styles.editorNameInput}
                    placeholder={t.customizeNewSkill}
                    onChange={(event) => {
                      setEditorName(event.target.value);
                      onEditorNameInput(event.target.value);
                    }}
                  />
                ) : (
                  <h2 className={styles.editorHeadingTitle}>{editorTitle}</h2>
                )}
                {editorFilePathPreview ? (
                  <p className={styles.editorHeadingPath} title={editorFilePathPreview}>
                    {editorFilePathPreview}
                  </p>
                ) : (
                  <p className={styles.editorHeadingPath} title={draftLocation}>
                    {draftLocation}
                  </p>
                )}
              </div>
              <div className={styles.editorActions}>
                <button
                  type="button"
                  className={
                    editorDirtyTotal
                      ? `${styles.editorAction} ${styles.primary}`
                      : styles.editorAction
                  }
                  title={t.saveShortcut}
                  aria-label={t.save}
                  onClick={saveEditingFile}
                >
                  {t.save}
                </button>
                {canDeleteEditing ? (
                  <button
                    type="button"
                    className={`${styles.editorAction} ${styles.remove}`}
                    title={t.customizeDelete}
                    aria-label={t.customizeDelete}
                    onClick={deleteEditing}
                  >
                    {t.customizeDelete}
                  </button>
                ) : null}
              </div>
            </header>
            <div className={styles.embeddedEditor}>
              <PreviewTab
                ref={attachEditor}
                filePath={editorFilePath}
                draftContent={editorDraftContent}
                saveHandler={handleSave}
                active
                embedded
              />
            </div>
          </div>
        ) : (
          <div className={styles.contentInner}>
            {active === "models" ? null : (
              <div className={styles.sectionTitleHeader}>
                <div className={styles.sectionTitleRow}>
                  <h2 className={styles.sectionTitle}>{current.label}</h2>
                </div>
              </div>
            )}

            {store.error ? (
              <p className={styles.contentError}>
                {t.customizeLoadFailed}: {store.error}
              </p>
            ) : null}

            {renderSectionContent()}
          </div>
        )}
      </section>

      <Modal
        open={leaveLabel !== null}
        className="pi-settings-modal"
        width="min(420px, 92vw)"
        title={t.unsavedChangesTitle}
        maskClosable={false}
        onCancel={cancelLeave}
        footer={
          <Space size={8} style={{ justifyContent: "flex-end" }}>
            <Button size="small" onClick={cancelLeave}>
              {t.cancel}
            </Button>
            <Button size="small" onClick={leaveWithoutSaving}>
              {t.dontSave}
            </Button>
            <Button size="small" type="primary" onClick={() => void leaveAfterSaving()}>
              {t.save}
            </Button>
          </Space>
        }
      >
        {leaveLabel !== null ? t.unsavedChangesClose(leaveLabel) : null}
      </Modal>

      <MarketSettings open={modal === "market"} onClose={() => setModal(null)} />
    </div>
  );
}

export default AiCustomizationPage;
