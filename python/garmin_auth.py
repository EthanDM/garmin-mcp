"""Operator-only terminal authentication. No credential arguments or MCP operations."""
import getpass
import json
import os
import sys
from garmin_session import TOKEN_NAME, SafeError, locked_store, persist, quiet_library, private_file

MESSAGES = {
    "auth_required": "No valid local session. Run npm run auth:login.",
    "unsafe_store": "Unsafe store. Use a dedicated private user-owned directory outside repositories.",
    "store_busy": "Session is busy. Retry after the other local operation completes.",
    "persistence_failed": "Unable to persist a resumable DI session. Check permissions and retry auth:login.",
    "auth_failed": "Authentication failed after library fallback. Retry later; individual 429 warnings are not final failure.",
    "invalid_input": "Expected login, status or logout; login requires an interactive terminal."
}


def auth(operation, store):
    """Status inspects local state only; logout removes only this app's token file, no remote revocation."""
    if operation not in ("login", "status", "logout"):
        raise SafeError("invalid_input")
    if operation == "login" and not sys.stdin.isatty():
        raise SafeError("invalid_input")
    try:
        with locked_store(store, create=operation == "login") as root:
            token = root / TOKEN_NAME
            if operation == "logout":
                if private_file(token, missing_ok=True):
                    token.unlink()
                return {"localSessionRemoved": True, "remoteRevoked": False}
            if operation == "status":
                if not private_file(token, missing_ok=True):
                    return {"localSessionPresent": False, "remoteValidityChecked": False}
                try:
                    with quiet_library():
                        from garminconnect.client import Client
                        client = Client()
                        client.load(str(root))
                    valid = bool(client.di_token and client.di_refresh_token and client.di_client_id)
                except Exception:
                    valid = False
                return {"localSessionPresent": valid, "remoteValidityChecked": False}
            email = getpass.getpass("Garmin email (hidden): ")
            password = getpass.getpass("Garmin password: ")
            with quiet_library():
                from garminconnect import Garmin
                garmin = Garmin(email, password, prompt_mfa=lambda: getpass.getpass("Garmin MFA code: "), retry_attempts=0)
                try:
                    # Full native strategy chain runs once; don't infer failure from intermediate warnings.
                    garmin.login(tokenstore=str(root))
                except Exception:
                    raise SafeError("auth_failed") from None
                finally:
                    password = None
                    email = None
                persist(garmin.client, root)
            return {"localSessionSaved": True}
    except SafeError as error:
        if error.code == "auth_required" and operation in ("status", "logout"):
            return {"localSessionPresent": False, "remoteValidityChecked": False} if operation == "status" else {"localSessionRemoved": True, "remoteRevoked": False}
        raise


def main():
    os.environ.pop("GARMINTOKENS", None)
    try:
        if len(sys.argv) != 3:
            raise SafeError("invalid_input")
        print(json.dumps(auth(sys.argv[1], sys.argv[2])))
    except SafeError as error:
        print(f"{error.code}: {MESSAGES.get(error.code, MESSAGES['auth_failed'])}", file=sys.stderr)
        return 1
    except (Exception, KeyboardInterrupt):
        print(MESSAGES["auth_failed"], file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
