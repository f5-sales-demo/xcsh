"""Capture executable and dependency provenance without environment or credentials."""

import hashlib
import json
import os
import platform
import shutil
import subprocess
from pathlib import Path


def command(argv: list[str]) -> str:
    """Read fixed version or package inventory commands during image assembly."""
    return subprocess.check_output(  # noqa: S603 - fixed build inventory commands.
        argv,
        text=True,
        stderr=subprocess.DEVNULL,
    ).strip()


versions = {}
for executable, arguments in {
    "bash": ["--version"],
    "curl": ["--version"],
    "git": ["--version"],
    "jq": ["--version"],
    "rg": ["--version"],
    "gh": ["--version"],
    "glab": ["--version"],
    "aws": ["--version"],
    "az": ["version"],
    "gcloud": ["--version"],
    "sf": ["--version"],
    "terraform": ["version", "-json"],
    "ssh": ["-V"],
    "bun": ["--version"],
    "node": ["--version"],
    "python3": ["--version"],
    "chromium": ["--version"],
    "xcsh": ["--version"],
}.items():
    path = shutil.which(executable)
    if not path:
        raise RuntimeError("Required executable missing: " + executable)
    version = subprocess.run(  # noqa: S603 - executable resolved from the fixed inventory below.
        [path, *arguments], text=True, capture_output=True, check=False
    )
    if version.returncode:
        msg = executable + " version probe failed: " + version.stderr.strip()
        raise RuntimeError(msg)
    versions[executable] = {
        "version": (version.stdout or version.stderr).strip(),
        "path": path,
        "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest(),
    }
manifest = {
    "schemaVersion": 1,
    "architecture": platform.machine(),
    "sourceCommit": os.environ.get("XCSH_BUILD_COMMIT", ""),
    "version": versions["xcsh"]["version"],
    "executables": versions,
    "downloads": {
        **json.loads(Path("/opt/xcsh/download-checksums.json").read_text()),
        **json.loads(Path("/opt/xcsh/base-download-checksums.json").read_text()),
    },
    "plugins": json.loads(Path("/opt/xcsh/plugin-manifest.json").read_text()),
    "azureExtensions": json.loads(
        subprocess.check_output(
            ["/opt/cloud-cli/bin/az", "extension", "list", "--output", "json"],
            env={
                **os.environ,
                "AZURE_EXTENSION_DIR": "/opt/xcsh/seed/azure-extensions",
            },
            text=True,
            stderr=subprocess.DEVNULL,
        )
    ),
    "azurePython": command(["/opt/cloud-cli/bin/pip", "freeze"]),
    "managedPython": command(["/opt/xcsh/python-env/bin/pip", "freeze"]),
    "osPackages": command(["dpkg-query", "-W"])
    if shutil.which("dpkg-query")
    else command(["apk", "info", "-v"]),
}
Path("/opt/xcsh/build-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
