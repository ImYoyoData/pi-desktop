const sent = new Set<string>();

const longTasks: PerformanceEntry[] = [];
try {
	new PerformanceObserver((list) => {
		longTasks.push(...list.getEntries());
	}).observe({ entryTypes: ["longtask"] });
} catch {
	// longtask not supported
}

type StartupTimingApi = {
	api: {
		startupTiming: { mark: (name: string, detail?: string) => Promise<void> };
	};
};

export function markRendererStartup(name: string): void {
	if (sent.has(name)) return;
	sent.add(name);
	try {
		let detail: string | undefined;
		if (name === "renderer:ready") {
			const nav = performance.getEntriesByType("navigation").map((e) => ({
				domContentLoaded: Math.round(
					(e as PerformanceNavigationTiming).domContentLoadedEventEnd,
				),
				loadEvent: Math.round((e as PerformanceNavigationTiming).loadEventEnd),
			}))[0];
			const resources = performance
				.getEntriesByType("resource")
				.filter((e): e is PerformanceResourceTiming => "duration" in e)
				.sort((a, b) => b.duration - a.duration)
				.slice(0, 10)
				.map(
					(e) =>
						`  res ${e.duration.toFixed(0).padStart(6)} ms  ${(e.decodedBodySize / 1024).toFixed(0).padStart(6)} KB  ${e.name.split("/").pop()}`,
				);
			const tasks = longTasks
				.slice()
				.sort((a, b) => b.duration - a.duration)
				.slice(0, 10)
				.map(
					(e) =>
						`  task ${e.duration.toFixed(0).padStart(6)} ms @ ${e.startTime.toFixed(0)} ms  ${(e as { name?: string }).name ?? ""}`,
				);
			detail = [
				`  nav dcl=${nav?.domContentLoaded ?? "?"} ms load=${nav?.loadEvent ?? "?"} ms visibility=${document.visibilityState} cores=${navigator.hardwareConcurrency}`,
				...resources,
				...tasks,
			].join("\n");
		}
		void (window as unknown as StartupTimingApi).api.startupTiming.mark(
			name,
			detail,
		);
	} catch {
		// timing is best-effort
	}
}
