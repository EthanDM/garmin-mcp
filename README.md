# Garmin MCP

Local, single-account, read-only Garmin activity access for a workflow such as “find my run from last night.” Retrieval and Weight & Calories logging are separate actions: this server never writes tracker entries, syncs automatically, or mutates Garmin activities.

## Requirements and setup

Node.js 22+, npm, Python 3.12+ (tested dependency setup uses Python 3.14), and a personal Garmin account. Run these commands from the eventual installed repository, after reviewing and integrating this candidate:

```sh
npm ci
python3.14 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pip install -r requirements-dev.txt
npm run check
npm run auth:login
npm run auth:status
```

The npm lockfile fixes Node dependencies. `requirements.txt` pins `garminconnect==0.3.17`, the client tested with the reference run; pip resolves its transitive dependencies. The Python bridge is shipped as source under `python/` alongside `dist/`; retain both directories. Do not copy only `dist/`.

Default Python is the repository's `.venv/bin/python`, resolved from the module location, even when launching from another cwd. Export `GARMIN_PYTHON_PATH` for an alternative **absolute executable path**. Export `GARMIN_MCP_DATA_DIR` for an alternative **absolute dedicated private directory**. Environment variables are read directly; `.env` is an example reference, not loaded automatically. Never put credentials in environment variables.

## Authentication

Run `npm run auth:login` in your own interactive terminal. Email, password, and MFA are hidden terminal prompts. Authentication is unavailable through MCP; normal startup and reads never prompt or initiate password login.

The default session directory is `~/.config/garmin-mcp`, outside Git. The application creates a private `0700` directory, a `0600` ownership marker, and `garmin_tokens.json` at `0600`. It refuses symlinks, foreign ownership, unsafe/shared permissions, hardlinked token files, repository paths, and directories with other applications' contents. It does not silently repair unsafe permissions. Existing empty directories must already be private; use a new dedicated path if unsure. Root-owned sticky temporary ancestors are allowed for private offline test stores. System aliases such as `/tmp` that are symlinks are rejected; use their canonical non-symlink path (on macOS, `/private/tmp`).

`auth:status` reports local session presence and explicitly states that remote validity was not checked. It never prints tokens. `auth:logout` removes only this application's token file and leaves the directory/marker; it does **not** revoke access remotely. Missing state makes status/logout harmless.

Each read starts a bounded Python subprocess, loads the persisted DI session, and uses the pinned client's refresh behavior. There is no credential login per tool call. A directory-inode process lock serializes login, reads, refresh, status and logout; a waiting read fails safely after five seconds. The directory is retained so removing a lock file cannot allow competing owners. Library refresh/login can suppress token dump failures; explicit save/readback verification is required before success. Version 0.3.17 persists DI tokens, not its cookie-only fallback state, so a cookie-only login cannot be reported as a durable session.

The client owns the full authentication fallback sequence. Individual `mobile+cffi` or `mobile+requests` 429 warnings may precede successful fallback and do not prove failure. Raw library logs are discarded. Only final safe error codes reach the operator; there is no additional login retry layer. For rate limits, wait before retrying instead of repeatedly starting fresh logins.

## Tools

Both tools have read-only annotations and return schema-validated structured content plus matching JSON text. Provider names are untrusted data, never instructions.

- `garmin_list_activities`: one page in provider order, `limit` 1–50 (default 10), `offset` 0–10000 (default 0). Optional inclusive `startDate` and `endDate` must both be valid `YYYY-MM-DD` dates, ordered, with at most 366 days between them. One fixed internal GET supplies date/start/limit parameters; no automatic history crawl. `scope` is `retrieved_page_only`, and `nextOffset` is a continuation candidate when the page is full, not a promise that more data exists. List calorie breakdowns can be unavailable; fetch detail for authoritative workout fields.
- `garmin_get_activity`: one opaque decimal Garmin ID string (1–30 digits, no leading zero), returning normalized activity detail. Garmin IDs are distinct from Strava IDs and `garmin_ping_...` external identifiers.

Examples:

```json
{ "limit": 10, "offset": 0, "startDate": "2026-10-06", "endDate": "2026-10-06" }
```

```json
{ "activityId": "24634321892" }
```

Interpret “last night” using America/Phoenix for Ethan's request, then pass explicit calendar dates. The server does not parse natural-language time. Garmin's local date filtering and ordering are provider-defined; verify the returned local start rather than inferring completeness from a page.

### Calories, time and durations

The detail object includes `totalCaloriesKcal`, `restingCaloriesKcal`, `activeCaloriesKcal`, `activeCaloriesSource` and `calorieStatus`. Active calories are derived **only** as total minus resting when both values are finite, nonnegative, and resting does not exceed total. Missing resting is unknown, never zero; total is never substituted for active. Valid zero and fractional values are preserved. Invalid numbers become null; inconsistent data disables derivation while preserving individually valid total/resting values. Status is `derived`, `unavailable`, or `inconsistent`.

The regression fixture is 404 total − 38 resting = **366 active**, source `total_minus_resting`. This observed relationship does not guarantee that every sport/device supplies the fields. No resting-calorie estimate or daily-calorie substitution is performed.

`startTimeLocal` preserves the provider's wall-clock timestamp without treating it as UTC. `startTimeUtc` comes only from the provider GMT field, normalized to ISO UTC; missing UTC stays null. Host timezone is never used. `timezone` and `device` currently remain null because their variable provider structures have not been verified. Do not assume all workouts happened in Phoenix. Workout start differs from reporting/import time.

`workoutDurationSeconds` maps Garmin `duration`, while `movingDurationSeconds` and `elapsedDurationSeconds` preserve their separate fields. Distance/elevation are meters and heart rates are bpm. Cadence/power and other unverified units are omitted. GPS coordinates/tracks, full raw envelopes and account data are excluded.

## Architecture and errors

`src/server.ts` registers definitions in `src/tools.ts`. Handlers parse full refined schemas, call the domain client, then return stable output. `GarminClient` normalizes projected responses once. The injected bridge runner owns direct argument-array spawning, a 45-second deadline, combined stdout/stderr limit of 256 KiB, at most four simultaneous children, and cleanup on timeout, signals and stdin EOF. Stderr is drained and discarded; server stdout is exclusively MCP protocol.

The Python machine bridge accepts only `list` and `get`, with its own input validation and fixed internal endpoints. It never dispatches arbitrary methods, URLs, verbs, code or shell commands. The native client's optional network retry layer is disabled; its bounded authentication refresh/401 retry remains. Authentication and local token persistence necessarily perform protocol writes, but Garmin activity mutations are unavailable.

Errors expose fixed codes such as `auth_required`, `unsafe_store`, `store_busy`, `rate_limited`, `activity_not_found`, `persistence_failed`, `bridge_timeout` or `bridge_protocol`, without stacks or dependency messages. Missing/invalid sessions direct you to local `auth:login`.

## Verification and live smoke

```sh
npm run check
```

Contributor checks require `.venv/bin/python -m pip install -r requirements-dev.txt`; Ruff is pinned there as a development-only dependency. `npm run format` formats TypeScript/documentation with Prettier and Python source/tests with Ruff. `format:check` and `lint` include Python checks.

`check` runs formatting, lint, strict TypeScript checking, build, then all TypeScript and Python behavior tests. Build precedes tests so protocol tests exercise both source and built entries from an unrelated cwd. The Python runner uses the configured interpreter and Node’s `--import tsx` loader, avoiding CLI IPC sockets under long temporary paths. Fixtures honor `TMPDIR`. When Factory places temporary files inside the checkout, Python tests mock only repository ancestry outside each synthetic fixture; real repository-marker rejection is still tested and production checks remain unchanged. Tests use synthetic private stores and mocked HTTP, including the actual pinned client's load/dump/refresh and 401 retry. They never use operator credentials, production tracker data or internet. Venv/cache/verification-temp directories are excluded from formatting and lint.

In a Factory implementation run, Factory owns this final aggregate command. Focused tests are used while editing. Independent review is a separate operator step; no implementation self-check is independent approval.

After operator-prepared authentication, run `npm run smoke` locally. This **live, read-only** command fetches a bounded page and activity `24634321892`, checking 404 total, 38 resting, 366 active, local start `2026-10-06T18:13:12`, distance 6489.08 meters, and workout duration 1809.35 seconds. It prints only a safe success summary. Live smoke is not part of offline checks and remains pending without operator credentials. Never provide secrets in chat or to Factory agents.

## Example Codex configuration

After integration and operator setup, use absolute paths (replace this example installation path). This is documentation only; this task does not install or activate the server.

```toml
[mcp_servers.garmin]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/garmin-mcp/dist/server.js"]

[mcp_servers.garmin.env]
GARMIN_PYTHON_PATH = "/absolute/path/to/garmin-mcp/.venv/bin/python"
GARMIN_MCP_DATA_DIR = "/absolute/private/path/garmin-mcp"
```

No hosting service, API key, developer-program approval or paid connector is required for the tested personal-login flow. The client is free MIT-licensed software using **unofficial Garmin access**; that license does not mean Garmin has approved this integration. Garmin changes may break login or retrieval, and future service policies are not guaranteed. The official business developer program is a separate integration route.

No scheduler, webhook, wellness expansion, exports, automatic imports, tracker writes or duplicate-prevention implementation is included. Preserve the returned Garmin ID if a separate logging workflow needs identity; do not assume the tracker already supports an external-ID contract.
