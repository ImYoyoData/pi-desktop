import { parentPort, workerData } from "node:worker_threads";
import { enumerateAsrGpuOptions, resolveAsrGpuPreference } from "./asr-gpu";

const preference =
	typeof workerData?.preference === "string" ? workerData.preference : "auto";

try {
	const resolved = resolveAsrGpuPreference(preference);
	const options = enumerateAsrGpuOptions();
	parentPort?.postMessage({ ok: true, resolved, options });
} catch (err) {
	parentPort?.postMessage({
		ok: false,
		error: err instanceof Error ? err.message : String(err),
	});
}
