import { spawnSync } from "node:child_process";
import { getGarminConfig, projectRoot } from "../src/config.js";
const result = spawnSync(
  getGarminConfig().pythonPath,
  ["-m", "unittest", "discover", "-s", "tests/python", "-v"],
  {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  }
);
if (result.error) throw new Error("Python test runner failed to start.");
process.exitCode = result.status ?? 1;
