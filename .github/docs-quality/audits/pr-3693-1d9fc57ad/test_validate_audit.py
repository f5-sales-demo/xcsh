# ruff: noqa
"""Negative-fixture checks for the audit-result validator."""

from __future__ import annotations
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE = json.loads((ROOT / "audit.json").read_text())
fixtures = json.loads((ROOT / "negative-fixtures.json").read_text())["fixtures"]
for fixture in fixtures:
    payload = json.loads(json.dumps(BASE))
    if fixture["id"] == "missing-concept":
        payload["conceptResults"].pop()
    elif fixture["id"] == "duplicate-concept":
        payload["conceptResults"][1]["id"] = payload["conceptResults"][0]["id"]
    elif fixture["id"] == "unfrozen-citation":
        payload["conceptResults"][0]["destination"]["lineCitation"] = "unfrozen"
    elif fixture["id"] == "missing-authority":
        payload["conceptResults"][0]["authorityCitations"] = []
    elif fixture["id"] == "missing-challenge-cleanup":
        payload["checkerChallenges"][0]["cleanup"] = ""
    with tempfile.NamedTemporaryFile("w", suffix=".json") as candidate:
        json.dump(payload, candidate)
        candidate.flush()
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "validate_audit.py"),
                "--audit",
                candidate.name,
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0, fixture["id"]
print(f"audit-validator-fixtures: {len(fixtures)} invalid artifacts rejected")
