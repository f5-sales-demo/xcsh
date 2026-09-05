#!/usr/bin/env python3
# ruff: noqa: PT009
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github/workflows"


class CiCapacityContractTests(unittest.TestCase):
    def test_heavy_linux_jobs_use_compute_and_hosted_legs_remain(self) -> None:
        workflow = (WORKFLOWS / "ci.yml").read_text(encoding="utf-8")
        self.assertNotIn("  setup-zig:\n", workflow)
        self.assertNotIn("needs: setup-zig", workflow)
        self.assertGreaterEqual(workflow.count('"runner":"xcsh-compute"'), 3)
        for job in ("test", "build-release"):
            block = workflow.split(f"  {job}:\n", 1)[1][:800]
            self.assertIn("runs-on: xcsh-compute", block)
        self.assertIn('"os":"macos-14"', workflow)
        self.assertIn('"os":"windows-latest"', workflow)
        self.assertIn('run: test "$(zig version)" = 0.15.2', workflow)

    def test_self_hosted_jobs_verify_baked_bun(self) -> None:
        ci = (WORKFLOWS / "ci.yml").read_text(encoding="utf-8")
        self.assertIn("Verify baked Bun 1.3.14", ci)
        for block in re.findall(
            r"      - name: Setup Bun 1\.3\.14\n(?:        .*\n){1,9}", ci
        ):
            self.assertIn("runner.environment != 'self-hosted'", block)
        compatibility = (WORKFLOWS / "arc-compatibility.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("runs-on: xcsh-compute", compatibility)
        self.assertIn("Verify baked Bun 1.3.14", compatibility)
        self.assertNotIn("oven-sh/setup-bun", compatibility)
        tag = (WORKFLOWS / "tag-on-version-bump.yml").read_text(encoding="utf-8")
        self.assertIn("Verify baked Bun 1.3.14", tag)
        self.assertNotIn("oven-sh/setup-bun", tag)

    def test_installs_and_cache_keys_are_bounded_and_immutable(self) -> None:
        workflows = "\n".join(
            path.read_text(encoding="utf-8")
            for path in WORKFLOWS.glob("*.yml")
            if path.name != "compute-benchmark.yml"
        )
        self.assertNotIn("bun install --frozen-lockfile", workflows)
        benchmark = (WORKFLOWS / "compute-benchmark.yml").read_text(encoding="utf-8")
        self.assertIn('--concurrent-scripts "$CONCURRENT_SCRIPTS"', benchmark)
        self.assertIn("  pull_request:\n    types: [labeled]", benchmark)
        benchmark_guard = (
            "github.event_name == 'pull_request' &&\n"
            "      github.event.action == 'labeled' &&\n"
            "      github.event.label.name == 'compute-benchmark-approved' &&\n"
            "      github.event.pull_request.head.repo.full_name == github.repository"
        )
        self.assertEqual(benchmark.count(benchmark_guard), 2)
        self.assertNotIn("/usr/bin/time", benchmark)
        self.assertNotIn('bun-version: "1.3"', workflows)
        self.assertIn("bun-1.3.14-${{ runner.os }}-${{ runner.arch }}", workflows)
        self.assertNotIn("lookup-only:", workflows)
        self.assertIn("actions/cache/restore@", workflows)
        prime = (WORKFLOWS / "dependency-cache-prime.yml").read_text(encoding="utf-8")
        self.assertIn("uses: actions/cache@", prime)
        self.assertNotIn("actions/cache/restore@", prime)
        self.assertNotIn(
            "Swatinem/rust-cache@", (WORKFLOWS / "ci.yml").read_text(encoding="utf-8")
        )
        self.assertIn(
            "key: rust-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('Cargo.lock', 'rust-toolchain.toml') }}",
            prime,
        )
        installer = (ROOT / "scripts/ci-bun-install.sh").read_text(encoding="utf-8")
        self.assertIn("--frozen-lockfile --concurrent-scripts 16", installer)
        self.assertIn('printf \'%s\\n\' "$bun_bin_dir" >>"$GITHUB_PATH"', installer)
        self.assertIn('launcher="packages/coding-agent/bin/xcsh.ts"', installer)
        self.assertIn("mode change 100644 => 100755 $launcher", installer)
        self.assertIn('git -C "$workspace" diff --exit-code', installer)
        package = (ROOT / "packages/coding-agent/package.json").read_text(
            encoding="utf-8"
        )
        self.assertIn("--max-concurrency 1", package)

    def test_cache_smoke_is_path_scoped_or_manual(self) -> None:
        smoke = (WORKFLOWS / "self-hosted-runner-cache-smoke.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("workflow_dispatch:", smoke)
        self.assertIn("    paths:\n", smoke)
        self.assertIn("scripts/ci-bun-install.sh", smoke)


if __name__ == "__main__":
    unittest.main()
