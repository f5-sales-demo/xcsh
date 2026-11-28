#!/usr/bin/env python3
"""Verify the signed app payload using system tools available to a standard account."""

from __future__ import annotations

import argparse
import hashlib
import json
import plistlib
import re
import subprocess
from pathlib import Path
from typing import NoReturn

TEAM = "97ZYL78T5F"
ENTITLEMENTS = [
    "com.apple.security.cs.allow-jit",
    "com.apple.security.cs.allow-unsigned-executable-memory",
]


def fail(message: str) -> NoReturn:
    """Reject a distribution whose trust or payload evidence is invalid."""
    raise RuntimeError(message)


def command(arguments: list[str]) -> str:
    """Run an allowlisted macOS system verifier with exact arguments."""
    tools = {
        "codesign": "/usr/bin/codesign",
        "spctl": "/usr/sbin/spctl",
        "xcrun": "/usr/bin/xcrun",
        "lipo": "/usr/bin/lipo",
    }
    if not arguments or arguments[0] not in tools:
        fail("Unexpected signature verification command")
    arguments = [tools[arguments[0]], *arguments[1:]]
    result = subprocess.run(  # noqa: S603 - fixed allowlisted macOS system verifier argv
        arguments, capture_output=True, text=True, timeout=60, check=False
    )
    if result.returncode:
        fail("Signature command failed: " + arguments[0] + "\n" + result.stderr)
    return result.stdout + result.stderr


def verify(root: Path, arch: str) -> dict[str, str | int | bool]:
    """Verify the app ticket, identity, each signed code file and its closed inventory."""
    app = root / "xcsh.app"
    command(["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(app)])
    assessment = command(
        ["spctl", "--assess", "--verbose=4", "--type", "execute", str(app)]
    )
    if "source=Notarized Developer ID" not in assessment:
        fail("App is not assessed as Notarized Developer ID")
    command(["xcrun", "stapler", "validate", str(app)])
    manifest = json.loads((root / "provenance/manifest.json").read_text())
    if (
        manifest["schemaVersion"] != 1
        or manifest["teamIdentifier"] != TEAM
        or manifest["arch"] != arch
    ):
        fail("App manifest identity mismatch")
    version = manifest["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        fail("Invalid app version")
    expected_names = ["xcsh-darwin-" + arch] + (
        ["pi_natives.darwin-arm64.node"]
        if arch == "arm64"
        else [
            "pi_natives.darwin-x64-baseline.node",
            "pi_natives.darwin-x64-modern.node",
        ]
    )
    if [f["name"] for f in manifest["files"]] != expected_names:
        fail("App payload inventory mismatch")
    with (app / "Contents/Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    if (
        info["CFBundleIdentifier"],
        info["CFBundlePackageType"],
        info["CFBundleExecutable"],
        info["CFBundleVersion"],
        info["CFBundleShortVersionString"],
    ) != ("com.f5.xcsh", "APPL", "xcsh-darwin-" + arch, version, version):
        fail("App bundle identity/version mismatch")
    expected = {"provenance/manifest.json"}
    for entry in manifest["files"]:
        role = "cli" if entry["name"].startswith("xcsh-darwin-") else "native-addon"
        if entry["role"] != role:
            fail("App payload role mismatch")
        relative = (
            Path("xcsh.app/Contents")
            / ("MacOS" if role == "cli" else "libexec")
            / entry["name"]
        )
        target = root / relative
        if target.is_symlink() or not target.is_file():
            fail("App code must be a regular file")
        data = target.read_bytes()
        if (
            len(data) != entry["size"]
            or hashlib.sha256(data).hexdigest() != entry["sha256"]
        ):
            fail("App payload hash mismatch")
        command(
            ["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(target)]
        )
        details = command(["codesign", "--display", "--verbose=4", str(target)])
        entitlements = command(
            ["codesign", "--display", "--entitlements", ":-", str(target)]
        )
        architectures = command(["lipo", "-archs", str(target)]).strip().split()
        actual = {
            "authority": "Developer ID Application"
            if "Authority=Developer ID Application:" in details
            else "unknown",
            "teamIdentifier": re.search(r"^TeamIdentifier=(.+)$", details, re.MULTILINE)
            .group(1)
            .strip(),
            "hardenedRuntime": bool(
                re.search(
                    r"flags=0x[0-9a-f]+\([^)]*runtime[^)]*\)", details, re.IGNORECASE
                )
            ),
            "trustedTimestamp": bool(
                re.search(r"^Timestamp=(?!none\s*$).+", details, re.MULTILINE)
            ),
            "notarized": True,
            "entitlements": sorted(re.findall(r"<key>([^<]+)</key>", entitlements)),
            "architectures": sorted(architectures),
        }
        signature = dict(entry["signature"])
        signature["entitlements"] = sorted(signature["entitlements"])
        signature["architectures"] = sorted(signature["architectures"])
        if (
            actual != signature
            or actual["teamIdentifier"] != TEAM
            or actual["authority"] != "Developer ID Application"
        ):
            fail("App signature changed or signer mismatch")
        if not actual["hardenedRuntime"] or not actual["trustedTimestamp"]:
            fail("App hardened runtime/timestamp missing")
        if actual["entitlements"] != (sorted(ENTITLEMENTS) if role == "cli" else []):
            fail("App entitlement mismatch")
        if architectures != ["arm64" if arch == "arm64" else "x86_64"]:
            fail("App architecture mismatch")
        expected.add(relative.as_posix())
    inventory = ["xcsh.app/Contents/MacOS", "xcsh.app/Contents/libexec", "provenance"]
    actual_files = {
        p.relative_to(root).as_posix()
        for directory in inventory
        for p in (root / directory).rglob("*")
        if p.is_file()
    }
    if actual_files != expected:
        fail("App contains unexpected payload files")
    return {
        "version": version,
        "arch": arch,
        "signedFilesVerified": len(manifest["files"]),
        "stapledAppVerified": True,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--arch", choices=("arm64", "x64"), required=True)
    arguments = parser.parse_args()
    print(json.dumps(verify(arguments.root, arguments.arch)))
