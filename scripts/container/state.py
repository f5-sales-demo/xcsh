"""Publish a complete first-launch seed under a cross-process lock."""

import fcntl
import os
import shutil
import sys
import tempfile
from pathlib import Path

PORTABLE_ARGUMENTS = 3


def seed_state(home: str | Path, seed: str | Path) -> None:
    """Seed an empty private home without replacing prior user decisions."""
    home, seed = Path(home), Path(seed)
    home.mkdir(parents=True, exist_ok=True)
    with (home / ".xcsh-container.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        target = home / ".xcsh"
        if target.is_symlink():
            msg = "Container state must be a container-owned directory"
            raise ValueError(msg)
        if target.exists() and any(target.iterdir()):
            return
        staging = Path(tempfile.mkdtemp(prefix=".xcsh-seed-", dir=home))
        try:
            shutil.copytree(seed, staging, dirs_exist_ok=True, symlinks=True)
            (staging / "agent").mkdir(exist_ok=True)
            (staging / ".container-seeded").write_text("1\n")
            staging.chmod(0o700)
            if target.exists():
                target.rmdir()
            staging.rename(target)
        finally:
            if staging.exists():
                shutil.rmtree(staging)


def import_portable(
    home: str | Path, source: str | Path, destination: str | Path
) -> None:
    """Copy a requested portable configuration once under the state lock."""
    home, source, destination = Path(home), Path(source), Path(destination)
    if not source.is_dir() or not any(source.iterdir()):
        return
    with (home / ".xcsh-container.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if destination.exists():
            return
        destination.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(
            tempfile.mkdtemp(prefix=".credential-import-", dir=destination.parent)
        )
        try:
            shutil.copytree(
                source,
                staging,
                dirs_exist_ok=True,
                symlinks=True,
                ignore=shutil.ignore_patterns(
                    "virtenv", "__pycache__", "logs", "telemetry", ".cache"
                ),
            )
            for path in staging.rglob("*"):
                if path.is_symlink():
                    continue
                path.chmod(0o700 if path.is_dir() else 0o600)
            staging.chmod(0o700)
            staging.rename(destination)
        finally:
            if staging.exists():
                shutil.rmtree(staging)


if __name__ == "__main__":
    os.umask(0o077)
    if len(sys.argv) == PORTABLE_ARGUMENTS:
        import_portable(os.environ["HOME"], sys.argv[1], sys.argv[2])
    else:
        seed_state(os.environ["HOME"], "/opt/xcsh/seed")
