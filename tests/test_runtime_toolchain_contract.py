"""Offline contracts for the current source-qualified development toolchain."""

import json
import tomllib
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class RuntimeToolchainContract(unittest.TestCase):
    def test_stable_release_selection_has_no_age_hold(self):
        configs = [
            ROOT / "bunfig.toml",
            *sorted((ROOT / "packages").glob("*/bunfig.toml")),
        ]
        for path in configs:
            with self.subTest(config=str(path.relative_to(ROOT))):
                config = tomllib.loads(path.read_text())
                install = config.get("install", {})
                assert install.get("minimumReleaseAge", 0) == 0
                assert "minimumReleaseAgeExcludes" not in install

    def test_current_runner_bun_matches_the_verified_artifact(self):
        script = (ROOT / "scripts/prepare-runner-optimization-toolchain.sh").read_text()
        assert "readonly BUN_VERSION=1.4.5" in script
        assert (
            "readonly BUN_SHA256=94559b3b528995a49452f9f2404cec74f2efd7d06e0a000a8cd214b02c3666eb"
            in script
        )

    def test_selected_latest_stable_tools(self):
        root = json.loads((ROOT / "package.json").read_text())
        agent = json.loads((ROOT / "packages/coding-agent/package.json").read_text())
        assert root["packageManager"] == "bun@1.4.5"
        assert root["devDependencies"]["@biomejs/biome"] == "2.6.9"
        assert agent["devDependencies"]["@tobilu/qmd"] == "2.9.0"

    def test_all_declared_bun_types_match_the_selected_runtime(self):
        manifests = [
            ROOT / "package.json",
            *sorted((ROOT / "packages").glob("*/package.json")),
        ]
        for manifest in manifests:
            data = json.loads(manifest.read_text())
            for section in ["dependencies", "devDependencies"]:
                types = data.get(section, {}).get("@types/bun")
                if types is not None:
                    with self.subTest(manifest=str(manifest.relative_to(ROOT))):
                        assert types == "1.4.5"

    def test_normal_bootstrap_and_setup_action_select_current_bun(self):
        bootstrap = (ROOT / "scripts/ci-bun-install.sh").read_text()
        assert "expected_bun=${XCSH_EXPECTED_BUN_VERSION:-1.4.5}" in bootstrap
        action = (ROOT / ".github/actions/setup-bun/action.yml").read_text()
        assert 'default: "1.4.5"' in action

    def test_qmd_patch_targets_the_selected_version(self):
        root = json.loads((ROOT / "package.json").read_text())
        agent = json.loads((ROOT / "packages/coding-agent/package.json").read_text())
        qmd = agent["devDependencies"]["@tobilu/qmd"]
        assert qmd == "2.9.0"
        assert "@tobilu/qmd@2.8.3" not in root.get("patchedDependencies", {})
        patch = root.get("patchedDependencies", {}).get("@tobilu/qmd@" + qmd)
        if patch is not None:
            assert (ROOT / patch).is_file()


if __name__ == "__main__":
    unittest.main()
