# Garmin MCP

Keep the server local, read-only, and limited to bounded activity listing and activity detail. Use a TypeScript stdio MCP and an allowlisted Python bridge to garminconnect==0.3.17; do not expose arbitrary methods or Garmin mutations.

Use mcp-server-pattern and human-readable-code for implementation, and comments-that-add-information for non-obvious contracts. Preserve total, resting, and derived active calories; missing resting calories are unknown. Preserve local timestamps separately from UTC.

Never read operator credentials, production token stores, or tracker data. Interactive authentication is an operator CLI step; offline tests use synthetic data and private temporary stores. Keep stdout exclusively MCP protocol.

Factory owns final offline verification. The final check must cover formatting, lint, strict types, TypeScript/Python behavior tests, and build. Live smoke requires operator-prepared credentials and remains separately pending. Do not publish, push, integrate, install, modify Codex configuration, or start nested Factory runs.
