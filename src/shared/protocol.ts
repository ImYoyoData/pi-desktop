export const IpcChannels = {
  window: {
    minimize: "window:minimize",
    maximize: "window:maximize",
    close: "window:close",
    isMaximized: "window:isMaximized",
    platform: "window:platform",
  },
  workspace: {
    get: "workspace:get",
    open: "workspace:open",
    openPath: "workspace:openPath",
    listRecent: "workspace:listRecent",
    removeRecent: "workspace:removeRecent",
    revealInFolder: "workspace:revealInFolder",
  },
  sessions: {
    list: "sessions:list",
    create: "sessions:create",
    open: "sessions:open",
    close: "sessions:close",
    command: "sessions:command",
    event: "sessions:event",
    status: "sessions:status",
    killWorker: "sessions:killWorker",
    restartWorker: "sessions:restartWorker",
    delete: "sessions:delete",
    history: "sessions:history",
    rename: "sessions:rename",
  },
  files: {
    list: "files:list",
    createFile: "files:createFile",
    createDir: "files:createDir",
    rename: "files:rename",
    delete: "files:delete",
    reveal: "files:reveal",
  },
  fs: {
    watch: "fs:watch",
    unwatch: "fs:unwatch",
    changed: "fs:changed",
  },
  git: {
    status: "git:status",
    diff: "git:diff",
    branches: "git:branches",
    checkout: "git:checkout",
    createBranch: "git:createBranch",
    merge: "git:merge",
    commit: "git:commit",
    pull: "git:pull",
    push: "git:push",
  },
  skills: {
    list: "skills:list",
    setDisabled: "skills:setDisabled",
    uninstall: "skills:uninstall",
  },
  plugins: {
    list: "plugins:list",
    setEnabled: "plugins:setEnabled",
    remove: "plugins:remove",
  },
  models: {
    get: "models:get",
    set: "models:set",
    clearKey: "models:clearKey",
    test: "models:test",
  },
  terminal: {
    create: "terminal:create",
    write: "terminal:write",
    resize: "terminal:resize",
    data: "terminal:data",
    dispose: "terminal:dispose",
  },
  preview: {
    read: "preview:read",
    write: "preview:write",
    pickFile: "preview:pickFile",
  },
  browser: {
    startSelect: "browser:startSelect",
    stopSelect: "browser:stopSelect",
    elementSelected: "browser:elementSelected",
    openDevTools: "browser:openDevTools",
    attachDevTools: "browser:attachDevTools",
    registerGuest: "browser:registerGuest",
    openExternal: "browser:openExternal",
    toggleEmbeddedDevTools: "browser:toggleEmbeddedDevTools",
  },
} as const;

export type SessionStatus = "idle" | "running" | "error" | "stuck";

export type AgentCommand =
  | { type: "prompt"; message: string; images?: unknown[]; citations?: ElementCitation[] }
  | { type: "steer"; message: string }
  | { type: "follow_up"; message: string }
  | { type: "abort" }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "set_thinking_level"; level: string }
  | { type: "compact"; customInstructions?: string }
  | { type: "get_state" }
  | { type: "ping" }
  | { type: "hang" };

export type ElementCitation = {
  url: string;
  selector: string;
  text: string;
  htmlSnippet: string;
  /** data:image/png;base64,... screenshot of selected element bounds */
  screenshotDataUrl?: string;
};

export type AgentEvent =
  | { type: "connected"; sessionId: string }
  | { type: "agent_event"; sessionId: string; event: Record<string, unknown> }
  | { type: "prompt_done"; sessionId: string }
  | { type: "prompt_error"; sessionId: string; errorMessage: string }
  | { type: "worker_stuck"; sessionId: string }
  | { type: "worker_exit"; sessionId: string; code: number | null }
  | { type: "session_status"; sessionId: string; status: SessionStatus };

export type SessionHistoryMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type SessionSummary = {
  id: string;
  filePath: string;
  cwd: string;
  name?: string;
  modified: string;
  firstMessage?: string;
  status: SessionStatus;
};
