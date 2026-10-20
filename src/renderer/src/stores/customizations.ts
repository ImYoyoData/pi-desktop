import { create } from "zustand";
import { emptyCustomizations, type CustomizationsSnapshot } from "../../../shared/customizations";
import { useWorkspaceStore } from "@renderer/stores/workspace";

type CustomizationsState = {
  snapshot: CustomizationsSnapshot;
  loading: boolean;
  error: string;
  load: (force?: boolean) => Promise<void>;
  init: () => () => void;
  setMcpEnabled: (id: string, enabled: boolean) => void;
  removeMcp: (id: string) => void;
  setPluginEnabled: (id: string, enabled: boolean) => void;
  setBuiltinExtensionEnabled: (
    items: CustomizationsSnapshot["builtinExtensions"],
  ) => void;
  setToolToggles: (items: CustomizationsSnapshot["toolToggles"]) => void;
  setCodemode: (state: CustomizationsSnapshot["codemode"]) => void;
  setSkillEnabled: (id: string, enabled: boolean) => void;
  setFileItemEnabled: (
    kind: "agents" | "prompts",
    id: string,
    enabled: boolean,
    filePath: string,
  ) => void;
  removeFileItem: (kind: "skills" | "agents" | "prompts", id: string) => void;
};

/** 智能体设置页数据：按工作区加载一次，工作区切换时重取。 */
export const useCustomizationsStore = create<CustomizationsState>()((set, get) => {
  let loadedRoot: string | null | undefined;

  async function load(force = false): Promise<void> {
    const root = useWorkspaceStore.getState().root ?? undefined;
    if (!force && loadedRoot === (root ?? null)) return;
    const initial = loadedRoot !== (root ?? null);
    if (initial) set({ loading: true });
    set({ error: "" });
    try {
      const data = await window.api.customizations.list(root, force);
      set({ snapshot: data });
      loadedRoot = data.root;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ loading: false });
    }
  }

  /** 订阅主进程推送的最新快照：后台重扫完成后自动替换本地数据。 */
  function init(): () => void {
    return window.api.customizations.onUpdated((data) => {
      const root = useWorkspaceStore.getState().root ?? null;
      if ((data.root ?? null)?.toLowerCase() !== (root ?? null)?.toLowerCase()) return;
      set({ snapshot: data });
      loadedRoot = data.root;
    });
  }

  /** 本地更新 MCP 开关状态，避免重新加载整份快照。 */
  function setMcpEnabled(id: string, enabled: boolean): void {
    const snapshot = get().snapshot;
    set({
      snapshot: {
        ...snapshot,
        mcp: snapshot.mcp.map((item) =>
          item.id === id ? { ...item, enabled } : item,
        ),
      },
    });
  }

  /** 从本地快照中移除已删除的 MCP 服务器。 */
  function removeMcp(id: string): void {
    const snapshot = get().snapshot;
    set({
      snapshot: {
        ...snapshot,
        mcp: snapshot.mcp.filter((item) => item.id !== id),
      },
    });
  }

  /** 本地更新插件启用状态，避免重新加载整份快照。 */
  function setPluginEnabled(id: string, enabled: boolean): void {
    const snapshot = get().snapshot;
    set({
      snapshot: {
        ...snapshot,
        plugins: snapshot.plugins.map((item) =>
          item.id === id ? { ...item, enabled } : item,
        ),
      },
    });
  }

  /** 本地更新内置扩展开关状态（主进程写入后返回最新列表）。 */
  function setBuiltinExtensionEnabled(
    items: CustomizationsSnapshot["builtinExtensions"],
  ): void {
    set({ snapshot: { ...get().snapshot, builtinExtensions: items } });
  }

  /** 本地更新内置工具开关状态（主进程写入后返回最新列表）。 */
  function setToolToggles(items: CustomizationsSnapshot["toolToggles"]): void {
    set({ snapshot: { ...get().snapshot, toolToggles: items } });
  }

  /** 本地更新 codemode 设置（主进程写入后返回最新值）。 */
  function setCodemode(state: CustomizationsSnapshot["codemode"]): void {
    set({ snapshot: { ...get().snapshot, codemode: state } });
  }

  /** 本地更新技能启用状态，避免重新加载整份快照。 */
  function setSkillEnabled(id: string, enabled: boolean): void {
    const snapshot = get().snapshot;
    set({
      snapshot: {
        ...snapshot,
        skills: snapshot.skills.map((item) =>
          item.id === id ? { ...item, enabled } : item,
        ),
      },
    });
  }

  /** 本地更新智能体/提示的启停状态与重命名后的路径，避免重新加载整份快照。 */
  function setFileItemEnabled(
    kind: "agents" | "prompts",
    id: string,
    enabled: boolean,
    filePath: string,
  ): void {
    const snapshot = get().snapshot;
    const items = snapshot[kind].map((item) =>
      item.id === id ? { ...item, id: filePath, filePath, enabled } : item,
    );
    set({
      snapshot:
        kind === "agents"
          ? { ...snapshot, agents: items }
          : { ...snapshot, prompts: items },
    });
  }

  /** 从本地快照中移除已删除的技能/智能体/提示。 */
  function removeFileItem(kind: "skills" | "agents" | "prompts", id: string): void {
    const snapshot = get().snapshot;
    const items = snapshot[kind].filter((item) => item.id !== id);
    set({
      snapshot:
        kind === "skills"
          ? { ...snapshot, skills: items }
          : kind === "agents"
            ? { ...snapshot, agents: items }
            : { ...snapshot, prompts: items },
    });
  }

  return {
    snapshot: emptyCustomizations(null),
    loading: false,
    error: "",
    load,
    init,
    setMcpEnabled,
    removeMcp,
    setPluginEnabled,
    setBuiltinExtensionEnabled,
    setToolToggles,
    setCodemode,
    setSkillEnabled,
    setFileItemEnabled,
    removeFileItem,
  };
});
