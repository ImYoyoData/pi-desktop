import type { WorkerInbound } from "../shared/agent-worker-messages";
import { handleWorkerMessage } from "./runtime";

process.parentPort.on("message", (event: { data: WorkerInbound }) => {
  void handleWorkerMessage(event.data).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const data = event.data;
    // Command failures must resolve that command — never fatal the whole worker
    // (e.g. "Agent is already processing" from a raced second prompt).
    if (data && typeof data === "object" && data.kind === "command" && typeof data.id === "string") {
      process.parentPort?.postMessage({ kind: "result", id: data.id, error: message });
      return;
    }
    process.parentPort?.postMessage({ kind: "fatal", error: message });
  });
});
