import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai/compat";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { AgentCommand, ElementCitation } from "../shared/protocol";
import { toPromptImages } from "../shared/protocol";
import { truncateHtmlSnippet } from "../shared/html-snippet";
import type { WorkerInbound, WorkerOutbound } from "../shared/agent-worker-messages";

function post(msg: WorkerOutbound): void {
  process.parentPort?.postMessage(msg);
}

let session: AgentSession | null = null;
let initStarted = false;

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
      const shot = c.screenshotDataUrl ? "\n- Screenshot: attached as image" : "";
      return `### Citation ${index + 1}\n- URL: ${c.url}\n- Selector: \`${c.selector}\`\n- Text: ${c.text}${shot}\n\n\`\`\`html\n${truncateHtmlSnippet(c.htmlSnippet)}\n\`\`\``;
    })
    .join("\n\n");
  return `Context from browser selection:\n\n${body}\n\n---\n\n`;
}

async function initSession(cwd: string, filePath?: string): Promise<void> {
  if (initStarted) {
    return;
  }
  initStarted = true;
  const agentDir = getAgentDir();
  const sessionManager = filePath
    ? SessionManager.open(filePath, undefined, cwd)
    : SessionManager.create(cwd);
  const services = await createAgentSessionServices({ cwd, agentDir });
  const { session: created } = await createAgentSessionFromServices({
    services,
    sessionManager,
  });
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
  post({
    kind: "ready",
    id: sessionManager.getSessionId(),
    filePath: sessionManager.getSessionFile() ?? "",
    cwd: sessionManager.getCwd(),
  });
  // contextUsage is pulled via get_state after attach; emitting here races ready handshake.
}

function requireSession(): AgentSession {
  if (!session) {
    throw new Error("worker session not initialized");
  }
  return session;
}

function readContextUsage(active: AgentSession): {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
} | null {
  const usage = active.getContextUsage();
  if (usage) {
    return {
      tokens: usage.tokens,
      contextWindow: usage.contextWindow,
      percent: usage.percent,
    };
  }
  const contextWindow = active.model?.contextWindow;
  if (typeof contextWindow === "number" && contextWindow > 0) {
    return { tokens: null, contextWindow, percent: null };
  }
  return null;
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
    },
  });
}

export async function handleWorkerMessage(msg: WorkerInbound): Promise<void> {
  if (msg.kind === "ping") {
    post({ kind: "pong" });
    return;
  }
  if (msg.kind === "shutdown") {
    process.exit(0);
    return;
  }
  if (msg.kind === "reload_models") {
    if (session) {
      await session.modelRuntime.refresh();
    }
    return;
  }
  if (msg.kind === "init") {
    await initSession(msg.cwd, msg.filePath);
    return;
  }
  if (msg.kind !== "command") {
    return;
  }

  const { id, command } = msg;
  await runCommand(id, command);
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
      const images = normalizePromptImages(command.images);
      await active.prompt(message, images?.length ? { images } : undefined);
      post({ kind: "result", id, data: { promptDone: true } });
      return;
    }
    case "steer":
      await requireSession().steer(command.message);
      post({ kind: "result", id, data: { ok: true } });
      return;
    case "follow_up":
      await requireSession().followUp(command.message);
      post({ kind: "result", id, data: { ok: true } });
      return;
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
