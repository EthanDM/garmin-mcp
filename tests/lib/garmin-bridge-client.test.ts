import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  GarminBridgeClient,
  BridgeProcessRunner
} from "../../src/lib/garmin-bridge-client.js";
import { getGarminConfig } from "../../src/config.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function runnerFor(script: string, timeout = 2000) {
  const dir = await mkdtemp(path.join(tmpdir(), "garmin-mcp-process-"));
  dirs.push(dir);
  const bridgePath = path.join(dir, "bridge.py");
  await writeFile(bridgePath, script);
  return {
    dir,
    runner: new BridgeProcessRunner(
      { ...getGarminConfig(), bridgePath, dataDir: path.join(dir, "unused") },
      timeout
    )
  };
}
describe("bridge envelopes", () => {
  it.each([
    "{}",
    "not json",
    '{"ok":true}',
    '{"ok":false,"code":"SECRET"}',
    '{"ok":true,"data":{},"token":"SECRET"}',
    "x".repeat(262145)
  ])("rejects malformed and unexpected output", async (output) => {
    const bridge = new GarminBridgeClient(async () => output);
    await expect(
      bridge.request("get", { activityId: "1" })
    ).rejects.toMatchObject({ code: "bridge_protocol" });
  });
  it("maps only safe codes", async () => {
    await expect(
      new GarminBridgeClient(
        async () => '{"ok":false,"code":"auth_required"}'
      ).request("get", { activityId: "1" })
    ).rejects.toMatchObject({ code: "auth_required" });
  });
});
describe("actual subprocess ownership", () => {
  it("spawns directly, sends one request, drains secret stderr and excludes inherited token env", async () => {
    const { runner } = await runnerFor(
      'import sys,json,os\nr=json.load(sys.stdin)\nprint("SECRET",file=sys.stderr)\nprint(json.dumps({"ok":True,"data":{"operation":r["operation"],"inherited":os.getenv("GARMINTOKENS")}}))\n'
    );
    const value = await new GarminBridgeClient(runner.run).request("get", {
      activityId: "1"
    });
    expect(value).toEqual({ operation: "get", inherited: null });
    runner.close();
  });
  it.each([
    [
      "import sys\nprint('SECRET',file=sys.stderr)\nsys.exit(3)\n",
      "bridge_failed"
    ],
    ["print('x'*300000)\n", "bridge_protocol"],
    ["import time\ntime.sleep(10)\n", "bridge_timeout"]
  ])("bounds failed, oversized and hung children", async (script, code) => {
    const { runner } = await runnerFor(script, 100);
    try {
      await expect(
        runner.run({ operation: "list", input: {} })
      ).rejects.toMatchObject({ code });
    } finally {
      runner.close();
    }
  });
  it("kills a timed-out child and closes pending requests on shutdown", async () => {
    const { dir, runner } = await runnerFor(
      'import os,sys,time\nopen(sys.argv[1]+".pid","w").write(str(os.getpid()))\ntime.sleep(10)\n',
      200
    );
    const request = runner.run({ operation: "get", input: {} });
    await expect(request).rejects.toMatchObject({ code: "bridge_timeout" });
    const pid = Number(await readFile(path.join(dir, "unused.pid"), "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
    const pending = runner.run({ operation: "get", input: {} });
    runner.close();
    await expect(pending).rejects.toMatchObject({ code: "bridge_failed" });
    await expect(
      runner.run({ operation: "get", input: {} })
    ).rejects.toMatchObject({ code: "shutting_down" });
  });
  it("caps simultaneous children and settles all requests on shutdown", async () => {
    const { runner } = await runnerFor("import time\ntime.sleep(10)\n");
    const pending = Array.from({ length: 4 }, () =>
      runner.run({ operation: "get", input: { activityId: "1" } })
    );
    await expect(
      runner.run({ operation: "get", input: { activityId: "1" } })
    ).rejects.toMatchObject({ code: "store_busy" });
    const results = Promise.allSettled(pending);
    runner.close();
    expect(
      (await results).every((result) => result.status === "rejected")
    ).toBe(true);
  });
  it("uses the real bridge for missing synthetic auth without network", async () => {
    // Missing auth performs no writes; use a unique absent path outside Git.
    const dir = path.join("/private/tmp", `garmin-mcp-missing-${randomUUID()}`);
    const runner = new BridgeProcessRunner({
      ...getGarminConfig(),
      dataDir: path.join(dir, "absent")
    });
    try {
      await expect(
        new GarminBridgeClient(runner.run).request("get", { activityId: "1" })
      ).rejects.toMatchObject({ code: "auth_required" });
    } finally {
      runner.close();
    }
  });
});
