"""Test-only repository view for private fixtures inside the verifier worktree."""

from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch


@contextmanager
def synthetic_repository_ancestry(fixture):
    """Hide only repository ancestry outside this fixture; retain real safety checks.

    Factory only permits writes inside Git. Synthetic stores therefore need an
    isolated repository view, but .git markers inside each fixture remain real.
    Symlinks, ownership, permissions, file types and locks are never mocked.
    """
    original_exists = Path.exists

    def exists(path, *args, **kwargs):
        if path.name == ".git" and fixture not in path.parents:
            return False
        return original_exists(path, *args, **kwargs)

    with (
        patch("garmin_session.PROJECT_ROOT", Path("/synthetic-unrelated-project")),
        patch.object(Path, "exists", exists),
    ):
        yield
