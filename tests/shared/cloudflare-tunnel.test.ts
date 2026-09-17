import { describe, expect, it } from "vitest";
import {
  cloudflaredDownloadUrl,
  deriveAccessPin,
  isAccessPin,
  isValidPinSecret,
  parseQuickTunnelHost,
  parseQuickTunnelUrl,
} from "../../src/shared/cloudflare-tunnel";

describe("parseQuickTunnelHost", () => {
  it("extracts the hostname from the plain cloudflared banner", () => {
    expect(parseQuickTunnelHost("+--------------------------------------------------------------------------------------------+\n" +
      "|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |\n" +
      "|  https://calm-sunset-1234.trycloudflare.com                                                |\n" +
      "+--------------------------------------------------------------------------------------------+")).toBe(
      "calm-sunset-1234.trycloudflare.com",
    );
  });

  it("lowercases and ignores unrelated lines", () => {
    expect(parseQuickTunnelHost("INF Requesting new quick Tunnel on trycloudflare.com...")).toBeNull();
    expect(parseQuickTunnelHost("https://Brave-River-99.trycloudflare.com")).toBe(
      "brave-river-99.trycloudflare.com",
    );
  });

  it("returns null for empty input", () => {
    expect(parseQuickTunnelHost("")).toBeNull();
  });
});

describe("parseQuickTunnelUrl", () => {
  it("builds the https URL from a bare hostname", () => {
    expect(parseQuickTunnelUrl("https://quick-fox-7.trycloudflare.com\n")).toBe(
      "https://quick-fox-7.trycloudflare.com",
    );
  });

  it("strips paths and query strings", () => {
    expect(parseQuickTunnelUrl("visit https://quick-fox-7.trycloudflare.com/foo?x=1 now")).toBe(
      "https://quick-fox-7.trycloudflare.com",
    );
  });

  it("rejects other hosts", () => {
    expect(parseQuickTunnelUrl("https://example.com")).toBeNull();
    expect(parseQuickTunnelUrl("no url here")).toBeNull();
  });
});

describe("access pin", () => {
  const secret = "a".repeat(64);

  it("accepts only 9 digits", () => {
    expect(isAccessPin("123456789")).toBe(true);
    expect(isAccessPin("12345678")).toBe(false);
    expect(isAccessPin("1234567890")).toBe(false);
    expect(isAccessPin("12345678a")).toBe(false);
    expect(isAccessPin(123456789)).toBe(false);
  });

  it("validates the secret format", () => {
    expect(isValidPinSecret(secret)).toBe(true);
    expect(isValidPinSecret("a".repeat(63))).toBe(false);
    expect(isValidPinSecret("z".repeat(64))).toBe(false);
  });

  it("derives a stable 9-digit pin", () => {
    const pin = deriveAccessPin(secret);
    expect(pin).toMatch(/^\d{9}$/u);
    expect(deriveAccessPin(secret)).toBe(pin);
  });

  it("changes with the secret and rejects bad secrets", () => {
    expect(deriveAccessPin("b".repeat(64))).not.toBe(deriveAccessPin(secret));
    expect(() => deriveAccessPin("short")).toThrow();
  });
});
