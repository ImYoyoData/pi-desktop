import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../../src/renderer/src/stores/chat";
import type { AskUserAnswerDraft } from "../../src/shared/ask-user";

vi.mock("../../src/renderer/src/services/feedback", () => ({
  getMessage: () => ({
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  }),
}));

const DRAFT_KEY = "pi-desktop:ask-user-drafts:v1";
const storage = new Map<string, string>();

const DRAFT: AskUserAnswerDraft = {
  token: { optionIds: ["yes"], customText: "hunter2", skipped: false },
};

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  useChatStore.setState(useChatStore.getInitialState(), true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ask_user draft persistence", () => {
  it("writes drafts to sessionStorage by default", () => {
    useChatStore.getState().writeAskDraft("req-1", DRAFT);
    const stored = JSON.parse(storage.get(DRAFT_KEY) ?? "{}") as Record<string, unknown>;
    expect(stored["req-1"]).toEqual(DRAFT);
  });

  it("keeps sensitive drafts in memory but out of sessionStorage", () => {
    useChatStore.getState().writeAskDraft("req-secret", DRAFT, false);
    const stored = JSON.parse(storage.get(DRAFT_KEY) ?? "{}") as Record<string, unknown>;
    expect(stored["req-secret"]).toBeUndefined();
    expect(useChatStore.getState().readAskDraft("req-secret")).toEqual(DRAFT);
  });
});
