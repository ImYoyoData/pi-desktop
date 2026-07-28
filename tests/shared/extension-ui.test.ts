import { describe, expect, it } from "vitest";
import {
  extensionUiReplyResult,
  isExtensionUiPending,
  parseExtensionUiDialogParams,
  parseExtensionUiFireParams,
} from "../../src/shared/extension-ui";

describe("extension-ui protocol", () => {
  it("parses select dialog params", () => {
    const parsed = parseExtensionUiDialogParams(
      { method: "select", title: "Allow?", options: ["Allow", "Block"] },
      "req-1",
    );
    expect(parsed).toEqual({
      requestId: "req-1",
      method: "select",
      title: "Allow?",
      options: ["Allow", "Block"],
    });
  });

  it("rejects select without options", () => {
    expect(
      parseExtensionUiDialogParams({ method: "select", title: "x", options: [] }, "r"),
    ).toBeNull();
  });

  it("parses confirm and notify", () => {
    expect(
      parseExtensionUiDialogParams(
        { method: "confirm", title: "Clear?", message: "All gone" },
        "r2",
      ),
    ).toMatchObject({ method: "confirm", title: "Clear?", message: "All gone" });

    expect(
      parseExtensionUiFireParams({
        method: "notify",
        message: "Hello",
        notifyType: "warning",
      }),
    ).toEqual({ method: "notify", message: "Hello", notifyType: "warning" });
  });

  it("maps replies like Pi RPC clients", () => {
    expect(
      extensionUiReplyResult("select", { requestId: "a", value: "Allow" }),
    ).toBe("Allow");
    expect(extensionUiReplyResult("select", { requestId: "a", cancelled: true })).toBeUndefined();
    expect(extensionUiReplyResult("confirm", { requestId: "a", confirmed: true })).toBe(true);
    expect(extensionUiReplyResult("confirm", { requestId: "a", cancelled: true })).toBe(false);
  });

  it("detects pending dialog events", () => {
    expect(
      isExtensionUiPending({
        sessionId: "s",
        requestId: "r",
        method: "select",
        title: "T",
        options: ["A"],
      }),
    ).toBe(true);
    expect(
      isExtensionUiPending({
        sessionId: "s",
        requestId: "r",
        cancelled: true,
      }),
    ).toBe(false);
  });
});
