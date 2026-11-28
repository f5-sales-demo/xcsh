"""Keep the qualified current POSIX dependency graph current and warning-free."""

import tomllib
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NativeCurrentDependencyContracts(unittest.TestCase):
    def test_all_vendored_posix_owners_request_current_nix(self):
        for name in (
            "brush-core-vendored",
            "brush-builtins-vendored",
            "portable-pty-vendored",
        ):
            with self.subTest(crate=name):
                manifest = tomllib.loads(
                    (ROOT / "crates" / name / "Cargo.toml").read_text()
                )
                dependency = manifest.get("dependencies", {}).get("nix")
                if dependency is None:
                    dependency = manifest["target"]["cfg(unix)"]["dependencies"]["nix"]
                assert dependency["version"] == "0.32.0"

    def test_resolved_graph_has_current_owned_and_compatible_upstream_nix(self):
        packages = tomllib.loads((ROOT / "Cargo.lock").read_text())["package"]
        versions = {p["version"] for p in packages if p["name"] == "nix"}
        assert "0.32.0" in versions
        assert versions <= {"0.32.0", "0.31.4"}
        # Current upstream command-fds and uucore require ^0.31.2/^0.31.3.
        # Only those verified current parents may retain latest-compatible 0.31.4.
        parents = {"command-fds": "0.3.3", "uucore": "0.13.0"}
        for package in packages:
            if "nix 0.31.4" in package.get("dependencies", []):
                assert package["name"] in parents
                assert package["version"] == parents[package["name"]]
        assert [p["version"] for p in packages if p["name"] == "cfg_aliases"] == [
            "0.2.2"
        ]

    def test_fd_mapping_and_formatting_owners_request_current_releases(self):
        core = tomllib.loads(
            (ROOT / "crates/brush-core-vendored/Cargo.toml").read_text()
        )
        builtins = tomllib.loads(
            (ROOT / "crates/brush-builtins-vendored/Cargo.toml").read_text()
        )
        assert (
            core["target"]["cfg(unix)"]["dependencies"]["command-fds"]["version"]
            == "0.3.3"
        )
        assert (
            builtins["target"]["cfg(any(unix, windows))"]["dependencies"]["uucore"][
                "version"
            ]
            == "0.13.0"
        )


if __name__ == "__main__":
    unittest.main()
