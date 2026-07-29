export const IpcChannels = {
  window: {
    minimize: "window:minimize",
    maximize: "window:maximize",
    close: "window:close",
    forceClose: "window:forceClose",
    closeRequest: "window:closeRequest",
    isMaximized: "window:isMaximized",
    platform: "window:platform",
    setThemeSource: "window:setThemeSource",
    setChromeTheme: "window:setChromeTheme",
    requestMediaAccess: "window:requestMediaAccess",
    setUiLocale: "window:setUiLocale",
  },
  workspace: {
    get: "workspace:get",
    open: "workspace:open",
    pick: "workspace:pick",
    openPath: "workspace:openPath",
    clear: "workspace:clear",
    listRecent: "workspace:listRecent",
    removeRecent: "workspace:removeRecent",
    reorderRecent: "workspace:reorderRecent",
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
    /** Clear conversation messages on disk and restart the worker (keeps session id). */
    clearContext: "sessions:clearContext",
    /** Main → renderer: permission strip ask */
    permission: "sessions:permission",
    /** Renderer → main: permission strip reply */
    permissionReply: "sessions:permissionReply",
    /** Main → renderer: Pi extension UI (select/confirm/notify/…) */
    extensionUi: "sessions:extensionUi",
    /** Renderer → main: extension UI dialog reply */
    extensionUiReply: "sessions:extensionUiReply",
  },
  files: {
    list: "files:list",
    createFile: "files:createFile",
    createDir: "files:createDir",
    rename: "files:rename",
    move: "files:move",
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
    fetch: "git:fetch",
    restore: "git:restore",
    init: "git:init",
    remotes: "git:remotes",
    addRemote: "git:addRemote",
    setRemoteUrl: "git:setRemoteUrl",
    removeRemote: "git:removeRemote",
    log: "git:log",
    conflictContent: "git:conflictContent",
    resolveConflict: "git:resolveConflict",
    checkoutConflictSide: "git:checkoutConflictSide",
    abortMerge: "git:abortMerge",
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
    isAlive: "terminal:isAlive",
    getScrollback: "terminal:getScrollback",
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
    elementScreenshot: "browser:elementScreenshot",
    selectCancelled: "browser:selectCancelled",
    openDevTools: "browser:openDevTools",
    attachDevTools: "browser:attachDevTools",
    registerGuest: "browser:registerGuest",
    reportTab: "browser:reportTab",
    unreportTab: "browser:unreportTab",
    openTab: "browser:openTab",
    openTabAck: "browser:openTabAck",
    closeTab: "browser:closeTab",
    openExternal: "browser:openExternal",
    toggleEmbeddedDevTools: "browser:toggleEmbeddedDevTools",
  },
  asr: {
    status: "asr:status",
    setEnabled: "asr:setEnabled",
    setGpuPreference: "asr:setGpuPreference",
    install: "asr:install",
    installFromUrl: "asr:installFromUrl",
    pickModel: "asr:pickModel",
    importModel: "asr:importModel",
    reinstallRuntime: "asr:reinstallRuntime",
    pickRuntimeArchive: "asr:pickRuntimeArchive",
    importRuntime: "asr:importRuntime",
    uninstall: "asr:uninstall",
    transcribe: "asr:transcribe",
    streamStart: "asr:streamStart",
    streamPush: "asr:streamPush",
    streamStop: "asr:streamStop",
    streamEvent: "asr:streamEvent",
    progress: "asr:progress",
    setWakeHotkey: "asr:setWakeHotkey",
    setResidentModel: "asr:setResidentModel",
    setWakeWords: "asr:setWakeWords",
    /** Main → renderer: global wake hotkey pressed. */
    wake: "asr:wake",
  },
  update: {
    getAppInfo: "update:getAppInfo",
    openGithub: "update:openGithub",
    openReleases: "update:openReleases",
    openAuthorEmail: "update:openAuthorEmail",
    check: "update:check",
    download: "update:download",
    progress: "update:progress",
  },
  piCli: {
    status: "piCli:status",
    shouldPrompt: "piCli:shouldPrompt",
    install: "piCli:install",
    skip: "piCli:skip",
    openDocs: "piCli:openDocs",
    openSite: "piCli:openSite",
    progress: "piCli:progress",
  },
  market: {
    list: "market:list",
    install: "market:install",
  },
  checkpoint: {
    begin: "checkpoint:begin",
    finish: "checkpoint:finish",
    finishActive: "checkpoint:finishActive",
    get: "checkpoint:get",
    revert: "checkpoint:revert",
    updated: "checkpoint:updated",
  },
  notify: {
    turnComplete: "notify:turnComplete",
  },
  runs: {
    list: "runs:list",
    terminate: "runs:terminate",
    background: "runs:background",
    event: "runs:event",
  },
  trust: {
    get: "trust:get",
    set: "trust:set",
    clear: "trust:clear",
    listTrusted: "trust:listTrusted",
  },
  security: {
    get: "security:get",
    set: "security:set",
  },
} as const;

export type TrustPromptKind = "none" | "ask";

export type TrustState = {
  decision: boolean | null;
  needsResources: boolean;
  prompt: TrustPromptKind;
  projectTrusted: boolean;
};

export type SessionStatus = "idle" | "running" | "error" | "stuck";

/** Mirrors Pi SDK `ContextUsage` from `AgentSession.getContextUsage()`, plus session stats. */
export type SessionContextUsage = {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  /** Tool calls across the session (from Pi `getSessionStats`). */
  toolCalls?: number | null;
  /** User + assistant + toolResult messages (from Pi `getSessionStats`). */
  messageCount?: number | null;
  /** Estimated token breakdown for the stacked context bar. */
  segments?: ContextUsageSegment[] | null;
};

export type ContextUsageSegmentId =
  | "system"
  | "tools"
  | "summarized"
  | "conversation"
  | "toolResults";

export type ContextUsageSegment = {
  id: ContextUsageSegmentId;
  tokens: number;
};

/** Pi SDK ImageContent — base64 payload without data: URL prefix. */
export type PromptImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

export type AgentCommand =
  | {
      type: "prompt";
      message: string;
      images?: PromptImageContent[];
      citations?: ElementCitation[];
    }
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
  /** element click vs drag-to-region screenshot (Cursor-like). */
  kind?: "element" | "region";
  /** data:image/...;base64,... screenshot of selected element bounds (UI only; strip before IPC) */
  screenshotDataUrl?: string;
  /** CSS-pixel bounds in the guest page viewport (UI only; strip before IPC) */
  bounds?: { x: number; y: number; width: number; height: number };
};

export function isRegionCitation(c: Pick<ElementCitation, "kind" | "selector">): boolean {
  return c.kind === "region" || c.selector === "[region]";
}

/** Deep plain clone for Electron IPC (Vue proxies cannot be structured-cloned). */
export function toIpcPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Build Pi ImageContent list from composer/chat image payloads. */
export function toPromptImages(images: unknown[] | undefined): PromptImageContent[] | undefined {
  if (!images?.length) return undefined;
  const out: PromptImageContent[] = [];
  for (const img of images) {
    if (!img || typeof img !== "object") continue;
    const o = img as { type?: unknown; data?: unknown; mimeType?: unknown };
    let data = typeof o.data === "string" ? o.data : "";
    let mimeType =
      typeof o.mimeType === "string" && o.mimeType.trim() ? o.mimeType.trim() : "image/png";
    if (!data) continue;
    // Accept accidental data-URL form and normalize to raw base64.
    const dataUrl = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(data.trim());
    if (dataUrl?.[1] && dataUrl[2]) {
      mimeType = dataUrl[1];
      data = dataUrl[2];
    }
    if (!data) continue;
    out.push({ type: "image", data, mimeType });
  }
  return out.length ? out : undefined;
}

/** Citations for the worker — text context only (screenshots travel as images). */
export function toPromptCitations(
  citations: ElementCitation[] | undefined,
): ElementCitation[] | undefined {
  if (!citations?.length) return undefined;
  return citations.map((c) => ({
    url: String(c.url ?? ""),
    selector: String(c.selector ?? ""),
    text: String(c.text ?? ""),
    htmlSnippet: String(c.htmlSnippet ?? ""),
    ...(c.kind === "region" || c.kind === "element" ? { kind: c.kind } : {}),
  }));
}

export type AgentEvent =
  | { type: "connected"; sessionId: string }
  | { type: "agent_event"; sessionId: string; event: Record<string, unknown> }
  | { type: "context_usage"; sessionId: string; usage: SessionContextUsage }
  | { type: "prompt_done"; sessionId: string }
  | { type: "prompt_error"; sessionId: string; errorMessage: string }
  | { type: "worker_stuck"; sessionId: string }
  | { type: "worker_exit"; sessionId: string; code: number | null }
  | { type: "session_status"; sessionId: string; status: SessionStatus };

export type SessionHistoryMessage =
  | {
      id: string;
      role: "user";
      text: string;
    }
  | {
      id: string;
      role: "assistant";
      text: string;
      /** Model reasoning / thinking block when present. */
      thinking?: string;
    }
  | {
      id: string;
      role: "tool";
      toolCallId: string;
      toolName: string;
      text: string;
      isError?: boolean;
      /** Tool-call arguments from the preceding assistant toolCall (e.g. write content). */
      args?: unknown;
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
