"""Launch declared qualification commands as literal arguments without a shell."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Any


def command_arguments(
    arguments: object, environment: dict[str, str] | None = None
) -> list[str]:
    """Validate an argument vector and resolve its executable before spawning."""
    if not isinstance(arguments, (list, tuple)) or not arguments:
        message = "A nonempty qualification argument vector is required"
        raise ValueError(message)
    if any(not isinstance(value, (str, os.PathLike)) for value in arguments):
        message = "Qualification arguments must be strings or paths"
        raise TypeError(message)
    values = [os.fspath(value) for value in arguments]
    if any(not isinstance(value, str) or "\0" in value for value in values):
        message = "Qualification arguments must be NUL-free text"
        raise ValueError(message)
    executable = values[0]
    if not Path(executable).is_absolute():
        executable = (
            shutil.which(executable, path=(environment or os.environ).get("PATH")) or ""
        )
    if not executable or not Path(executable).is_file():
        message = "Qualification executable is unavailable"
        raise FileNotFoundError(message)
    values[0] = str(Path(executable).resolve(strict=True))
    return values


def run_command(arguments: object, **options: Any) -> Any:
    """Execute a validated declared command, retaining ordinary subprocess results."""
    if options.get("shell"):
        message = "Qualification commands cannot use shell interpretation"
        raise ValueError(message)
    arguments = command_arguments(arguments, options.get("env"))
    options["shell"] = False
    check = options.pop("check", False)
    # Reviewed execution boundary: argv is validated above; callers freeze candidate/adapter bindings.
    return subprocess.run(arguments, check=check, **options)  # noqa: S603


def command_output(arguments: object, **options: Any) -> Any:
    """Return stdout from a checked command without changing its stderr behavior."""
    options["stdout"] = subprocess.PIPE
    options["check"] = True
    return run_command(arguments, **options).stdout
