# ruff: noqa: PT009, PT027
import json
import tempfile
import unittest
from pathlib import Path

from scripts.issue_intake_worker import herdr_binary, herdr_endpoint, read_lease


class WorkerLeaseTests(unittest.TestCase):
    def test_derives_herdr_paths_from_the_worker_home(self):
        home = Path("/srv/example-worker")
        self.assertEqual(herdr_binary(home), home / ".local/bin/herdr")
        self.assertEqual(
            herdr_endpoint(home),
            home / ".config/herdr/sessions/xcsh-issue-intake/herdr.sock",
        )

    def test_systemd_unit_uses_the_service_account_home(self):
        unit = (
            Path(__file__).parents[1] / "scripts/systemd/xcsh-issue-intake.service"
        ).read_text()
        self.assertIn("Environment=PATH=%h/.local/bin:", unit)
        self.assertNotIn("/home/", unit)

    def test_reads_owner_only_local_lease(self):
        with tempfile.TemporaryDirectory() as tmp:
            lease = Path(tmp) / "herdr.lease"
            lease.write_text(json.dumps({"lease": "opaque-token"}))
            lease.chmod(0o600)
            self.assertEqual(read_lease(lease), "opaque-token")

    def test_rejects_group_readable_lease(self):
        with tempfile.TemporaryDirectory() as tmp:
            lease = Path(tmp) / "herdr.lease"
            lease.write_text(json.dumps({"lease": "opaque-token"}))
            lease.chmod(0o640)
            with self.assertRaises(PermissionError):
                read_lease(lease)


if __name__ == "__main__":
    unittest.main()
