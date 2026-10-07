/** Only locally authored messages cross the subprocess/MCP boundary. */
export const errorMessages = {
  configuration:
    "Invalid configuration. Use absolute GARMIN_PYTHON_PATH and GARMIN_MCP_DATA_DIR paths.",
  auth_required:
    "Garmin authentication is missing or invalid. Run npm run auth:login locally.",
  unsafe_store:
    "Unsafe token directory. Use a dedicated, private, user-owned directory outside repositories.",
  store_busy:
    "Garmin session is busy. Retry after the other local operation finishes.",
  persistence_failed:
    "Session could not be saved safely. Check private directory permissions and run auth:login.",
  rate_limited:
    "Garmin rate limited the request. Wait before trying again; do not repeat fresh logins.",
  activity_not_found: "Garmin activity was not found for this account.",
  request_failed:
    "Garmin request failed. Retry later; if authentication expired, run auth:login.",
  invalid_input: "Invalid tool input. Check IDs, dates, offset and limit.",
  bridge_failed: "Garmin bridge failed. Check Python setup and retry.",
  bridge_protocol: "Garmin bridge returned an invalid or oversized response.",
  bridge_timeout: "Garmin operation exceeded its deadline. Retry later.",
  shutting_down: "Garmin server is shutting down."
} as const;
export type ErrorCode = keyof typeof errorMessages;
/** Coded failures never retain dependency errors or captured stderr. */
export class GarminMcpError extends Error {
  constructor(readonly code: ErrorCode) {
    super(errorMessages[code]);
  }
}
export function formatErrorMessage(error: unknown): string {
  const code = error instanceof GarminMcpError ? error.code : "request_failed";
  return `${code}: ${errorMessages[code]}`;
}
