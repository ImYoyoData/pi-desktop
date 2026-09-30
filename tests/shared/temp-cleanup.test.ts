import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMP_CLEANUP_SETTINGS,
  parseTempCleanupSettings,
  PI_TEMP_PREFIXES,
  TEMP_CLEANUP_INTERVALS,
} from "../../src/shared/temp-cleanup";

describe("parseTempCleanupSettings", () => {
  it("falls back to defaults on missing or malformed input", () => {
    expect(parseTempCleanupSettings(undefined)).toEqual(DEFAULT_TEMP_CLEANUP_SETTINGS);
    expect(parseTempCleanupSettings("nope")).toEqual(DEFAULT_TEMP_CLEANUP_SETTINGS);
    expect(parseTempCleanupSettings([1, 2])).toEqual(DEFAULT_TEMP_CLEANUP_SETTINGS);
  });

  it("treats only an explicit true as enabled", () => {
    expect(parseTempCleanupSettings({ enabled: true }).enabled).toBe(true);
    expect(parseTempCleanupSettings({ enabled: "yes" }).enabled).toBe(false);
    expect(parseTempCleanupSettings({ enabled: false }).enabled).toBe(false);
  });

  it("keeps only whitelisted intervals", () => {
    const picked = TEMP_CLEANUP_INTERVALS[2];
    expect(parseTempCleanupSettings({ intervalHours: picked }).intervalHours).toBe(picked);
    expect(parseTempCleanupSettings({ intervalHours: 5 }).intervalHours).toBe(
      DEFAULT_TEMP_CLEANUP_SETTINGS.intervalHours,
    );
    expect(parseTempCleanupSettings({ intervalHours: -1 }).intervalHours).toBe(
      DEFAULT_TEMP_CLEANUP_SETTINGS.intervalHours,
    );
  });

  it("requires a positive max age", () => {
    expect(parseTempCleanupSettings({ maxAgeHours: 48 }).maxAgeHours).toBe(48);
    expect(parseTempCleanupSettings({ maxAgeHours: 0 }).maxAgeHours).toBe(
      DEFAULT_TEMP_CLEANUP_SETTINGS.maxAgeHours,
    );
    expect(parseTempCleanupSettings({ maxAgeHours: Number.NaN }).maxAgeHours).toBe(
      DEFAULT_TEMP_CLEANUP_SETTINGS.maxAgeHours,
    );
  });
});

describe("PI_TEMP_PREFIXES", () => {
  it("covers the prefixes Pi writes for command output", () => {
    expect(PI_TEMP_PREFIXES).toContain("pi-bash-");
    expect(PI_TEMP_PREFIXES).toContain("pi-powershell-");
  });
});
