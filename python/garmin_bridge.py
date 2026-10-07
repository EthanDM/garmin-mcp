"""One JSON request per process. The machine allowlist contains only list/get.

Endpoint constants are internal. Auth is a separate operator CLI. Project only
necessary activity fields before crossing into TypeScript; never emit raw GPS,
account objects, dependency errors, or library logs.
"""

import datetime
import json
import math
import os
import re
import sys
from garmin_session import SafeError, locked_store, load_client, persist, quiet_library

LIST_ENDPOINT = "/activitylist-service/activities/search/activities"
METRICS = (
    "distance",
    "duration",
    "movingDuration",
    "elapsedDuration",
    "calories",
    "bmrCalories",
    "averageHR",
    "maxHR",
    "elevationGain",
    "elevationLoss",
)


def validate_request(request):
    """Validate independently of TypeScript so bypassing MCP cannot expand capabilities."""
    if not isinstance(request, dict) or set(request) != {"operation", "input"}:
        raise SafeError("invalid_input")
    operation, args = request["operation"], request["input"]
    if operation not in ("list", "get") or not isinstance(args, dict):
        raise SafeError("invalid_input")
    if operation == "get":
        if (
            set(args) != {"activityId"}
            or not isinstance(args["activityId"], str)
            or not re.fullmatch(r"[1-9][0-9]{0,29}", args["activityId"])
        ):
            raise SafeError("invalid_input")
    else:
        if not set(args).issubset({"limit", "offset", "startDate", "endDate"}) or not {
            "limit",
            "offset",
        }.issubset(args):
            raise SafeError("invalid_input")
        if (
            type(args["limit"]) is not int
            or not 1 <= args["limit"] <= 50
            or type(args["offset"]) is not int
            or not 0 <= args["offset"] <= 10000
        ):
            raise SafeError("invalid_input")
        if ("startDate" in args) != ("endDate" in args):
            raise SafeError("invalid_input")
        if "startDate" in args:
            try:
                dates = []
                for key in ("startDate", "endDate"):
                    if not isinstance(args[key], str) or not re.fullmatch(
                        r"\d{4}-\d{2}-\d{2}", args[key]
                    ):
                        raise ValueError()
                    dates.append(datetime.date.fromisoformat(args[key]))
                delta = (dates[1] - dates[0]).days
                if not 0 <= delta <= 366:
                    raise ValueError()
            except ValueError:
                raise SafeError("invalid_input") from None
    return operation, args


def safe_text(value, max_length):
    """Bound untrusted provider text; never stringify arbitrary provider objects."""
    return value[:max_length] if isinstance(value, str) else None


def project_activity(raw):
    """Whitelist only unit-verified summary fields; preserve exact decimal IDs in Python."""
    if not isinstance(raw, dict):
        raise SafeError("bridge_protocol")
    identity = raw.get("activityId")
    if type(identity) is int:
        identity = str(identity)
    if not isinstance(identity, str) or not re.fullmatch(r"[1-9][0-9]{0,29}", identity):
        raise SafeError("bridge_protocol")
    summary = raw.get("summaryDTO", raw)
    if not isinstance(summary, dict):
        raise SafeError("bridge_protocol")
    sport = raw.get("activityTypeDTO", raw.get("activityType"))
    sport = sport.get("typeKey") if isinstance(sport, dict) else None
    result = {
        "activityId": identity,
        "activityName": safe_text(raw.get("activityName"), 500),
        "activityType": safe_text(sport, 100),
    }
    for key in ("startTimeLocal", "startTimeGMT"):
        result[key] = safe_text(summary.get(key), 40)
    for key in METRICS:
        value = summary.get(key)
        # Invalid numbers retain inconsistency information without echoing arbitrary text.
        if type(value) in (int, float) and math.isfinite(value):
            result[key] = value
        elif value is None:
            result[key] = None
        else:
            result[key] = "invalid"
    return result


def execute(request, store, client_loader=load_client):
    """Perform one bounded read plus necessary token refresh/persistence under one lock."""
    operation, args = validate_request(request)
    with locked_store(store) as root, quiet_library():
        garmin = client_loader(root)
        from garminconnect import (
            GarminConnectAuthenticationError,
            GarminConnectTooManyRequestsError,
            GarminConnectNotFoundError,
        )

        try:
            if operation == "list":
                params = {"start": str(args["offset"]), "limit": str(args["limit"])}
                for key in ("startDate", "endDate"):
                    if key in args:
                        params[key] = args[key]
                raw = garmin.connectapi(LIST_ENDPOINT, params=params, timeout=15)
                if not isinstance(raw, list) or len(raw) > args["limit"]:
                    raise SafeError("bridge_protocol")
                data = [project_activity(item) for item in raw]
            else:
                raw = garmin.get_activity(args["activityId"])
                data = project_activity(raw)
                if data["activityId"] != args["activityId"]:
                    raise SafeError("bridge_protocol")
        except GarminConnectAuthenticationError:
            raise SafeError("auth_required") from None
        except GarminConnectTooManyRequestsError:
            raise SafeError("rate_limited") from None
        except GarminConnectNotFoundError:
            raise SafeError("activity_not_found") from None
        finally:
            # A 401 can rotate tokens even when its subsequent read fails.
            persist(garmin.client, root)
        return data


def main():
    """Stdout contains exactly one allowlisted envelope, even on dependency failure."""
    os.environ.pop("GARMINTOKENS", None)
    try:
        if len(sys.argv) != 2:
            raise SafeError("invalid_input")
        payload = sys.stdin.buffer.read(4097)
        if len(payload) > 4096:
            raise SafeError("invalid_input")
        try:
            request = json.loads(payload)
        except (ValueError, UnicodeError):
            raise SafeError("invalid_input") from None
        data = execute(request, sys.argv[1])
        response = {"ok": True, "data": data}
    except SafeError as error:
        response = {"ok": False, "code": error.code}
    except Exception:
        response = {"ok": False, "code": "request_failed"}
    sys.stdout.write(
        json.dumps(response, allow_nan=False, separators=(",", ":")) + "\n"
    )


if __name__ == "__main__":
    main()
