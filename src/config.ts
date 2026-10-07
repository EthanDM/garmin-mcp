import { fileURLToPath } from "node:url";
import path from "node:path";
import { homedir } from "node:os";
import { accessSync, constants, statSync } from "node:fs";
import { GarminMcpError } from "./errors.js";

export type GarminConfig = {
  pythonPath: string;
  bridgePath: string;
  authPath: string;
  dataDir: string;
};
/** Both src/config.ts and dist/config.js are exactly one level below the project. */
export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
/** Validates executable configuration without opening any session state. */
export function getGarminConfig(
  env: NodeJS.ProcessEnv = process.env
): GarminConfig {
  const pythonPath =
    env.GARMIN_PYTHON_PATH ?? path.join(projectRoot, ".venv/bin/python");
  const dataDir =
    env.GARMIN_MCP_DATA_DIR ?? path.join(homedir(), ".config/garmin-mcp");
  if (
    !path.isAbsolute(pythonPath) ||
    !path.isAbsolute(dataDir) ||
    pythonPath.includes("\0") ||
    dataDir.includes("\0")
  )
    throw new GarminMcpError("configuration");
  try {
    accessSync(pythonPath, constants.X_OK);
    if (!statSync(pythonPath).isFile())
      throw new GarminMcpError("configuration");
  } catch {
    throw new GarminMcpError("configuration");
  }
  return {
    pythonPath,
    dataDir,
    bridgePath: path.join(projectRoot, "python/garmin_bridge.py"),
    authPath: path.join(projectRoot, "python/garmin_auth.py")
  };
}
