/**
 * Pure helpers for the Cloudflare quick tunnel ("远程控制" public access).
 *
 * Kept free of Electron APIs so the logic can be unit tested:
 * - trycloudflare public URL parsing (cloudflared prints it on stderr)
 * - cloudflared release asset naming per platform/arch
 * - the 9-digit numeric access PIN and its derived-key inputs
 */

import { createHmac } from "node:crypto";

/** Cloudflare quick tunnel hostnames, e.g. https://calm-river-1234.trycloudflare.com */
const TRYCLOUDFLARE_HOST_RE = /([a-z0-9][a-z0-9-]*\.trycloudflare\.com)/i;

export function parseQuickTunnelHost(text: string): string | null {
  if (typeof text !== "string" || !text) return null;
  return TRYCLOUDFLARE_HOST_RE.exec(text)?.[1]?.toLowerCase() ?? null;
}

/**
 * Public HTTPS URL of the tunnel. cloudflared prints either the bare hostname
 * (`https://x.trycloudflare.com`) or an indented box line, so both the host
 * regex and a generic URL scan are tried.
 */
export function parseQuickTunnelUrl(text: string): string | null {
  const host = parseQuickTunnelHost(text);
  if (host) return `https://${host}`;
  const match = /https?:\/\/[^\s"'`]+/i.exec(text ?? "");
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    return /trycloudflare\.com$/i.test(url.hostname)
      ? `https://${url.hostname.toLowerCase()}`
      : null;
  } catch {
    return null;
  }
}

export type CloudflaredAsset = { asset: string; executable: string };

/**
 * GitHub release asset for cloudflared. Returns null for platforms without an
 * official build (the caller reports a clear error instead of downloading junk).
 *
 * Release layout (as of the 2026.x line): windows assets are raw `.exe` files,
 * macOS ships a `.tgz` containing `cloudflared`, and Linux ships the raw binary.
 */
export function cloudflaredAsset(
  platform: string = process.platform,
  arch: string = process.arch,
): CloudflaredAsset | null {
  const a = arch === "arm64" ? "arm64" : arch === "x64" ? "amd64" : "";
  if (!a) return null;
  if (platform === "win32") {
    return { asset: `cloudflared-windows-${a}.exe`, executable: "cloudflared.exe" };
  }
  if (platform === "darwin") {
    return { asset: `cloudflared-darwin-${a}.tgz`, executable: "cloudflared" };
  }
  if (platform === "linux") {
    return {
      asset: a === "arm64" ? "cloudflared-linux-arm64" : `cloudflared-linux-${a}`,
      executable: "cloudflared",
    };
  }
  return null;
}

/** True when the downloaded asset is an archive that has to be unpacked. */
export function cloudflaredArchiveKind(asset: string): "none" | "zip" | "tar.gz" {
  if (/\.zip$/i.test(asset)) return "zip";
  if (/\.tgz$|\.tar\.gz$/i.test(asset)) return "tar.gz";
  return "none";
}

/**
 * cloudflared release tags carry no `v` prefix (e.g. `2026.9.1`), so the version
 * is used verbatim — a `v` would 404.
 */
export function cloudflaredDownloadUrl(asset: string, version: string): string {
  const tag = String(version).replace(/^v/iu, "");
  return `https://github.com/cloudflare/cloudflared/releases/download/${tag}/${asset}`;
}

/**
 * Pull one asset's SHA-256 out of a GitHub release body, which lists them as
 * `<asset>: <sha256>` lines. Returns null when the checksum is absent, so the
 * caller can decide whether a missing checksum is fatal.
 */
export function findAssetSha256(releaseBody: string, asset: string): string | null {
  if (!releaseBody || !asset) return null;
  const escaped = asset.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^\\s*${escaped}:\\s*([0-9a-f]{64})\\s*$`, "imu").exec(releaseBody);
  return match?.[1]?.toLowerCase() ?? null;
}

/** True when `value` is a 9-digit numeric PIN (the remote-control login code). */
export function isAccessPin(value: unknown): value is string {
  return typeof value === "string" && /^\d{9}$/u.test(value);
}

/** True when `value` is a 32-byte hex secret used to derive the PIN. */
export function isValidPinSecret(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/iu.test(value);
}

/**
 * Deterministic 9-digit PIN derived from the persisted secret. Rotating the
 * secret (a new random 32-byte hex value) yields a new PIN without the digits
 * ever being written to disk.
 *
 * The 32-bit draw is rejection-sampled below 4e9 so every PIN in 000000000…
 * 999999999 stays equally likely (a bare `% 1e9` would bias the low values).
 */
export function deriveAccessPin(secretHex: string): string {
  const secret = String(secretHex ?? "");
  if (!isValidPinSecret(secret)) throw new Error("invalid pin secret");
  for (let counter = 0; counter < 64; counter += 1) {
    const digest = createHmac("sha256", Buffer.from(secret, "hex")).update(`pin:${counter}`).digest();
    const value = digest.readUInt32BE(0);
    if (value < 4_000_000_000) return String(value % 1_000_000_000).padStart(9, "0");
  }
  throw new Error("failed to derive access pin");
}
