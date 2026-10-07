import { describe, expect, it } from "vitest";
import path from "node:path";
import { getGarminConfig, projectRoot } from "../src/config.js";
describe("configuration", () => {
  it("uses project-relative defaults and absolute explicit executable paths", () => {
    const config = getGarminConfig({ GARMIN_PYTHON_PATH: process.execPath });
    expect(config.bridgePath).toBe(
      path.join(projectRoot, "python/garmin_bridge.py")
    );
    expect(() => getGarminConfig({ GARMIN_PYTHON_PATH: "python" })).toThrow();
    expect(() =>
      getGarminConfig({
        GARMIN_PYTHON_PATH: process.execPath,
        GARMIN_MCP_DATA_DIR: "relative"
      })
    ).toThrow();
    expect(() =>
      getGarminConfig({ GARMIN_PYTHON_PATH: "/nonexistent/python" })
    ).toThrow();
    const before = process.cwd();
    try {
      process.chdir("/private/tmp");
      expect(
        getGarminConfig({ GARMIN_PYTHON_PATH: process.execPath }).bridgePath
      ).toBe(config.bridgePath);
    } finally {
      process.chdir(before);
    }
  });
});
