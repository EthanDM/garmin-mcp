import { spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";
import type { GarminConfig } from "../config.js";
import { GarminMcpError, errorMessages } from "../errors.js";

const MAX_OUTPUT_BYTES = 256 * 1024;
const envelopeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown() }).strict(),
  z.object({ ok: z.literal(false), code: z.string() }).strict()
]);
export type BridgeRequest = {
  operation: "list" | "get";
  input: Record<string, unknown>;
};
export type BridgeRunner = (request: BridgeRequest) => Promise<string>;
/** Owns children until close; shutdown terminates every outstanding operation. No shell or inherited credentials. */
export class BridgeProcessRunner {
  /** Live subprocesses awaiting close, including children already sent a kill signal. */
  private readonly children = new Set<ChildProcess>();
  /** Prevents new operations after shutdown, independently of child completion. */
  private closed = false;
  constructor(
    private readonly config: GarminConfig,
    private readonly timeoutMs = 45_000
  ) {}
  /** One operation per child; deadlines and output bounds include lock wait and refresh. */
  run = (request: BridgeRequest): Promise<string> => {
    if (this.children.size >= 4)
      return Promise.reject(new GarminMcpError("store_busy"));
    if (this.closed) return Promise.reject(new GarminMcpError("shutting_down"));
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.config.pythonPath,
        [this.config.bridgePath, this.config.dataDir],
        {
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            PATH: process.env.PATH,
            PYTHONDONTWRITEBYTECODE: "1",
            PYTHONUTF8: "1"
          }
        }
      );
      this.children.add(child);
      const chunks: Buffer[] = [];
      let bytes = 0,
        failure: GarminMcpError | undefined;
      const terminate = (error: GarminMcpError) => {
        failure ??= error;
        child.kill("SIGKILL");
      };
      const timer = setTimeout(
        () => terminate(new GarminMcpError("bridge_timeout")),
        this.timeoutMs
      );
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT_BYTES)
          terminate(new GarminMcpError("bridge_protocol"));
        else chunks.push(chunk);
      });
      // Drain and count stderr, but never retain or propagate dependency diagnostics.
      child.stderr.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT_BYTES)
          terminate(new GarminMcpError("bridge_protocol"));
      });
      child.on("error", () => {
        failure ??= new GarminMcpError("bridge_failed");
      });
      child.stdin.on("error", () => {
        failure ??= new GarminMcpError("bridge_failed");
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        this.children.delete(child);
        if (failure) reject(failure);
        else if (code !== 0) reject(new GarminMcpError("bridge_failed"));
        else resolve(Buffer.concat(chunks).toString("utf8"));
      });
      child.stdin.end(JSON.stringify(request));
    });
  };
  /** Idempotent; killed children still settle their pending promises on close. */
  close(): void {
    this.closed = true;
    for (const child of this.children) child.kill("SIGKILL");
  }
}
/** Fixed read capabilities over a validated envelope. The runner is injectable for offline tests. */
export class GarminBridgeClient {
  constructor(private readonly run: BridgeRunner) {}
  /** Rejects unknown envelopes/codes and never includes stderr or dependency messages. */
  async request(
    operation: BridgeRequest["operation"],
    input: Record<string, unknown>
  ): Promise<unknown> {
    let value: unknown;
    try {
      const output = await this.run({ operation, input });
      if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES)
        throw new GarminMcpError("bridge_protocol");
      value = JSON.parse(output);
    } catch (error) {
      if (error instanceof GarminMcpError) throw error;
      throw new GarminMcpError("bridge_protocol");
    }
    const parsed = envelopeSchema.safeParse(value);
    if (!parsed.success || (parsed.data.ok && !("data" in parsed.data)))
      throw new GarminMcpError("bridge_protocol");
    if (!parsed.data.ok) {
      const code = parsed.data.code;
      if (!Object.hasOwn(errorMessages, code))
        throw new GarminMcpError("bridge_protocol");
      throw new GarminMcpError(code as keyof typeof errorMessages);
    }
    return parsed.data.data;
  }
}
