#!/usr/bin/env python3
# ruff: noqa: PT009
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github/workflows"


class CiCapacityContractTests(unittest.TestCase):
    def test_ci_builds_linux_natives_once_and_aggregates_test_shards(self) -> None:
        workflow = (WORKFLOWS / "ci.yml").read_text(encoding="utf-8")
        self.assertIn("  native-linux-x64:\n", workflow)
        self.assertIn("TARGET_VARIANTS: baseline modern", workflow)
        self.assertIn("native-manifest.json", workflow)
        self.assertIn(
            'ci-native-manifest.ts create --source-sha "$GITHUB_SHA"', workflow
        )
        self.assertIn("  test-rust:\n", workflow)
        self.assertIn("  test-typescript:\n", workflow)
        self.assertIn("    needs: native-linux-x64\n", workflow)
        self.assertIn("    needs: [test-typescript, test-rust]\n", workflow)
        self.assertIn("bun scripts/ci-native-manifest.ts verify", workflow)
        self.assertIn('XCSH_TEST_FILE_WORKERS: "0"', workflow)
        for platform in (
            '"platform":"linux","arch":"arm64"',
            '"platform":"win32"',
            '"platform":"darwin"',
        ):
            self.assertIn(platform, workflow)

    def test_self_hosted_linux_setup_is_verification_only(self) -> None:
        ci = (WORKFLOWS / "ci.yml").read_text(encoding="utf-8")
        setup_bun = (ROOT / ".github/actions/setup-bun/action.yml").read_text(
            encoding="utf-8"
        )
        setup_rust = (ROOT / ".github/actions/setup-rust/action.yml").read_text(
            encoding="utf-8"
        )
        setup_zig = (ROOT / ".github/actions/setup-zig/action.yml").read_text(
            encoding="utf-8"
        )
        verifier = (ROOT / "scripts/verify-self-hosted-tools.sh").read_text(
            encoding="utf-8"
        )
        self.assertIn("uses: ./.github/actions/setup-bun", ci)
        self.assertNotIn("taiki-e/install-action@", ci)
        self.assertNotIn("sudo apt-get install --yes --no-install-recommends llvm", ci)
        for action in (setup_bun, setup_rust, setup_zig):
            self.assertIn("runner.environment == 'self-hosted'", action)
            self.assertIn("runner.environment != 'self-hosted'", action)
        for expected in (
            "bun --version",
            "zig version",
            "rustup component list --installed",
            "rustup target list --installed",
            "cargo nextest --version",
            "command -v llvm-nm",
            "libcairo2-dev",
            "command -v fd",
            "command -v rg",
        ):
            self.assertIn(expected, verifier)
        self.assertNotIn("rustc --version | grep", verifier)
        self.assertIn("(-x86_64-unknown-linux-gnu)?( |$)", verifier)
        self.assertIn("awk 'NR == 1 {print $2}'", verifier)

    def test_manual_benchmark_is_frozen_and_bounded(self) -> None:
        benchmark = (WORKFLOWS / "compute-benchmark.yml").read_text(encoding="utf-8")
        action = (
            ROOT / ".github/actions/runner-optimization-profile/action.yml"
        ).read_text(encoding="utf-8")
        legacy_setup = (
            ROOT / "scripts/prepare-runner-optimization-toolchain.sh"
        ).read_text(encoding="utf-8")
        runner = (ROOT / "scripts/run-ts-tests.ts").read_text(encoding="utf-8")
        self.assertIn("  workflow_dispatch:\n", benchmark)
        for input_name in ("source_sha", "experiment", "cache_state", "pair_id"):
            self.assertIn(f"      {input_name}:\n", benchmark)
        self.assertIn("68721777f3a2fae473c9ee127539ad7139354040", benchmark)
        self.assertNotIn("  pull_request:\n", benchmark)
        self.assertIn("runner_label=xcsh-compute-d16-candidate", benchmark)
        self.assertIn("runner_label=xcsh-compute-f32-candidate", benchmark)
        self.assertIn("max_parallel=4", benchmark)
        self.assertIn("max_parallel=2", benchmark)
        self.assertIn('test "${RUNNER_IMAGE_DIGEST:', action)
        self.assertNotIn("taiki-e/install-action@", action)
        self.assertIn("Profile legacy setup or baked verification", action)
        self.assertIn('if [[ "$experiment" == image-control ]]', legacy_setup)
        self.assertIn("profile_phase=setup", legacy_setup)
        self.assertIn('profile_phase="setup-$phase_set"', legacy_setup)
        self.assertIn(
            'REQUIRED_PHASES = ["setup", "install", "native", "test-typescript", "test-rust"]',
            (ROOT / "scripts/validate-performance-qualification.ts").read_text(
                encoding="utf-8"
            ),
        )
        for pinned_value in (
            "BUN_VERSION=1.4.2",
            "BUN_SHA256=36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913",
            "ZIG_VERSION=0.16.0",
            "ZIG_SHA256=70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00",
            "RUST_TOOLCHAIN=nightly-2026-09-03",
            "CARGO_NEXTEST_VERSION=0.9.143",
            "CARGO_NEXTEST_SHA256=66786b9abe23920d022a182d1416b1bbc8130dd4872a9553d76985a1708dcd1e",
            "LLVM_DEB_VERSION=18.1.3-1ubuntu1",
            "LLVM_DEB_SHA256=139cb82e16e75fcdd4a56562804ff9bfb482b65d0929580d621d28088075a27e",
            "UBUNTU_SNAPSHOT=20260810T000000Z",
        ):
            self.assertIn(pinned_value, legacy_setup)
        self.assertNotIn("sudo apt-get", legacy_setup)
        self.assertIn("dpkg-deb --extract", legacy_setup)
        self.assertIn('flags.push("--parallel=2")', runner)
        self.assertIn('"--max-concurrency=2"', runner)
        self.assertNotIn("--concurrent", benchmark + action + runner)

    def test_runner_qualification_records_real_output_and_resource_evidence(
        self,
    ) -> None:
        profiler = (ROOT / "scripts/runner-optimization-profile.sh").read_text(
            encoding="utf-8"
        )
        validator = (ROOT / "scripts/validate-performance-qualification.ts").read_text(
            encoding="utf-8"
        )
        for phase_function in (
            "profile_install()",
            "profile_native()",
            "profile_typescript()",
            "profile_rust()",
        ):
            self.assertIn(phase_function, profiler)
        self.assertIn('TARGET_VARIANTS="baseline modern"', profiler)
        self.assertIn("SOURCE_DATE_EPOCH=$(git show", profiler)
        self.assertIn("assignment_seconds", profiler)
        self.assertIn("profiled_node_seconds", profiler)
        self.assertIn("used_ratio", profiler)
        self.assertIn("sha256sum", profiler)
        self.assertIn("medianImprovement >= minimumMedianImprovement", validator)
        self.assertIn("candidateP95 <= baselineP95", validator)
        self.assertIn("maxPeakMemoryRatio < 0.8", validator)

    def test_dag_qualification_uses_one_image_and_real_job_dependencies(self) -> None:
        benchmark = (WORKFLOWS / "compute-benchmark.yml").read_text(encoding="utf-8")
        self.assertIn(
            "image-candidate|d16-serial|d16-parallel-2|d16-hardware|dag-control|dag-candidate)",
            benchmark,
        )
        self.assertIn("  dag-candidate-native:\n", benchmark)
        self.assertIn("  dag-candidate-rust:\n", benchmark)
        self.assertIn("    needs: [prepare, dag-candidate-native]\n", benchmark)
        self.assertIn(
            "    needs: [dag-candidate-typescript, dag-candidate-rust]\n", benchmark
        )
        self.assertIn("ci-native-manifest.ts verify", benchmark)
        self.assertIn("collect-dag-profile.ts", benchmark)

    def test_installs_and_cache_keys_remain_immutable(self) -> None:
        workflows = "\n".join(
            path.read_text(encoding="utf-8")
            for path in WORKFLOWS.glob("*.yml")
            if path.name != "compute-benchmark.yml"
        )
        self.assertNotIn("bun install --frozen-lockfile", workflows)
        self.assertNotIn('bun-version: "1.3', workflows)
        self.assertIn("bun-1.4.2-${{ runner.os }}-${{ runner.arch }}", workflows)
        self.assertNotIn("lookup-only:", workflows)
        self.assertIn("actions/cache/restore@", workflows)
        prime = (WORKFLOWS / "dependency-cache-prime.yml").read_text(encoding="utf-8")
        self.assertIn("uses: actions/cache@", prime)
        self.assertNotIn("actions/cache/restore@", prime)
        self.assertIn(
            "key: rust-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('Cargo.lock', 'rust-toolchain.toml') }}",
            prime,
        )

    def test_cache_smoke_is_path_scoped_or_manual(self) -> None:
        smoke = (WORKFLOWS / "self-hosted-runner-cache-smoke.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("workflow_dispatch:", smoke)
        self.assertIn("    paths:\n", smoke)
        self.assertIn("scripts/ci-bun-install.sh", smoke)


if __name__ == "__main__":
    unittest.main()
