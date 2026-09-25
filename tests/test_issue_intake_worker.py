# ruff: noqa: INP001, PT009, PT027
import json
import tempfile
import unittest
from pathlib import Path

from scripts.issue_intake_worker import read_lease


class WorkerLeaseTests(unittest.TestCase):
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
