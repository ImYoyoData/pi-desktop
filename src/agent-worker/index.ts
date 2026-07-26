import type { WorkerInbound } from "../shared/agent-worker-messages";
import { handleWorkerMessage } from "./runtime";

process.parentPort.on("message", (event: { data: WorkerInbound }) => {
  void handleWorkerMessage(event.data).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.parentPort?.postMessage({ kind: "fatal", error: message });
  });
});
