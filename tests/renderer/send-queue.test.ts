import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSendQueueStore } from "../../src/renderer/src/stores/send-queue";

describe("send-queue", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	it("enqueues and consumes each item exactly once", () => {
		const q = useSendQueueStore();
		q.enqueue("s1", { text: "a" });
		q.enqueue("s1", { text: "b" });
		expect(q.list("s1")).toHaveLength(2);
		expect(q.takeNext("s1")?.text).toBe("a");
		expect(q.takeNext("s1")?.text).toBe("b");
		expect(q.takeNext("s1")).toBeNull();
	});

	it("editing an item does not duplicate it; discard keeps one copy", () => {
		const q = useSendQueueStore();
		const item = q.enqueue("s1", { text: "hello" });
		expect(q.list("s1")).toHaveLength(1);

		// Simulate beginEditQueueItem: mark editing (item stays in the queue).
		q.setEditing("s1", item.id);
		expect(q.list("s1")).toHaveLength(1);

		// Simulate discardQueueEdit: clear editing, item remains (single copy).
		q.setEditing("s1", null);
		expect(q.list("s1")).toHaveLength(1);
		expect(q.takeNext("s1")?.id).toBe(item.id);
		expect(q.list("s1")).toHaveLength(0);
	});

	it("remove drops the item and clears editing state", () => {
		const q = useSendQueueStore();
		const item = q.enqueue("s1", { text: "x" });
		q.setEditing("s1", item.id);
		expect(q.remove("s1", item.id)?.id).toBe(item.id);
		expect(q.list("s1")).toHaveLength(0);
		expect(q.editingId).toBeNull();
	});

	it("takeNext clears editing for the consumed item", () => {
		const q = useSendQueueStore();
		const item = q.enqueue("s1", { text: "y" });
		q.setEditing("s1", item.id);
		q.takeNext("s1");
		expect(q.editingId).toBeNull();
	});
});
