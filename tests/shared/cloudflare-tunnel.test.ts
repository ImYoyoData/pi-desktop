import { describe, expect, it } from "vitest";
import {
  cloudflaredArchiveKind,
  cloudflaredAsset,
  cloudflaredDownloadUrl,
  deriveAccessPin,
  findAssetSha256,
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

describe("cloudflaredAsset", () => {
  it("maps windows x64/arm64 to the raw exe assets", () => {
    expect(cloudflaredAsset("win32", "x64")).toEqual({
      asset: "cloudflared-windows-amd64.exe",
      executable: "cloudflared.exe",
    });
    expect(cloudflaredAsset("win32", "arm64")).toEqual({
      asset: "cloudflared-windows-arm64.exe",
      executable: "cloudflared.exe",
    });
  });

  it("maps mac to a tarball and linux to the raw binary", () => {
    expect(cloudflaredAsset("darwin", "arm64")).toEqual({
      asset: "cloudflared-darwin-arm64.tgz",
      executable: "cloudflared",
    });
    expect(cloudflaredAsset("linux", "x64")).toEqual({
      asset: "cloudflared-linux-amd64",
      executable: "cloudflared",
    });
  });

  it("returns null for unsupported platforms and architectures", () => {
    expect(cloudflaredAsset("win32", "ia32")).toBeNull();
    expect(cloudflaredAsset("freebsd", "x64")).toBeNull();
  });

  it("builds release download URLs with the bare (v-less) tag", () => {
    expect(cloudflaredDownloadUrl("cloudflared-windows-amd64.exe", "2026.9.1")).toBe(
      "https://github.com/cloudflare/cloudflared/releases/download/2026.9.1/cloudflared-windows-amd64.exe",
    );
    expect(cloudflaredDownloadUrl("cloudflared-linux-amd64", "v2026.9.1")).toBe(
      "https://github.com/cloudflare/cloudflared/releases/download/2026.9.1/cloudflared-linux-amd64",
    );
  });
});

describe("cloudflaredArchiveKind", () => {
  it("detects raw binaries, zips and tarballs", () => {
    expect(cloudflaredArchiveKind("cloudflared-windows-amd64.exe")).toBe("none");
    expect(cloudflaredArchiveKind("cloudflared-linux-amd64")).toBe("none");
    expect(cloudflaredArchiveKind("cloudflared-darwin-arm64.tgz")).toBe("tar.gz");
    expect(cloudflaredArchiveKind("cloudflared-windows-amd64.zip")).toBe("zip");
  });
});

describe("findAssetSha256", () => {
  const body = [
    "### SHA256 Checksums:",
    "```",
    "cloudflared-linux-amd64: 03f1f25d1cc93b9ad6c60569d44060bc4f17ed97075760ed8cfca4b12dcd68cc",
    "cloudflared-windows-amd64.exe: 2837888CC0F5D58F15B6DC478376DE90B4D3BA5241C7947455D1E0A0DF429712",
    "```",
  ].join("\n");

  it("matches the exact asset line and lowercases the digest", () => {
    expect(findAssetSha256(body, "cloudflared-windows-amd64.exe")).toBe(
      "2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712",
    );
    expect(findAssetSha256(body, "cloudflared-linux-amd64")).toBe(
      "03f1f25d1cc93b9ad6c60569d44060bc4f17ed97075760ed8cfca4b12dcd68cc",
    );
  });

  it("does not confuse similar asset names", () => {
    expect(findAssetSha256(body, "cloudflared-windows-amd64")).toBeNull();
    expect(findAssetSha256(body, "cloudflared-linux-amd64.deb")).toBeNull();
  });

  it("returns null without a checksum or body", () => {
    expect(findAssetSha256("no checksums here", "cloudflared-linux-amd64")).toBeNull();
    expect(findAssetSha256("", "cloudflared-linux-amd64")).toBeNull();
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
