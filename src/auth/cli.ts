import { spawn } from "node:child_process";
import { getGarminConfig } from "../config.js";
import { GarminMcpError, formatErrorMessage } from "../errors.js";
/** Interactive credentials travel only over the operator terminal, never MCP or argv. */
try {
  const operation = process.argv[2];
  if (!["login", "status", "logout"].includes(operation))
    throw new GarminMcpError("invalid_input");
  const config = getGarminConfig();
  const child = spawn(
    config.pythonPath,
    [config.authPath, operation, config.dataDir],
    {
      stdio: "inherit",
      env: {
        PATH: process.env.PATH,
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONUTF8: "1"
      }
    }
  );
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  child.on("error", () => {
    console.error(formatErrorMessage(new GarminMcpError("bridge_failed")));
    process.exitCode = 1;
  });
  child.on("close", (code) => {
    process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error(formatErrorMessage(error));
  process.exitCode = 1;
}
