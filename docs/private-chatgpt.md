# Private ChatGPT connection

The existing built stdio server can serve both local Codex and a private personal
ChatGPT plugin. The ChatGPT connection uses an outbound OpenAI Secure MCP Tunnel;
it does not require a public listener or changes to the Garmin tool surface.

## Runtime and authentication

Build with `npm run build`, then launch `dist/server.js` with an absolute Node
executable path. The server resolves its Python bridge and virtual environment
from its own module location. Preserve the existing Garmin data directory and
operator-prepared session. Authentication and reauthentication remain local
operator CLI steps; credentials are never plugin tool arguments.

Create a dedicated tunnel for the intended personal organization and workspace.
Use the current official tunnel client after checking the release checksum.
Configure a private profile and a distinct user LaunchAgent with RunAtLoad and
KeepAlive. Reference the authorized runtime key from a private file. Keep profiles,
keys, machine identifiers and installation evidence outside Git.

Install a personal ChatGPT plugin using the dedicated tunnel. Preserve the direct
Codex registration. Both connections use the same local Garmin identity and
cross-process session locking.

## Verification and maintenance

- Run `npm run check` with an appropriate private temporary directory. On this Mac,
  `TMPDIR=/private/tmp` avoids the default temporary directory's symlink ancestry.
- Verify the LaunchAgent runs and the tunnel reports live, ready and successful
  control-plane polling.
- Confirm ChatGPT discovers `garmin_list_activities` and `garmin_get_activity`.
- Invoke both tools through the installed ChatGPT plugin and compare the result
  with a direct local MCP read. Local verification alone does not prove ChatGPT
  connectivity.

The host must be logged in, awake and online. Tool requests and results pass
through OpenAI; Garmin credentials and token storage stay on the host. After
server changes, rebuild and restart the dedicated service; refresh discovered
tools when the interface changes. Keep both tools read-only and retain the fixed
Python `list`/`get` allowlist.

See [OpenAI's Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).
