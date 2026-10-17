"""Run the local ShellCheck and shfmt gates on tracked or staged shell sources."""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def main() -> int:
    """Fail closed when a shell gate is missing or reports a finding."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged", action="store_true")
    options = parser.parse_args()
    argv = (
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
        if options.staged
        else ["git", "ls-files", "-z"]
    )
    paths = subprocess.check_output(argv).decode().split("\0")  # noqa: S603 - fixed Git inventory command.
    files = []
    for value in paths:
        path = Path(value)
        if not value or not path.is_file():
            continue
        if value.endswith(".sh") or path.read_bytes()[:64].startswith(
            (b"#!/bin/sh", b"#!/usr/bin/env bash", b"#!/bin/bash")
        ):
            files.append(value)
    if not files:
        return 0
    for executable in ("shellcheck", "shfmt"):
        if not shutil.which(executable):
            print(
                f"ERROR: {executable} is required for local shell validation",
                file=sys.stderr,
            )
            return 2
    version = subprocess.check_output(["shfmt", "--version"], text=True).strip()  # noqa: S607 - fixed linter version query.
    if version.lstrip("v") != "3.13.1":
        print("ERROR: shfmt 3.13.1 is required to match CI", file=sys.stderr)
        return 2
    failed = False
    for command in (["shellcheck", "-e", "SC2016", *files], ["shfmt", "-d", *files]):
        result = subprocess.run(command, check=False)  # noqa: S603 - fixed linters and tracked file arguments.
        failed = failed or result.returncode != 0
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
