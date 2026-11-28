"""Payload trust checks use system Python and reject changed code or missing tickets."""

# Standard-library unittest keeps this verification test dependency-free.
# ruff: noqa: PT009, PT027
import hashlib
import importlib.util
import json
import plistlib
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "mac_app_payload", ROOT / "scripts/verify_macos_app_payload.py"
)
assert SPEC is not None
assert SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class MacAppPayloadTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        info = {
            "CFBundleIdentifier": "com.f5.xcsh",
            "CFBundlePackageType": "APPL",
            "CFBundleExecutable": "xcsh-darwin-arm64",
            "CFBundleVersion": "25.2.4",
            "CFBundleShortVersionString": "25.2.4",
        }
        app = self.root / "xcsh.app/Contents"
        (app / "MacOS").mkdir(parents=True)
        (app / "libexec").mkdir()
        (app / "Info.plist").write_bytes(plistlib.dumps(info))
        (self.root / "provenance").mkdir()
        self.files = []
        for role, name, directory in [
            ("cli", "xcsh-darwin-arm64", "MacOS"),
            ("native-addon", "pi_natives.darwin-arm64.node", "libexec"),
        ]:
            data = ("synthetic " + name).encode()
            (app / directory / name).write_bytes(data)
            signature = {
                "authority": "Developer ID Application",
                "teamIdentifier": MODULE.TEAM,
                "hardenedRuntime": True,
                "trustedTimestamp": True,
                "notarized": True,
                "entitlements": MODULE.ENTITLEMENTS if role == "cli" else [],
                "architectures": ["arm64"],
            }
            self.files.append(
                {
                    "name": name,
                    "role": role,
                    "size": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "signature": signature,
                }
            )
        (self.root / "provenance/manifest.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "arch": "arm64",
                    "version": "25.2.4",
                    "teamIdentifier": MODULE.TEAM,
                    "files": self.files,
                }
            )
        )

    @staticmethod
    def command(args):
        if args[0] == "spctl":
            return "accepted\nsource=Notarized Developer ID\n"
        if args[0] == "lipo":
            return "arm64"
        if "--entitlements" in args:
            names = (
                MODULE.ENTITLEMENTS if args[-1].endswith("xcsh-darwin-arm64") else []
            )
            return "".join("<key>" + key + "</key>" for key in names)
        if args[0] == "codesign" and "--display" in args:
            return "Authority=Developer ID Application: Synthetic\nTeamIdentifier=97ZYL78T5F\nflags=0x10000(runtime)\nTimestamp=Nov 28 2026\n"
        return ""

    def test_accepts_exact_signed_payload(self):
        with patch.object(MODULE, "command", self.command):
            self.assertEqual(
                MODULE.verify(self.root, "arm64")["signedFilesVerified"], 2
            )

    def test_rejects_tampered_code(self):
        (self.root / "xcsh.app/Contents/MacOS/xcsh-darwin-arm64").write_text("tampered")
        with (
            patch.object(MODULE, "command", self.command),
            self.assertRaisesRegex(RuntimeError, "hash mismatch"),
        ):
            MODULE.verify(self.root, "arm64")

    def test_rejects_missing_stapled_ticket(self):
        def missing(args):
            if args[0] == "xcrun":
                message = "ticket missing"
                raise RuntimeError(message)
            return self.command(args)

        with (
            patch.object(MODULE, "command", missing),
            self.assertRaisesRegex(RuntimeError, "ticket missing"),
        ):
            MODULE.verify(self.root, "arm64")

    def test_rejects_missing_signer_identifier(self):
        def missing(args):
            return self.command(args).replace("TeamIdentifier=97ZYL78T5F\n", "")

        with (
            patch.object(MODULE, "command", missing),
            self.assertRaisesRegex(RuntimeError, "signer identifier missing"),
        ):
            MODULE.verify(self.root, "arm64")

    def test_rejects_foreign_signer(self):
        def foreign(args):
            return self.command(args).replace(
                "TeamIdentifier=97ZYL78T5F", "TeamIdentifier=WRONGTEAM"
            )

        with (
            patch.object(MODULE, "command", foreign),
            self.assertRaisesRegex(RuntimeError, "signer mismatch"),
        ):
            MODULE.verify(self.root, "arm64")
