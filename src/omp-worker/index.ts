import { declareWorkerHostEntry, isWorkerHostSelector } from "@oh-my-pi/pi-utils/worker-host";
import { installProcessInbox } from "./process-inbox";
import { runOmpWorkerEntry } from "./worker-entry";

declareWorkerHostEntry();

const selector = process.argv[2];
if (isWorkerHostSelector(selector)) {
	installProcessInbox();
	await runOmpWorkerEntry(selector);
} else {
	await import("./main");
}
