from __future__ import annotations

# ruff: noqa: PT009
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / ".github" / "workflows" / "container.yml"


def job_block(workflow: str, job: str, next_job: str | None) -> str:
    block = workflow.split(f"  {job}:\n", 1)[1]
    return block if next_job is None else block.split(f"  {next_job}:\n", 1)[0]


class ContainerWorkflowContractTests(unittest.TestCase):
    def test_native_builds_publish_digest_receipts_before_manifest_merge(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        amd64 = job_block(workflow, "publish-ghcr-amd64", "publish-ghcr-arm64")
        arm64 = job_block(workflow, "publish-ghcr-arm64", "publish-ghcr")
        merge = job_block(workflow, "publish-ghcr", None)

        self.assertIn("runs-on: xcsh-container-build", amd64)
        self.assertIn("platforms: linux/amd64", amd64)
        self.assertIn("EXPECTED_MACHINE: x86_64", amd64)
        self.assertIn("runs-on: ubuntu-24.04-arm", arm64)
        self.assertIn("platforms: linux/arm64", arm64)
        self.assertIn("EXPECTED_MACHINE: aarch64", arm64)
        for block in (amd64, arm64):
            self.assertIn("push-by-digest=true", block)
            self.assertIn("provenance: mode=max", block)
            self.assertIn("sbom: true", block)
            self.assertIn('docker run --rm "$IMAGE@$DIGEST" --version', block)
            self.assertIn('--entrypoint uname "$IMAGE@$DIGEST" -m', block)
            self.assertIn("digest-receipt.json", block)

        self.assertIn("needs: [publish-ghcr-amd64, publish-ghcr-arm64]", merge)
        self.assertIn("docker buildx imagetools create", merge)
        self.assertIn('if [ "$platforms" != "linux/amd64,linux/arm64" ]', merge)
        self.assertNotIn("setup-qemu-action", workflow)
        self.assertNotIn("platforms: linux/amd64,linux/arm64", workflow)


if __name__ == "__main__":
    unittest.main()
