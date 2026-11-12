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

const DRAFT_KEY = "pi-desktop:ask-user-drafts:v2";
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
    const stored = JSON.parse(storage.get(DRAFT_KEY) ?? "{}") as Record<
      string,
      { draft: AskUserAnswerDraft; touchedAt: number }
    >;
    expect(stored["req-1"]?.draft).toEqual(DRAFT);
    expect(stored["req-1"]?.touchedAt).toEqual(expect.any(Number));
  });

  it("prunes by touchedAt instead of insertion order", () => {
    const now = vi.spyOn(Date, "now");
    for (let i = 0; i < 9; i += 1) {
      now.mockReturnValue(1000 + i);
      useChatStore.getState().writeAskDraft(`req-${i}`, DRAFT);
    }
    now.mockReturnValue(5000);
    useChatStore.getState().writeAskDraft("req-0", DRAFT);
    now.mockReturnValue(6000);
    useChatStore.getState().writeAskDraft("req-8", DRAFT);
    const stored = JSON.parse(storage.get(DRAFT_KEY) ?? "{}") as Record<string, unknown>;
    expect(Object.keys(stored)).toHaveLength(8);
    expect(Object.keys(stored)).toContain("req-0");
    expect(Object.keys(stored)).not.toContain("req-1");
    now.mockRestore();
  });

  it("keeps sensitive drafts in memory but out of sessionStorage", () => {
    useChatStore.getState().writeAskDraft("req-secret", DRAFT, false);
    const stored = JSON.parse(storage.get(DRAFT_KEY) ?? "{}") as Record<string, unknown>;
    expect(stored["req-secret"]).toBeUndefined();
    expect(useChatStore.getState().readAskDraft("req-secret")).toEqual(DRAFT);
  });
});
