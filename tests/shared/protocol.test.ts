import { describe, expect, it } from "vitest";
import { IpcChannels } from "../../src/shared/protocol";

function collectLeafChannels(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(collectLeafChannels);
  }
  return [];
}

describe("protocol", () => {
  it("has unique IPC channel leaf strings", () => {
    const channels = collectLeafChannels(IpcChannels);
    expect(channels.length).toBeGreaterThan(0);
    expect(new Set(channels).size).toBe(channels.length);
  });
});
