import { describe, expect, it } from "vitest";
import {
  DESKTOP_ASK_USER_PROMPT,
  DESKTOP_BASH_BACKGROUND_PROMPT,
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
