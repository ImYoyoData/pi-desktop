import { describe, expect, it } from "vitest";
import { augmentPathForPiCli } from "../../src/main/pi-path-env";

describe("augmentPathForPiCli", () => {
  it("preserves existing PATH entries", () => {
    const env = augmentPathForPiCli({ PATH: "C:\\\\existing" });
    expect(env.PATH?.split(/;|:/).some((p) => p.includes("existing"))).toBe(true);
  });

  it("does not clear HOME/USERPROFILE", () => {
    const env = augmentPathForPiCli({
      PATH: "/usr/bin",
      HOME: "/Users/test",
      USERPROFILE: "C:\\\\Users\\\\test",
    });
    expect(env.HOME).toBe("/Users/test");
    expect(env.USERPROFILE).toBe("C:\\\\Users\\\\test");
  });
});
