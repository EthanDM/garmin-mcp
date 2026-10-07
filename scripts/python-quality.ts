import { spawnSync } from "node:child_process";
import { getGarminConfig, projectRoot } from "../src/config.js";

const commands: Record<string, string[]> = {
  format: ["format"],
  "format-check": ["format", "--check"],
  lint: ["check"]
};

/** Runs the venv's pinned Ruff against maintained Python source and offline tests. */
function main(): void {
  const args = commands[process.argv[2] ?? ""];
  if (!args) throw new Error("Expected format, format-check or lint.");
  const result = spawnSync(
    getGarminConfig().pythonPath,
    ["-m", "ruff", ...args, "python", "tests/python"],
    {
      cwd: projectRoot,
      stdio: "inherit",
      env: { ...process.env, RUFF_NO_CACHE: "true" }
    }
  );
  if (result.error) throw new Error("Python quality tool failed to start.");
  process.exitCode = result.status ?? 1;
}

main();
