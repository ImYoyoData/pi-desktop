type IpcInboxHandler = (data: unknown) => void;

const queue: unknown[] = [];
let handler: IpcInboxHandler | null = null;

export function installProcessInbox(): void {
	process.on("message", (data: unknown) => {
		if (handler) handler(data);
		else queue.push(data);
	});
}

export function bindProcessInbox(next: IpcInboxHandler): () => void {
	handler = next;
	for (const data of queue.splice(0)) next(data);
	return () => {
		if (handler === next) handler = null;
	};
}
