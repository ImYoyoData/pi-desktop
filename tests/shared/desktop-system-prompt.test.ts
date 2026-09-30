import { describe, expect, it } from "vitest";
import {
  DESKTOP_ASK_USER_PROMPT,
  DESKTOP_BASH_BACKGROUND_PROMPT,
  DESKTOP_COMPOSER_MODES_PROMPT,
} from "../../src/shared/desktop-system-prompt";

describe("DESKTOP_ASK_USER_PROMPT", () => {
  it("documents ask_user usage", () => {
    expect(DESKTOP_ASK_USER_PROMPT).toContain("ask_user");
    expect(DESKTOP_ASK_USER_PROMPT).toContain("[ask_user answers]");
    expect(DESKTOP_ASK_USER_PROMPT).toContain("allowCustom");
  });
});

describe("DESKTOP_BASH_BACKGROUND_PROMPT", () => {
  it("documents wait vs background and the Running panel", () => {
    expect(DESKTOP_BASH_BACKGROUND_PROMPT).toContain("background");
    expect(DESKTOP_BASH_BACKGROUND_PROMPT).toContain("Running");
    expect(DESKTOP_BASH_BACKGROUND_PROMPT).toContain("pi-desktop:background");
  });
});

describe("DESKTOP_COMPOSER_MODES_PROMPT", () => {
  it("documents plan/ask/task/agent modes", () => {
    expect(DESKTOP_COMPOSER_MODES_PROMPT).toContain("agent");
    expect(DESKTOP_COMPOSER_MODES_PROMPT).toContain("plan");
    expect(DESKTOP_COMPOSER_MODES_PROMPT).toContain("ask");
    expect(DESKTOP_COMPOSER_MODES_PROMPT).toContain("task");
    expect(DESKTOP_COMPOSER_MODES_PROMPT).toContain("[pi-desktop mode:");
    expect(DESKTOP_COMPOSER_MODES_PROMPT).toContain("Task mode");
  });
});
