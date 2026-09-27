from __future__ import annotations

# ruff: noqa: PT009, S603
import json
import subprocess
import sys
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / ".github" / "ts-test-shards.json"

EXPECTED = {
    "native-independent": {
        "@f5-sales-demo/pi-ai",
        "@f5-sales-demo/pi-agent-core",
        "@f5-sales-demo/xcsh-chat-ui",
        "@f5-sales-demo/xcsh-office-pane",
        "@f5-sales-demo/pi-resource-management",
        "@f5-sales-demo/xcsh-stats",
        "@f5-sales-demo/typescript-edit-benchmark",
        "@f5-sales-demo/pi-utils",
    },
    "native-dependent": {
        "@f5-sales-demo/pi-natives",
        "@f5-sales-demo/pi-tui",
        "@f5-sales-demo/xcsh",
    },
}


class TypeScriptTestShardTests(unittest.TestCase):
    def test_manifest_matches_the_dependency_boundary(self) -> None:
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual(manifest["schema_version"], 1)
        self.assertEqual(set(manifest["shards"]), set(EXPECTED))
        for shard, packages in EXPECTED.items():
            self.assertEqual(set(manifest["shards"][shard]), packages)

    def test_every_test_workspace_is_classified_once(self) -> None:
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        classified = [
            package for packages in manifest["shards"].values() for package in packages
        ]
        self.assertEqual(
            [name for name, count in Counter(classified).items() if count != 1], []
        )

        discovered = set()
        for package_json in (ROOT / "packages").glob("*/package.json"):
            package = json.loads(package_json.read_text(encoding="utf-8"))
            if isinstance(package.get("scripts", {}).get("test"), str):
                discovered.add(package["name"])
        self.assertEqual(set(classified), discovered)

    def test_repository_validator_accepts_the_manifest(self) -> None:
        result = subprocess.run(
            [sys.executable, "scripts/validate_ts_test_shards.py"],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("validated 11 TypeScript test workspaces", result.stdout)


if __name__ == "__main__":
    unittest.main()
