# Garmin MCP

Keep the server local, read-only, and limited to bounded activity listing and activity detail. Use a TypeScript stdio MCP and an allowlisted Python bridge to garminconnect==0.3.17; do not expose arbitrary methods or Garmin mutations.

Use mcp-server-pattern and human-readable-code for implementation, and comments-that-add-information for non-obvious contracts. Preserve total, resting, and derived active calories; missing resting calories are unknown. Preserve local timestamps separately from UTC.

Never read operator credentials, production token stores, or tracker data. Interactive authentication is an operator CLI step; offline tests use synthetic data and private temporary stores. Keep stdout exclusively MCP protocol.

Factory owns final offline verification. The final check must cover formatting, lint, strict types, TypeScript/Python behavior tests, and build. Live smoke requires operator-prepared credentials and remains separately pending. Do not publish, push, integrate, install, modify Codex configuration, or start nested Factory runs.

The Python machine bridge allowlist is exactly `list` and `get`; authentication is only `python/garmin_auth.py` via the operator CLI. Never pass arbitrary endpoints, methods, verbs, code, executable fragments or credentials through tools. Preserve private marked stores and cross-process locking; ignore inherited GARMINTOKENS. Default Python/bridge paths resolve from module locations, never cwd.

Use npm and the committed npm lockfile. Pin `requirements.txt` to garminconnect==0.3.17. Offline tests honor TMPDIR and use synthetic stores; test-only repository-ancestry mocks permit fixtures under the verifier worktree while retaining real fixture marker rejection. Production repository-store checks must never be relaxed; real native load/dump/refresh must use mocked HTTP. Do not read existing operator stores or /private/tmp/garmin-probe. Keep projection fields bounded and avoid raw private envelopes/GPS. Unverified device/timezone structures stay null.

`npm run check` includes format:check, lint, strict typecheck, build, and all TypeScript/Python behavior tests, with build before protocol tests. During Factory implementation run focused affected tests only; Factory executes the final aggregate after the agent stops. The operator obtains fresh independent review separately. Run `smoke` only with operator-prepared credentials; it is never an offline check. Installation/configuration, publication and integration remain separate actions.
