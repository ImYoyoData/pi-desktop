export const IpcChannels = {
  workspace: {
    get: "workspace:get",
    open: "workspace:open",
    openPath: "workspace:openPath",
    listRecent: "workspace:listRecent",
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
  },
  models: {
    get: "models:get",
    set: "models:set",
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
    pickFile: "preview:pickFile",
  },
  browser: {
    create: "browser:create",
    navigate: "browser:navigate",
    back: "browser:back",
    forward: "browser:forward",
    reload: "browser:reload",
    startSelect: "browser:startSelect",
    stopSelect: "browser:stopSelect",
    elementSelected: "browser:elementSelected",
    setBounds: "browser:setBounds",
    destroy: "browser:destroy",
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
