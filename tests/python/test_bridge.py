"""Offline tests: synthetic sessions only, real pinned persistence/refresh, mocked HTTP."""

import base64
import contextlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).absolute().parents[2] / "python"))
import garmin_bridge as bridge
import garmin_auth as auth
from garmin_session import (
    SafeError,
    TOKEN_NAME,
    MARKER_NAME,
    locked_store,
    load_client,
    persist,
)
from garminconnect.client import Client
from fixture_store import synthetic_repository_ancestry


def jwt(exp):
    payload = (
        base64.urlsafe_b64encode(
            json.dumps({"exp": exp, "client_id": "synthetic-client"}).encode()
        )
        .decode()
        .rstrip("=")
    )
    header = (
        base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').decode().rstrip("=")
    )
    return header + "." + payload + ".synthetic"


def native_client(exp=None):
    client = Client()
    client.di_token = jwt(exp if exp is not None else time.time() + 7200)
    client.di_refresh_token = "synthetic-refresh"
    client.di_client_id = "synthetic-client"
    return client


class OfflineTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="garmin-mcp-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "session"
        self.ancestry = synthetic_repository_ancestry(Path(self.temp.name))
        self.ancestry.__enter__()
        self.addCleanup(self.ancestry.__exit__, None, None, None)
        # Any accidental live HTTP is an immediate test failure.
        self.network = patch(
            "requests.sessions.Session.request",
            side_effect=AssertionError("network forbidden"),
        )
        self.network_mock = self.network.start()
        self.addCleanup(self.network.stop)
        self.cffi_network = patch(
            "curl_cffi.requests.Session.request",
            side_effect=AssertionError("network forbidden"),
        )
        self.cffi_network_mock = self.cffi_network.start()
        self.addCleanup(self.cffi_network.stop)

    def seed(self, exp=None):
        with locked_store(str(self.root), create=True) as root:
            persist(native_client(exp), root)

    def assert_code(self, code, function, *args, **kwargs):
        with self.assertRaises(SafeError) as caught:
            function(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)


class BridgeTests(OfflineTest):
    def test_allowlist_and_input_bounds(self):
        for operation in ("login", "logout", "delete_activity", "connectapi", "exec"):
            self.assert_code(
                "invalid_input",
                bridge.validate_request,
                {"operation": operation, "input": {}},
            )
        invalid = [
            {"limit": 51, "offset": 0},
            {"limit": True, "offset": 0},
            {"limit": 1, "offset": 10001},
            {"limit": 1, "offset": 0, "endpoint": "/anything"},
            {"limit": 1, "offset": 0, "startDate": "2026-10-06"},
            {
                "limit": 1,
                "offset": 0,
                "startDate": "2026-02-30",
                "endDate": "2026-03-01",
            },
            {
                "limit": 1,
                "offset": 0,
                "startDate": "2026-10-07",
                "endDate": "2026-10-06",
            },
            {
                "limit": 1,
                "offset": 0,
                "startDate": "2020-01-01",
                "endDate": "2026-10-06",
            },
        ]
        for args in invalid:
            self.assert_code(
                "invalid_input",
                bridge.validate_request,
                {"operation": "list", "input": args},
            )
        for identity in (0, "0", "1/../../", "garmin_ping_639161568056", "1e3"):
            self.assert_code(
                "invalid_input",
                bridge.validate_request,
                {"operation": "get", "input": {"activityId": identity}},
            )

    def test_one_fixed_list_request_and_safe_projection(self):
        self.seed()
        garmin = Mock()
        garmin.client = native_client()
        garmin.connectapi.return_value = [
            {
                "activityId": 24634321892,
                "activityName": "Synthetic",
                "activityType": {"typeKey": "running"},
                "calories": 404,
                "bmrCalories": 38,
                "startLatitude": 33,
                "owner": "private",
            }
        ]
        data = bridge.execute(
            {
                "operation": "list",
                "input": {
                    "limit": 1,
                    "offset": 5,
                    "startDate": "2026-10-06",
                    "endDate": "2026-10-06",
                },
            },
            str(self.root),
            lambda _: garmin,
        )
        garmin.connectapi.assert_called_once_with(
            bridge.LIST_ENDPOINT,
            params={
                "start": "5",
                "limit": "1",
                "startDate": "2026-10-06",
                "endDate": "2026-10-06",
            },
            timeout=15,
        )
        self.assertEqual(data[0]["activityId"], "24634321892")
        self.assertEqual(data[0]["calories"], 404)
        self.assertNotIn("startLatitude", data[0])
        self.assertNotIn("private", json.dumps(data))
        garmin.get_activities_by_date.assert_not_called()

    def test_detail_summary_and_large_id_are_lossless(self):
        self.seed()
        garmin = Mock(client=native_client())
        identity = "123456789012345678901234567890"
        garmin.get_activity.return_value = {
            "activityId": int(identity),
            "summaryDTO": {
                "calories": 404,
                "bmrCalories": 38,
                "duration": 1809.35,
                "movingDuration": 1800,
                "elapsedDuration": 1833,
                "startTimeLocal": "2026-10-06T18:13:12.0",
            },
        }
        data = bridge.execute(
            {"operation": "get", "input": {"activityId": identity}},
            str(self.root),
            lambda _: garmin,
        )
        self.assertEqual(data["activityId"], identity)
        self.assertEqual(data["duration"], 1809.35)
        garmin.get_activity.assert_called_once_with(identity)
        garmin.get_activity.return_value["activityId"] = 1
        self.assert_code(
            "bridge_protocol",
            bridge.execute,
            {"operation": "get", "input": {"activityId": identity}},
            str(self.root),
            lambda _: garmin,
        )

    def test_typed_api_failures_are_safe_codes(self):
        from garminconnect import (
            GarminConnectAuthenticationError,
            GarminConnectTooManyRequestsError,
            GarminConnectNotFoundError,
        )

        self.seed()
        for error_type, code in [
            (GarminConnectAuthenticationError, "auth_required"),
            (GarminConnectTooManyRequestsError, "rate_limited"),
            (GarminConnectNotFoundError, "activity_not_found"),
        ]:
            garmin = Mock(client=native_client())
            garmin.get_activity.side_effect = error_type("SECRET")
            self.assert_code(
                code,
                bridge.execute,
                {"operation": "get", "input": {"activityId": "1"}},
                str(self.root),
                lambda _: garmin,
            )

    def test_projection_invalid_numeric_and_no_raw_object_echo(self):
        data = bridge.project_activity(
            {
                "activityId": 1,
                "calories": float("nan"),
                "bmrCalories": "SECRET",
                "activityName": {"token": "SECRET"},
            }
        )
        self.assertEqual(data["calories"], "invalid")
        self.assertEqual(data["bmrCalories"], "invalid")
        self.assertIsNone(data["activityName"])
        self.assertNotIn("SECRET", json.dumps(data))

    def test_stdout_envelope_and_raw_error_redaction(self):
        with (
            patch.object(sys, "argv", ["bridge", str(self.root)]),
            patch.object(
                sys,
                "stdin",
                Mock(
                    buffer=io.BytesIO(b'{"operation":"get","input":{"activityId":"1"}}')
                ),
            ),
            patch.object(bridge, "execute", side_effect=RuntimeError("token SECRET")),
        ):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                bridge.main()
            self.assertEqual(
                json.loads(output.getvalue()), {"ok": False, "code": "request_failed"}
            )
            self.assertNotIn("SECRET", output.getvalue())

    def test_real_machine_rejects_auth_and_ignores_inherited_store(self):
        result = subprocess.run(
            [sys.executable, str(Path(bridge.__file__)), str(self.root)],
            input=json.dumps({"operation": "login", "input": {}}),
            text=True,
            capture_output=True,
            env={**os.environ, "GARMINTOKENS": "/never-read/synthetic"},
            timeout=5,
        )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(
            json.loads(result.stdout), {"ok": False, "code": "invalid_input"}
        )
        self.assertEqual(result.stderr, "")
        absent = Path("/private/tmp") / ("garmin-mcp-missing-" + str(uuid.uuid4()))
        result = subprocess.run(
            [sys.executable, str(Path(bridge.__file__)), str(absent)],
            input=json.dumps({"operation": "get", "input": {"activityId": "1"}}),
            text=True,
            capture_output=True,
            env={**os.environ, "GARMINTOKENS": "/never-read/synthetic"},
            timeout=5,
        )
        self.assertEqual(
            json.loads(result.stdout), {"ok": False, "code": "auth_required"}
        )
        self.assertEqual(result.stderr, "")
        result = subprocess.run(
            [sys.executable, str(Path(bridge.__file__)), str(self.root)],
            input="x" * 4097,
            text=True,
            capture_output=True,
            timeout=5,
        )
        self.assertEqual(json.loads(result.stdout)["code"], "invalid_input")


class RepositoryBoundaryTests(unittest.TestCase):
    def test_actual_checkout_ancestry_is_rejected_without_fixture_mocks(self):
        from garmin_session import validate_ancestry

        root = Path(bridge.__file__).absolute().parent.parent / "synthetic-store"
        with self.assertRaises(SafeError) as caught:
            validate_ancestry(root)
        self.assertEqual(caught.exception.code, "unsafe_store")
        # Also cover the filesystem .git check independently of PROJECT_ROOT.
        with patch("garmin_session.PROJECT_ROOT", Path("/synthetic-unrelated-project")):
            with self.assertRaises(SafeError) as caught:
                validate_ancestry(root)
        self.assertEqual(caught.exception.code, "unsafe_store")


class SessionTests(OfflineTest):
    def test_network_guards_cover_both_native_transports(self):
        import requests
        from curl_cffi import requests as cffi_requests

        for session in (requests.Session(), cffi_requests.Session()):
            with self.assertRaisesRegex(AssertionError, "network forbidden"):
                session.request("GET", "https://offline.invalid")
            session.close()

    def test_real_pinned_load_dump_permissions_and_missing_auth(self):
        self.assert_code("auth_required", load_client, self.root)
        self.seed()
        with locked_store(str(self.root)) as root:
            restored = load_client(root)
        self.assertEqual(restored.client.di_refresh_token, "synthetic-refresh")
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((self.root / TOKEN_NAME).stat().st_mode), 0o600)
        self.network_mock.assert_not_called()

    def test_real_pinned_proactive_refresh_and_rotation_are_persisted(self):
        self.seed(time.time() - 3600)
        response = Mock(ok=True)
        response.json.return_value = {
            "access_token": jwt(time.time() + 7200),
            "refresh_token": "synthetic-rotated",
        }
        with patch.object(Client, "_http_post", return_value=response) as refresh:
            with locked_store(str(self.root)) as root:
                restored = load_client(root)
        self.assertEqual(restored.client.di_refresh_token, "synthetic-rotated")
        refresh.assert_called_once()
        check = Client()
        check.load(str(self.root))
        self.assertEqual(check.di_refresh_token, "synthetic-rotated")

    def test_real_pinned_401_refresh_retries_only_read_then_persists(self):
        self.seed()
        with locked_store(str(self.root)) as root:
            garmin = load_client(root)
            fail = Mock(status_code=401)
            success = Mock(status_code=200)
            success.json.return_value = {"activityId": 1}
            refreshed = Mock(ok=True)
            refreshed.json.return_value = {
                "access_token": jwt(time.time() + 7200),
                "refresh_token": "synthetic-after-401",
            }
            with (
                patch.object(
                    garmin.client._api_session, "request", side_effect=[fail, success]
                ) as request,
                patch.object(garmin.client, "_http_post", return_value=refreshed),
            ):
                result = garmin.get_activity("1")
                persist(garmin.client, root)
            self.assertEqual(result, {"activityId": 1})
            self.assertEqual(request.call_count, 2)
            self.assertTrue(
                all(call.args[0] == "GET" for call in request.call_args_list)
            )
        check = Client()
        check.load(str(self.root))
        self.assertEqual(check.di_refresh_token, "synthetic-after-401")

    def test_failed_refresh_is_auth_required_and_no_credential_fallback(self):
        self.seed(time.time() - 3600)
        response = Mock(ok=False, status_code=401, text="SECRET")
        with (
            patch.object(Client, "_http_post", return_value=response),
            patch.object(
                Client,
                "login",
                side_effect=AssertionError("credential login forbidden"),
            ),
        ):
            with locked_store(str(self.root)) as root:
                self.assert_code("auth_required", load_client, root)

    def test_invalid_saved_state_and_explicit_persistence_failure(self):
        self.seed()
        (self.root / TOKEN_NAME).write_text("not json SECRET")
        with locked_store(str(self.root)) as root:
            self.assert_code("auth_required", load_client, root)
            client = native_client()
            with patch.object(client, "dump", side_effect=OSError("SECRET")):
                self.assert_code("persistence_failed", persist, client, root)
            client.di_refresh_token = None
            self.assert_code("persistence_failed", persist, client, root)

    def test_unsafe_stores_symlinks_shared_foreign_hardlinks_and_repositories(self):
        self.seed()
        self.root.chmod(0o755)
        self.assert_code(
            "unsafe_store", lambda: locked_store(str(self.root)).__enter__()
        )
        self.root.chmod(0o700)
        token = self.root / TOKEN_NAME
        token.chmod(0o644)
        self.assert_code(
            "unsafe_store", lambda: locked_store(str(self.root)).__enter__()
        )
        token.chmod(0o600)
        link = Path(self.temp.name) / "linked"
        link.symlink_to(self.root)
        self.assert_code("unsafe_store", lambda: locked_store(str(link)).__enter__())
        os.link(token, Path(self.temp.name) / "hardlink")
        self.assert_code(
            "unsafe_store", lambda: locked_store(str(self.root)).__enter__()
        )
        (Path(self.temp.name) / "hardlink").unlink()
        with patch("garmin_session.os.getuid", return_value=os.getuid() + 1):
            self.assert_code(
                "unsafe_store", lambda: locked_store(str(self.root)).__enter__()
            )
        token.unlink()
        token.symlink_to(Path(self.temp.name) / "never-read")
        self.assert_code(
            "unsafe_store", lambda: locked_store(str(self.root)).__enter__()
        )
        token.unlink()
        (Path(self.temp.name) / ".git").mkdir()
        self.assert_code(
            "unsafe_store", lambda: locked_store(str(self.root)).__enter__()
        )

    def test_other_app_directory_is_never_read_or_overwritten(self):
        self.root.mkdir(mode=0o700)
        token = self.root / TOKEN_NAME
        token.write_text("other-app-synthetic")
        token.chmod(0o600)
        self.assert_code(
            "unsafe_store",
            lambda: locked_store(str(self.root), create=True).__enter__(),
        )
        self.assertEqual(token.read_text(), "other-app-synthetic")

    def test_cross_process_lock_and_release(self):
        self.seed()
        # The child uses the same test-only ancestry view, while flock stays real.
        script = "import sys;from pathlib import Path;sys.path.insert(0,sys.argv[1]);sys.path.insert(0,sys.argv[3]);from garmin_session import locked_store,SafeError;from fixture_store import synthetic_repository_ancestry\nwith synthetic_repository_ancestry(Path(sys.argv[2]).parent):\n try:\n  with locked_store(sys.argv[2],timeout=0.1): print('acquired')\n except SafeError as e: print(e.code)"
        with locked_store(str(self.root)):
            result = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    script,
                    str(Path(bridge.__file__).parent),
                    str(self.root),
                    str(Path(__file__).parent),
                ],
                capture_output=True,
                text=True,
                timeout=5,
            )
        self.assertEqual(result.stdout.strip(), "store_busy")
        with locked_store(str(self.root)):
            pass

    def test_status_logout_and_interactive_login_verified_persistence(self):
        self.assertFalse(auth.auth("status", str(self.root))["localSessionPresent"])
        self.seed()
        self.assertTrue(auth.auth("status", str(self.root))["localSessionPresent"])
        garmin = Mock(client=native_client())
        # Pinned Garmin.login may swallow its own dump failure. Our explicit persist must fail safely.
        garmin.login.return_value = (None, None)
        with (
            patch.object(sys.stdin, "isatty", return_value=True),
            patch("getpass.getpass", return_value="synthetic-input"),
            patch("garminconnect.Garmin", return_value=garmin),
        ):
            self.assertTrue(auth.auth("login", str(self.root))["localSessionSaved"])
            garmin.login.assert_called_once_with(tokenstore=str(self.root))
            with patch.object(garmin.client, "dump", side_effect=OSError("SECRET")):
                self.assert_code(
                    "persistence_failed", auth.auth, "login", str(self.root)
                )
        self.assertFalse(auth.auth("logout", str(self.root))["remoteRevoked"])
        self.assertFalse((self.root / TOKEN_NAME).exists())
        self.assertTrue((self.root / MARKER_NAME).exists())
        self.assertFalse(auth.auth("status", str(self.root))["localSessionPresent"])
        self.network_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
