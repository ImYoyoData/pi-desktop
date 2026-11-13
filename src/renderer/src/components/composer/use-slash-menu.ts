import { useEffect, useRef } from "react";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useMessage } from "@renderer/services/feedback";
import { useChatStore } from "@renderer/stores/chat";
import { useComposerStore } from "@renderer/stores/composer";
import { useLayoutStore } from "@renderer/stores/layout";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import type { AgentBackend } from "../../../../shared/agent-backend";
import {
  filterSlashItems,
  isSlashBuiltinId,
  OMP_SLASH_COMMANDS,
  PI_SLASH_COMMANDS,
  parseSlashContext,
  replaceSlashLine,
  skillSlashCommand,
  type SlashCatalog,
  type SlashItem,
} from "../../../../shared/slash-commands";
import { nextFrame } from "@renderer/components/next-frame";
import { bareBuiltinSlashDraft, barePiCommandDraft } from "./composer-drafts";
import { useLatest } from "./use-latest";

type Params = {
  draft: string;
  agentBackend: AgentBackend;
  workspaceRoot: string;
  focusDraft: () => void;
  focusDraftAtEnd: () => void;
  /** 打开模型菜单（`/model` 内置命令）。 */
  openModelMenu: () => void;
};

/**
 * 斜杠菜单：目录/技能加载、菜单项构建、选中与内置命令执行。
 * 裸命令判定与危险命令确认留在发送链路（需要 submit）。
 */
export function useSlashMenu({
  draft,
  agentBackend,
  workspaceRoot,
  focusDraft,
  focusDraftAtEnd,
  openModelMenu,
}: Params) {
  const t = useI18n();
  const messageApi = useMessage();

  const slashSkills = useLatest<{ name: string; description: string }[]>([]);
  const slashCatalog = useLatest<SlashCatalog>({
    skillCommands: false,
    commands: [],
  });

  const slashSkillsCachedForRef = useRef<string | null>(null);
  const slashSkillsLoadingRef = useRef(false);
  const slashCatalogCachedForRef = useRef<string | null>(null);
  const slashCatalogLoadingRef = useRef(false);
  const slashCatalogPendingRef = useRef(false);

  const slashBuiltins: SlashItem[] = [
    {
      id: "new",
      kind: "builtin",
      command: "new",
      title: "/new",
      description: t.slashNewDesc,
    },
    {
      id: "compact",
      kind: "builtin",
      command: "compact",
      title: "/compact",
      description: t.slashCompactDesc,
    },
    {
      id: "model",
      kind: "builtin",
      command: "model",
      title: "/model",
      description: t.slashModelDesc,
    },
  ];

  const slashSkillItems: SlashItem[] = slashCatalog.value.skillCommands
    ? slashSkills.value.map((s) => ({
        id: `skill:${s.name}`,
        kind: "skill" as const,
        command: skillSlashCommand(s.name),
        title: `/${skillSlashCommand(s.name)}`,
        description: s.description || t.slashSkillFallbackDesc,
      }))
    : [];

  const slashCommandItems: SlashItem[] = slashCatalog.value.commands
    .filter((command) => !isSlashBuiltinId(command.name))
    .map((command) => ({
      id: `command:${command.name}`,
      kind: "command" as const,
      command: command.name,
      title: `/${command.name}`,
      description: command.description || t.slashSkillFallbackDesc,
    }));

  /** omp 内建命令只在 omp 后端出现；执行由 worker 负责。 */
  const ompSlashDescriptions: Record<string, string> = {
    security: t.slashOmpSecurityDesc,
    settings: t.slashOmpSettingsDesc,
    setup: t.slashOmpSetupDesc,
    plan: t.slashOmpPlanDesc,
    "plan-review": t.slashOmpPlanReviewDesc,
    vibe: t.slashOmpVibeDesc,
    goal: t.slashOmpGoalDesc,
    "guided-goal": t.slashOmpGuidedGoalDesc,
    loop: t.slashOmpLoopDesc,
  };
  const slashOmpItems: SlashItem[] =
    agentBackend === "omp"
      ? OMP_SLASH_COMMANDS.filter(
          (entry) => !isSlashBuiltinId(entry.name),
        ).map((entry) => ({
          id: `omp:${entry.name}`,
          kind: "omp" as const,
          command: entry.name,
          title: `/${entry.name}`,
          description:
            ompSlashDescriptions[entry.name] ??
            (entry.hint
              ? `${entry.description} ${entry.hint}`
              : entry.description),
        }))
      : [];

  /** pi 内建命令只在 pi 后端出现；执行由渲染层映射或提示。 */
  const slashPiItems: SlashItem[] =
    agentBackend === "pi"
      ? PI_SLASH_COMMANDS.filter(
          (entry) => !isSlashBuiltinId(entry.name),
        ).map((entry) => ({
          id: `pi:${entry.name}`,
          kind: "pi" as const,
          command: entry.name,
          title: `/${entry.name}`,
          description: entry.hint
            ? `${entry.description} ${entry.hint}`
            : entry.description,
        }))
      : [];

  /** 技能命令关闭时在菜单里直接给出开启入口，避免菜单只剩内置三项。 */
  const slashActionItems: SlashItem[] =
    !slashCatalog.value.skillCommands && slashSkills.value.length > 0
      ? [
          {
            id: "action:enable-skill-commands",
            kind: "action" as const,
            command: "",
            title: t.slashEnableSkillCommands,
            description: t.slashEnableSkillCommandsDesc,
          },
        ]
      : [];

  const slashContext = parseSlashContext(draft);

  const slashItems: SlashItem[] = slashContext
    ? filterSlashItems(
        [
          ...slashBuiltins,
          ...slashOmpItems,
          ...slashPiItems,
          ...slashCommandItems,
          ...slashSkillItems,
          ...slashActionItems,
        ],
        slashContext.query,
      )
    : [];

  const slashMenuOpen = Boolean(slashContext) && slashItems.length > 0;

  async function ensureSlashSkills(): Promise<void> {
    const root = useWorkspaceStore.getState().root ?? "";
    if (slashSkillsCachedForRef.current === root || slashSkillsLoadingRef.current) return;
    slashSkillsLoadingRef.current = true;
    try {
      const data = await window.api.skills.list(
        useWorkspaceStore.getState().root ?? undefined,
      );
      slashSkills.set(
        (data.skills ?? []).map((s) => ({
          name: s.name,
          description: s.description ?? "",
        })),
      );
      slashSkillsCachedForRef.current = root;
    } catch {
      slashSkills.set([]);
    } finally {
      slashSkillsLoadingRef.current = false;
    }
  }

  async function ensureSlashCatalog(force = false): Promise<void> {
    const root = useWorkspaceStore.getState().root ?? "";
    if (!force && slashCatalogCachedForRef.current === root) return;
    if (slashCatalogLoadingRef.current) {
      if (force) slashCatalogPendingRef.current = true;
      return;
    }
    slashCatalogLoadingRef.current = true;
    try {
      const data = await window.api.slashCommands.list(root || undefined);
      if ((useWorkspaceStore.getState().root ?? "") !== root) {
        slashCatalogPendingRef.current = true;
        return;
      }
      slashCatalog.set(data);
      slashCatalogCachedForRef.current = root;
    } catch {
      slashCatalog.set({ skillCommands: true, commands: [] });
    } finally {
      slashCatalogLoadingRef.current = false;
      if (slashCatalogPendingRef.current) {
        slashCatalogPendingRef.current = false;
        void ensureSlashCatalog(true);
      }
    }
  }

  async function runSlashBuiltin(id: string): Promise<void> {
    if (!isSlashBuiltinId(id)) return;
    switch (id) {
      case "new": {
        const root = useWorkspaceStore.getState().root;
        if (!root) {
          messageApi.warning(t.slashNeedWorkspace);
          return;
        }
        useSessionsStore.getState().beginDraft(root);
        messageApi.success(t.slashNewDone);
        return;
      }
      case "compact": {
        const idSession = useSessionsStore.getState().activeId;
        if (!idSession) {
          messageApi.warning(t.slashNeedSession);
          return;
        }
        try {
          await useSessionsStore.getState().sendCommand(idSession, { type: "compact" });
          messageApi.success(t.compactDone);
        } catch (err) {
          messageApi.error(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      case "model": {
        // Model switching stays available while Pi is replying (the worker applies
        // it to the live session) — no lock guard here.
        await nextFrame();
        openModelMenu();
        return;
      }
      default: {
        const _never: never = id;
        void _never;
      }
    }
  }

  async function onSlashSelect(item: SlashItem): Promise<void> {
    const ctx = slashContext;
    if (!ctx) return;
    if (item.kind === "action") {
      useComposerStore.getState().clear();
      if (item.id === "action:enable-skill-commands") {
        try {
          await window.api.ompSettings.save({ "skills.enableSkillCommands": true });
          slashCatalogCachedForRef.current = null;
          await ensureSlashCatalog(true);
          messageApi.success(t.slashEnableSkillCommandsDone);
        } catch (err) {
          messageApi.error(err instanceof Error ? err.message : String(err));
        }
      }
      return;
    }
    if (item.kind === "builtin") {
      useComposerStore.getState().clear();
      await runSlashBuiltin(item.id);
      return;
    }
    // 命令与技能都留原文：命令发送前展开模板，技能由 AgentSession 展开。
    const currentDraft = useComposerStore.getState().draft;
    useComposerStore
      .getState()
      .setDraft(replaceSlashLine(currentDraft, ctx, item.command, true));
    await nextFrame();
    // 重建编辑器后光标会落到开头，参数必须接在命令后面。
    focusDraftAtEnd();
  }

  async function runPiCommandDraft(command: string): Promise<void> {
    const raw = useComposerStore.getState().draft.trim();
    const args = raw.slice(1).split(/\s+/).slice(1).join(" ").trim();
    const store = useComposerStore.getState();
    switch (command) {
      case "settings":
      case "login":
      case "logout":
        store.clear();
        useLayoutStore.getState().openCustomize("models");
        return;
      case "hotkeys":
        store.clear();
        useLayoutStore.getState().openCustomize("keys");
        return;
      case "session": {
        const id = useSessionsStore.getState().activeId;
        const row = id
          ? useSessionsStore.getState().sessions.find((s) => s.id === id)
          : undefined;
        store.clear();
        if (!id) messageApi.warning(t.slashNeedSession);
        else messageApi.info(`Session: ${id}${row?.name ? ` · ${row.name}` : ""}`);
        return;
      }
      case "copy": {
        const messages = useChatStore.getState().activeMessages;
        const last = [...messages]
          .reverse()
          .find((m) => m.role === "assistant" && m.text.trim());
        const text = last?.role === "assistant" ? last.text : "";
        store.clear();
        if (!text.trim()) {
          messageApi.warning(t.slashPiNothingToCopy);
          return;
        }
        try {
          await navigator.clipboard.writeText(text);
          messageApi.success(t.slashPiCopied);
        } catch (err) {
          messageApi.error(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      case "name": {
        if (!args) {
          messageApi.warning(t.slashPiNameUsage);
          return;
        }
        const id = useSessionsStore.getState().activeId;
        const root = useWorkspaceStore.getState().root;
        if (!id || !root) {
          messageApi.warning(t.slashNeedSession);
          return;
        }
        store.clear();
        await useSessionsStore.getState().renameSession(id, root, args);
        return;
      }
      default:
        store.clear();
        messageApi.info(t.slashPiTerminalOnly);
        return;
    }
  }

  /** 接管草稿里的 pi 命令；返回 true 表示已处理。 */
  function runBarePiCommand(): boolean {
    const command = barePiCommandDraft(
      useComposerStore.getState().draft,
      agentBackend,
    );
    if (!command) return false;
    void runPiCommandDraft(command);
    return true;
  }

  function runOmpClientSlash(command: "settings" | "setup"): void {
    useComposerStore.getState().clear();
    useLayoutStore
      .getState()
      .openCustomize(command === "setup" ? "models" : "general");
  }

  /** 运行中绕过发送队列，直接把命令交给 worker。 */
  function sendBareOmpCommandNow(): boolean {
    const id = useSessionsStore.getState().activeId;
    const state = useComposerStore.getState();
    const text = state.draft.trim();
    if (!id || state.chips.length || state.images.length || !text) return false;
    state.clear();
    void useSessionsStore
      .getState()
      .sendCommand(id, { type: "prompt", message: text })
      .catch((err: unknown) => {
        messageApi.error(err instanceof Error ? err.message : String(err));
      });
    return true;
  }

  /** If the whole draft is a bare builtin slash, run it instead of prompting. */
  async function tryConsumeBuiltinSlashDraft(): Promise<boolean> {
    const body = bareBuiltinSlashDraft(useComposerStore.getState().draft);
    if (!body) return false;
    useComposerStore.getState().clear();
    await runSlashBuiltin(body);
    return true;
  }

  useEffect(() => {
    void ensureSlashCatalog(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 工作区变化时刷新目录，与原实现一致
  }, [workspaceRoot]);

  useEffect(() => {
    if (!slashContext) return;
    void ensureSlashSkills();
    void ensureSlashCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在菜单上下文变化时加载，与原实现一致
  }, [slashContext?.slashIndex, slashContext?.query]);

  useEffect(() => {
    return window.api.ompSettings.onChanged(() => {
      slashCatalogCachedForRef.current = null;
      void ensureSlashCatalog(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 订阅一次，与原实现一致
  }, []);

  return {
    slashContext,
    slashMenuOpen,
    slashItems,
    slashCatalog,
    onSlashSelect,
    runSlashBuiltin,
    runBarePiCommand,
    runOmpClientSlash,
    sendBareOmpCommandNow,
    tryConsumeBuiltinSlashDraft,
    focusDraft,
    focusDraftAtEnd,
  };
}
