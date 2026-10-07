"""Private application-owned session storage and cross-process serialization.

Only operator login may create the store. Reads never attempt credential login.
Pinned native Client APIs own load/dump/refresh; no competing auth protocol.
"""
import contextlib
import fcntl
import json
import logging
import os
from pathlib import Path
import stat
import time

TOKEN_NAME = "garmin_tokens.json"
MARKER_NAME = ".garmin-mcp-store"
MARKER = b"garmin-mcp-session-v1\n"
PROJECT_ROOT = Path(__file__).absolute().parent.parent


class SafeError(Exception):
    """Locally authored error code; never holds raw library diagnostics."""
    def __init__(self, code):
        self.code = code
        super().__init__(code)


@contextlib.contextmanager
def quiet_library():
    """Discard dependency output, including login fallback warnings and errors."""
    previous = logging.root.manager.disable
    logging.disable(logging.CRITICAL)
    try:
        with open(os.devnull, "w") as sink:
            with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
                yield
    finally:
        logging.disable(previous)


def validate_ancestry(root):
    """Reject symlinks and replaceable ancestry; root-owned sticky temp parents are allowed.

    The application store itself must always be private and owned by this uid.
    Repository detection includes any ancestor with a .git entry, not only this checkout.
    """
    if not root.is_absolute() or ".." in root.parts or root == Path("/"):
        raise SafeError("unsafe_store")
    if root == PROJECT_ROOT or PROJECT_ROOT in root.parents:
        raise SafeError("unsafe_store")
    for node in reversed((root, *root.parents)):
        if (node / ".git").exists():
            raise SafeError("unsafe_store")
        try:
            info = node.lstat()
        except FileNotFoundError:
            continue
        if not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, os.getuid()):
            raise SafeError("unsafe_store")
        writable = info.st_mode & 0o022
        trusted_sticky = info.st_uid == 0 and info.st_mode & stat.S_ISVTX
        if writable and not trusted_sticky:
            raise SafeError("unsafe_store")
        if node == root and (info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700):
            raise SafeError("unsafe_store")


def private_file(path, missing_ok=False):
    """Check regular, single-link, user-owned 0600 files before any content read."""
    try:
        info = path.lstat()
    except FileNotFoundError:
        if missing_ok:
            return False
        raise SafeError("auth_required") from None
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1 or info.st_size > 65536:
        raise SafeError("unsafe_store")
    return True


@contextlib.contextmanager
def locked_store(value, create=False, timeout=5):
    """Lock the directory inode for all auth and refresh operations; never remove it.

    A marker prevents accidental use of another application's token directory.
    Unknown contents are rejected without reading them. No lock-file deletion race.
    """
    root = Path(value)
    validate_ancestry(root)
    if not root.exists():
        if not create:
            raise SafeError("auth_required")
        root.mkdir(mode=0o700, parents=True)
    validate_ancestry(root)
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise SafeError("store_busy") from None
                time.sleep(0.05)
        validate_ancestry(root)
        if os.fstat(fd).st_ino != root.lstat().st_ino:
            raise SafeError("unsafe_store")
        marker = root / MARKER_NAME
        entries = set(os.listdir(root))
        if not entries and create:
            marker_fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(marker_fd, "wb") as handle:
                handle.write(MARKER)
        elif not entries.issubset({MARKER_NAME, TOKEN_NAME}) or MARKER_NAME not in entries:
            raise SafeError("unsafe_store")
        private_file(marker)
        if marker.read_bytes() != MARKER:
            raise SafeError("unsafe_store")
        private_file(root / TOKEN_NAME, missing_ok=True)
        yield root
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def persist(client, root):
    """Explicitly verify persistence because pinned login/refresh suppress dump failures."""
    try:
        # Only DI tokens have a resumable on-disk representation in 0.3.17.
        if not client.di_token or not client.di_refresh_token or not client.di_client_id:
            raise SafeError("persistence_failed")
        client.dump(str(root))
        private_file(root / TOKEN_NAME)
        from garminconnect.client import Client
        saved = Client()
        saved.load(str(root))
        if json.loads(saved.dumps()) != json.loads(client.dumps()):
            raise SafeError("persistence_failed")
    except Exception:
        raise SafeError("persistence_failed") from None


def load_client(root):
    """Restore without profile requests or interactive login; refresh with the native flow."""
    from garminconnect import Garmin
    private_file(root / TOKEN_NAME)
    garmin = Garmin(retry_attempts=0)
    try:
        garmin.client.load(str(root))
        if not garmin.client.di_refresh_token or not garmin.client.di_client_id:
            raise SafeError("auth_required")
        if garmin.client._token_expires_soon():
            garmin.client._refresh_session()
            if garmin.client._token_expires_soon():
                raise SafeError("auth_required")
    except Exception:
        raise SafeError("auth_required") from None
    persist(garmin.client, root)
    return garmin
