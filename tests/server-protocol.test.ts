import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { projectRoot } from "../src/config.js";

it.each(["source", "built"])(
  "%s initializes stdio and executes synthetic calls from unrelated cwd",
  async (mode) => {
    const dir = await mkdtemp(path.join(tmpdir(), "garmin-mcp-protocol-"));
    const fakePython = path.join(dir, "python");
    // Test-only executable fixture. Production code has no synthetic-mode switch.
    await writeFile(
      fakePython,
      `#!${process.execPath}\nlet input="";process.stdin.on("data",c=>input+=c);process.stdin.on("end",()=>{const request=JSON.parse(input);if(process.argv[2]!==${JSON.stringify(path.join(projectRoot, "python/garmin_bridge.py"))})process.exit(2);const a={activityId:"24634321892",calories:404,bmrCalories:38};process.stdout.write(JSON.stringify({ok:true,data:request.operation==="list"?[a]:a}));});\n`
    );
    await chmod(fakePython, 0o700);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args:
        mode === "source"
          ? [
              "--import",
              path.join(projectRoot, "node_modules/tsx/dist/loader.mjs"),
              path.join(projectRoot, "src/server.ts")
            ]
          : [path.join(projectRoot, "dist/server.js")],
      cwd: dir,
      env: {
        GARMIN_PYTHON_PATH: fakePython,
        GARMIN_MCP_DATA_DIR: path.join(dir, "unused")
      },
      stderr: "pipe"
    });
    const client = new Client({ name: "offline-test", version: "1.0.0" });
    let stderr = "";
    transport.stderr?.on("data", (c) => (stderr += String(c)));
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual([
        "garmin_list_activities",
        "garmin_get_activity"
      ]);
      expect(
        tools.every((t) => t.annotations?.readOnlyHint && t.outputSchema)
      ).toBe(true);
      const result = await client.callTool({
        name: "garmin_get_activity",
        arguments: { activityId: "24634321892" }
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        activity: { activeCaloriesKcal: 366 }
      });
      const page = await client.callTool({
        name: "garmin_list_activities",
        arguments: {}
      });
      expect(page.structuredContent).toMatchObject({
        limit: 10,
        offset: 0,
        returnedCount: 1
      });
      const invalid = await client.callTool({
        name: "garmin_list_activities",
        arguments: { startDate: "2026-10-06" }
      });
      expect(invalid.isError).toBe(true);
      expect(stderr).toBe("");
    } finally {
      await client.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  10000
);
