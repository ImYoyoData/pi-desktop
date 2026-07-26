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
import type { WorkerInbound, WorkerOutbound } from "../shared/agent-worker-messages";

function post(msg: WorkerOutbound): void {
  process.parentPort?.postMessage(msg);
}

let session: AgentSession | null = null;
let initStarted = false;

function busyLoopMs(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // intentional busy loop for isolation smoke
  }
}

function formatCitationsBlock(citations: ElementCitation[]): string {
  const body = citations
    .map(
      (c, index) =>
        `### Citation ${index + 1}\n- URL: ${c.url}\n- Selector: ${c.selector}\n- Text: ${c.text}\n\n\`\`\`html\n${c.htmlSnippet}\n\`\`\``,
    )
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
    post({ kind: "event", event: event as Record<string, unknown> });
  });
  session = created;
  post({
    kind: "ready",
    id: sessionManager.getSessionId(),
    filePath: sessionManager.getSessionFile() ?? "",
    cwd: sessionManager.getCwd(),
  });
}

function requireSession(): AgentSession {
  if (!session) {
    throw new Error("worker session not initialized");
  }
  return session;
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
      await active.prompt(
        message,
        command.images?.length
          ? { images: command.images as ImageContent[] }
          : undefined,
      );
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
      post({ kind: "result", id, data: { ok: true } });
      return;
    }
    case "set_thinking_level":
      requireSession().setThinkingLevel(command.level as ThinkingLevel);
      post({ kind: "result", id, data: { ok: true } });
      return;
    case "compact":
      await requireSession().compact(command.customInstructions);
      post({ kind: "result", id, data: { ok: true } });
      return;
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
