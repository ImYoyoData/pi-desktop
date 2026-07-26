import type { AgentCommand } from "../shared/protocol";
import type { WorkerInbound, WorkerOutbound } from "../shared/agent-worker-messages";

function post(msg: WorkerOutbound): void {
  process.parentPort?.postMessage(msg);
}

function busyLoopMs(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // intentional busy loop for isolation smoke
  }
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
      post({
        kind: "event",
        event: { type: "assistant_delta", text: `[stub] ${command.message}` },
      });
      post({ kind: "result", id, data: { promptDone: true } });
      return;
    }
    case "abort":
    case "steer":
    case "follow_up":
    case "set_model":
    case "set_thinking_level":
    case "compact":
    case "get_state":
      post({ kind: "result", id, data: { ok: true } });
      return;
    default: {
      const _exhaustive: never = command;
      void _exhaustive;
      post({ kind: "result", id, error: "unsupported command" });
    }
  }
}
