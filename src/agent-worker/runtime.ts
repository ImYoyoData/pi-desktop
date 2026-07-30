import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai/compat";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  createBashToolDefinition,
  defineTool,
  getAgentDir,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionError,
} from "@earendil-works/pi-coding-agent";
import type { AgentCommand, ElementCitation } from "../shared/protocol";
import { toPromptImages } from "../shared/protocol";
import { truncateHtmlSnippet } from "../shared/html-snippet";
import type { WorkerInbound, WorkerOutbound } from "../shared/agent-worker-messages";
import {
  BUILTIN_BROWSER_SELECTION_HEADER,
  isBuiltinBrowserToolName,
  resolveBuiltinBrowserSkillDir,
  shouldEnableBuiltinBrowserTools,
} from "../shared/builtin-browser";
import {
  DEFAULT_DESKTOP_SECURITY,
  isPermissionDecision,
  parseDesktopSecurity,
  PERMISSION_ASK_TIMEOUT_MS,
  type DesktopSecuritySettings,
  type SecurityCategory,
} from "../shared/desktop-security";
import {
  DESKTOP_ASK_USER_PROMPT,
  DESKTOP_COMPOSER_MODES_PROMPT,
  DESKTOP_BASH_BACKGROUND_PROMPT,
  DESKTOP_PROJECT_ORIENTATION_PROMPT,
} from "../shared/desktop-system-prompt";
import {
  createAskUserToolDefinition,
} from "./ask-user-tool";
import { commandShouldStartBackground } from "../shared/bash-background";
import { createTrackedBashOperations } from "./bash-run-tracker";
import { createBrowserToolDefinitions } from "./browser-tools";
import { readContextUsage } from "./context-usage";
import { createDesktopExtensionUIContext } from "./extension-ui-context";
import { handleRpcResponse, rpcToMain, setRpcWorkspaceRoot } from "./main-rpc";
import { createPermissionGate } from "./permission-gate";
import { logResourceSummary, summarizeSessionResources } from "./resource-summary";

function post(msg: WorkerOutbound): void {
  process.parentPort?.postMessage(msg);
}

let session: AgentSession | null = null;
let initStarted = false;
let runTracker: ReturnType<typeof createTrackedBashOperations> | null = null;
let desktopSecurity: DesktopSecuritySettings = { ...DEFAULT_DESKTOP_SECURITY };
const sessionAllows = new Set<SecurityCategory>();
/** Once unlocked this session, keep browser_* available for follow-up clicks/fills. */
let browserToolsUnlocked = false;

function workerDirname(): string {
  // electron-vite bundles the worker as CJS; __dirname points at out/agent-worker.
  return typeof __dirname === "string" ? __dirname : process.cwd();
}

function syncBuiltinBrowserTools(active: AgentSession, enable: boolean): void {
  const current = active.getActiveToolNames();
  const withoutBrowser = current.filter((name) => !isBuiltinBrowserToolName(name));
  if (!enable) {
    if (withoutBrowser.length !== current.length) {
      active.setActiveToolsByName(withoutBrowser);
    }
    return;
  }
  const browserNames = active
    .getAllTools()
    .map((t) => t.name)
    .filter(isBuiltinBrowserToolName);
  const next = [...new Set([...withoutBrowser, ...browserNames])];
  if (next.length !== current.length || next.some((n) => !current.includes(n))) {
    active.setActiveToolsByName(next);
  }
}

function applyBuiltinBrowserToolGate(
  active: AgentSession,
  message: string,
  citations?: ElementCitation[] | null,
): void {
  if (!browserToolsUnlocked && shouldEnableBuiltinBrowserTools(message, citations)) {
    browserToolsUnlocked = true;
  }
  syncBuiltinBrowserTools(active, browserToolsUnlocked);
}
function normalizePromptImages(images: unknown[] | undefined): ImageContent[] | undefined {
  const normalized = toPromptImages(images);
  return normalized as ImageContent[] | undefined;
}

/** Strip bulky / non-essential fields so IPC stays reliable and agent_end always reaches UI. */
function sanitizeAgentEvent(event: Record<string, unknown>): Record<string, unknown> {
  const type = event.type;
  if (type === "agent_end") {
    const messages = Array.isArray(event.messages) ? event.messages : [];
    const last = messages.length > 0 ? messages[messages.length - 1] : undefined;
    let lastError: string | undefined;
    if (last && typeof last === "object") {
      const msg = last as { stopReason?: unknown; errorMessage?: unknown };
      if (msg.stopReason === "error" && typeof msg.errorMessage === "string") {
        lastError = msg.errorMessage;
      }
    }
    return {
      type: "agent_end",
      willRetry: Boolean(event.willRetry),
      ...(lastError ? { lastError } : {}),
    };
  }
  if (type === "agent_settled") {
    return { type: "agent_settled" };
  }
  if (type === "turn_end") {
    return { type: "turn_end" };
  }
  return event;
}

const CONTEXT_USAGE_EVENT_TYPES = new Set([
  "agent_end",
  "agent_settled",
  "message_end",
  "compaction_end",
  "turn_end",
  "tool_execution_end",
]);

function busyLoopMs(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // intentional busy loop for isolation smoke
  }
}

function formatCitationsBlock(citations: ElementCitation[]): string {
  const body = citations
    .map((c, index) => {
      const shot =
        c.screenshotDataUrl || c.kind === "region"
          ? "\n- Screenshot: attached as image"
          : "";
      if (c.kind === "region" || c.selector === "[region]") {
        return `### Citation ${index + 1} (region)\n- URL: ${c.url}\n- Region: ${c.text || "screenshot"}${shot}`;
      }
      return `### Citation ${index + 1}\n- URL: ${c.url}\n- Selector: \`${c.selector}\`\n- Text: ${c.text}${shot}\n\n\`\`\`html\n${truncateHtmlSnippet(c.htmlSnippet)}\n\`\`\``;
    })
    .join("\n\n");
  return `${BUILTIN_BROWSER_SELECTION_HEADER}\n\nContext from browser selection:\n\n${body}\n\n---\n\n`;
}

async function initSession(
  cwd: string,
  filePath: string | undefined,
  projectTrusted: boolean,
  securitySnapshot?: DesktopSecuritySettings,
): Promise<void> {
  if (initStarted) {
    return;
  }
  initStarted = true;
  browserToolsUnlocked = false;
  setRpcWorkspaceRoot(cwd);
  if (securitySnapshot) {
    desktopSecurity = parseDesktopSecurity(securitySnapshot);
  }
  const agentDir = getAgentDir();
  const sessionManager = filePath
    ? SessionManager.open(filePath, undefined, cwd)
    : SessionManager.create(cwd);
  const settingsManager = SettingsManager.create(cwd, agentDir, {
    projectTrusted: Boolean(projectTrusted),
  });
  const builtinBrowserSkillDir = resolveBuiltinBrowserSkillDir(
    workerDirname(),
    typeof process.resourcesPath === "string" ? process.resourcesPath : undefined,
  );
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    settingsManager,
    resourceLoaderOptions: {
      appendSystemPrompt: [
        DESKTOP_PROJECT_ORIENTATION_PROMPT,
        DESKTOP_ASK_USER_PROMPT,
        DESKTOP_BASH_BACKGROUND_PROMPT,
        DESKTOP_COMPOSER_MODES_PROMPT,
      ],
      ...(builtinBrowserSkillDir
        ? { additionalSkillPaths: [builtinBrowserSkillDir] }
        : {}),
    },
  });
  let assertBashExecAllowed: ((command: string) => void) | null = null;
  let takeBashBackgroundFlag: ((command: string) => boolean) | null = null;
  runTracker = createTrackedBashOperations(undefined, {
    sessionId: sessionManager.getSessionId(),
    workspaceRoot: cwd,
    onStarted: (run) => post({ kind: "run_started", run }),
    onOutput: (runId, chunk) => post({ kind: "run_output", runId, chunk }),
    onEnded: (runId) => post({ kind: "run_ended", runId }),
    onBackgrounded: (runId) => post({ kind: "run_backgrounded", runId }),
    beforeExec: (command) => assertBashExecAllowed?.(command),
    shouldStartBackground: (command) =>
      Boolean(takeBashBackgroundFlag?.(command)) || commandShouldStartBackground(command),
  });
  const { session: created, extensionsResult } = await createAgentSessionFromServices({
    services,
    sessionManager,
    customTools: [
      defineTool(
        createBashToolDefinition(cwd, {
          operations: runTracker.operations,
        }),
      ),
      createAskUserToolDefinition(),
      ...createBrowserToolDefinitions(),
    ],
  });
  // Bind Desktop ExtensionUIContext so ctx.ui.select/confirm/notify work in Electron.
  // session_start is when extensions (incl. MCP-backed ones) typically connect.
  const extensionBindErrors: string[] = [];
  try {
    await created.bindExtensions({
      uiContext: createDesktopExtensionUIContext(),
      mode: "rpc",
      onError: (err: ExtensionError) => {
        const message = `${err.extensionPath} @ ${err.event}: ${err.error}`;
        extensionBindErrors.push(message);
        console.error(`[pi-desktop] extension runtime error: ${message}`);
        if (err.stack) console.error(err.stack);
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    extensionBindErrors.push(`bindExtensions failed: ${message}`);
    console.error(`[pi-desktop] bindExtensions failed: ${message}`);
  }
  // Registered but inactive until the user mentions browser / selects elements.
  syncBuiltinBrowserTools(created, false);
  const {
    gate: permissionGate,
    assertBashExecAllowed: assertBash,
    takeBashBackgroundFlag: takeBg,
  } = createPermissionGate({
    getSettings: () => desktopSecurity,
    getCwd: () => cwd,
    sessionAllows,
    askUser: async (req) => {
      const raw = await rpcToMain(
        "desktop.permissionAsk",
        {
          category: req.category,
          toolName: req.toolName,
          summary: req.summary,
        },
        PERMISSION_ASK_TIMEOUT_MS,
      );
      if (!isPermissionDecision(raw)) {
        throw new Error("invalid permission decision from main");
      }
      return raw;
    },
  });
  assertBashExecAllowed = assertBash;
  takeBashBackgroundFlag = takeBg;
  const prevBefore = created.agent.beforeToolCall?.bind(created.agent);
  created.agent.beforeToolCall = async (ctx, signal) => {
    const gated = await permissionGate(ctx, signal);
    if (gated?.block) return gated;
    return prevBefore?.(ctx, signal);
  };

  created.subscribe((event) => {
    const raw = event as Record<string, unknown>;
    try {
      post({ kind: "event", event: sanitizeAgentEvent(raw) });
    } catch {
      // Last-resort: always deliver a lightweight lifecycle signal so UI can leave "running".
      const type = typeof raw.type === "string" ? raw.type : "unknown";
      post({ kind: "event", event: { type } });
    }
    const t = raw.type;
    if (typeof t === "string" && CONTEXT_USAGE_EVENT_TYPES.has(t)) {
      try {
        emitContextUsage(created);
      } catch {
        // context meter is best-effort
      }
    }
  });
  session = created;
  const resources = summarizeSessionResources(
    services,
    extensionsResult,
    created.getActiveToolNames(),
  );
  if (extensionBindErrors.length) {
    resources.diagnostics.push(
      ...extensionBindErrors.map((message) => `[bind] ${message}`),
    );
  }
  logResourceSummary(resources);
  post({
    kind: "ready",
    id: sessionManager.getSessionId(),
    filePath: sessionManager.getSessionFile() ?? "",
    cwd: sessionManager.getCwd(),
    resources,
  });
  // contextUsage is pulled via get_state after attach; emitting here races ready handshake.
}

function requireSession(): AgentSession {
  if (!session) {
    throw new Error("worker session not initialized");
  }
  return session;
}

/**
 * ModelRuntime.refresh() reloads models.json / catalogs, but AuthStorage keeps an
 * in-memory snapshot of auth.json from worker start. Re-read disk before refresh.
 */
function reloadAuthStorageCache(active: AgentSession): void {
  const runtime = active.modelRuntime as unknown as {
    credentials?: { store?: { reload?: () => void } };
  };
  runtime.credentials?.store?.reload?.();
}

async function refreshSessionModel(active: AgentSession): Promise<void> {
  const current = active.model;
  if (!current) return;
  const next = active.modelRuntime.getModel(current.provider, current.id);
  if (next && next !== current) {
    await active.setModel(next);
  }
}

function emitContextUsage(active: AgentSession): void {
  const usage = readContextUsage(active);
  if (!usage) return;
  post({
    kind: "event",
    event: {
      type: "context_usage",
      tokens: usage.tokens,
      contextWindow: usage.contextWindow,
      percent: usage.percent,
      toolCalls: usage.toolCalls,
      messageCount: usage.messageCount,
      segments: usage.segments ?? null,
    },
  });
}

export async function handleWorkerMessage(msg: WorkerInbound): Promise<void> {
  if (msg.kind === "ping") {
    post({ kind: "pong" });
    return;
  }
  if (msg.kind === "shutdown") {
    runTracker?.endAllRuns();
    process.exit(0);
    return;
  }
  if (msg.kind === "reload_models") {
    if (session) {
      reloadAuthStorageCache(session);
      await session.modelRuntime.refresh({ allowNetwork: false });
      await refreshSessionModel(session);
    }
    return;
  }
  if (msg.kind === "reload_security") {
    desktopSecurity = parseDesktopSecurity(msg.desktopSecurity);
    return;
  }
  if (msg.kind === "init") {
    await initSession(msg.cwd, msg.filePath, msg.projectTrusted, msg.desktopSecurity);
    return;
  }
  if (msg.kind === "terminate_run") {
    runTracker?.terminateRun(msg.runId);
    return;
  }
  if (msg.kind === "background_run") {
    runTracker?.backgroundRun(msg.runId);
    return;
  }
  if (msg.kind === "rpc_response") {
    handleRpcResponse(msg);
    return;
  }
  if (msg.kind !== "command") {
    return;
  }

  const { id, command } = msg;
  try {
    await runCommand(id, command);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    post({ kind: "result", id, error: message });
  }
}

async function runCommand(id: string, command: AgentCommand): Promise<void> {
  switch (command.type) {
    case "ping":
      post({ kind: "result", id, data: { ok: true } });
      return;
    case "hang":
      busyLoopMs(30_000);
      post({ kind: "result", id, data: { ok: true } });
      return;
    case "prompt": {
      const active = requireSession();
      let message = command.message;
      if (command.citations?.length) {
        message = formatCitationsBlock(command.citations) + message;
      }
      applyBuiltinBrowserToolGate(active, message, command.citations);
      const images = normalizePromptImages(command.images);
      await active.prompt(message, images?.length ? { images } : undefined);
      post({ kind: "result", id, data: { promptDone: true } });
      return;
    }
    case "steer": {
      const active = requireSession();
      applyBuiltinBrowserToolGate(active, command.message);
      await active.steer(command.message);
      post({ kind: "result", id, data: { ok: true } });
      return;
    }
    case "follow_up": {
      const active = requireSession();
      applyBuiltinBrowserToolGate(active, command.message);
      await active.followUp(command.message);
      post({ kind: "result", id, data: { ok: true } });
      return;
    }
    case "abort":
      await requireSession().abort();
      post({ kind: "result", id, data: { ok: true } });
      return;
    case "set_model": {
      const active = requireSession();
      const models = await active.modelRuntime.getAvailable();
      const model = models.find(
        (m) => m.provider === command.provider && m.id === command.modelId,
      );
      if (!model) {
        post({
          kind: "result",
          id,
          error: `Model not found: ${command.provider}/${command.modelId}`,
        });
        return;
      }
      await active.setModel(model);
      emitContextUsage(active);
      post({ kind: "result", id, data: { ok: true } });
      return;
    }
    case "set_thinking_level":
      requireSession().setThinkingLevel(command.level as ThinkingLevel);
      post({ kind: "result", id, data: { ok: true } });
      return;
    case "compact": {
      const active = requireSession();
      await active.compact(command.customInstructions);
      emitContextUsage(active);
      post({ kind: "result", id, data: { ok: true } });
      return;
    }
    case "get_state": {
      const active = requireSession();
      post({
        kind: "result",
        id,
        data: {
          model: active.model,
          thinkingLevel: active.thinkingLevel,
          isStreaming: active.isStreaming,
          sessionFile: active.sessionFile,
          sessionId: active.sessionId,
          sessionName: active.sessionName,
          messageCount: active.messages.length,
          contextUsage: readContextUsage(active),
        },
      });
      return;
    }
    default: {
      const _exhaustive: never = command;
      void _exhaustive;
      post({ kind: "result", id, error: "unsupported command" });
    }
  }
}
