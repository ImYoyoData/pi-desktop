export const IpcChannels = {
  window: {
    minimize: "window:minimize",
    maximize: "window:maximize",
    close: "window:close",
    isMaximized: "window:isMaximized",
    platform: "window:platform",
    setThemeSource: "window:setThemeSource",
    setChromeTheme: "window:setChromeTheme",
    requestMediaAccess: "window:requestMediaAccess",
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
    elementScreenshot: "browser:elementScreenshot",
    openDevTools: "browser:openDevTools",
    attachDevTools: "browser:attachDevTools",
    registerGuest: "browser:registerGuest",
    openExternal: "browser:openExternal",
    toggleEmbeddedDevTools: "browser:toggleEmbeddedDevTools",
  },
  asr: {
    status: "asr:status",
    setEnabled: "asr:setEnabled",
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
} as const;

export type SessionStatus = "idle" | "running" | "error" | "stuck";

/** Mirrors Pi SDK `ContextUsage` from `AgentSession.getContextUsage()`. */
export type SessionContextUsage = {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
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
  /** data:image/...;base64,... screenshot of selected element bounds (UI only; strip before IPC) */
  screenshotDataUrl?: string;
  /** CSS-pixel bounds in the guest page viewport (UI only; strip before IPC) */
  bounds?: { x: number; y: number; width: number; height: number };
};

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
