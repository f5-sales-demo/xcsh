"""Fail closed if a delivery outcome is removed, renamed, or duplicated."""
# ruff: noqa: EM101, EM102, TRY003

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / ".github" / "ci-outcome-contract.json"


def workflow_jobs(path: Path) -> dict[str, str]:
    """Return statically declared GitHub Actions job names by job identifier."""
    jobs: dict[str, str] = {}
    current: str | None = None
    for line in path.read_text(encoding="utf-8").splitlines():
        job = re.match(r"^  ([A-Za-z0-9_-]+):$", line)
        if job:
            current = job.group(1)
            continue
        name = re.match(r"^    name: (.+)$", line)
        if current and name:
            jobs[current] = name.group(1)
    return jobs


def main() -> None:
    """Validate every named outcome against its workflow job and status name."""
    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    if contract.get("schema_version") != 1:
        raise SystemExit("unsupported CI outcome contract schema")
    outcomes = contract.get("outcomes")
    if not isinstance(outcomes, list) or not outcomes:
        raise SystemExit("CI outcome contract must contain outcomes")

    identities = [(entry.get("workflow"), entry.get("job")) for entry in outcomes]
    if len(identities) != len(set(identities)):
        raise SystemExit("CI outcome contract duplicates a workflow/job identity")

    names: Counter[str] = Counter()
    for entry in outcomes:
        if set(entry) != {"workflow", "job", "name"}:
            raise SystemExit(f"malformed outcome contract entry: {entry!r}")
        workflow = ROOT / ".github" / "workflows" / entry["workflow"]
        jobs = workflow_jobs(workflow)
        actual = jobs.get(entry["job"])
        if actual != entry["name"]:
            raise SystemExit(
                f"missing or changed outcome {entry['workflow']}:{entry['job']}; "
                f"expected {entry['name']!r}, found {actual!r}"
            )
        names[entry["name"]] += 1
    duplicated = sorted(name for name, count in names.items() if count > 1)
    if duplicated:
        raise SystemExit(f"CI outcome contract duplicates status names: {duplicated}")
    print(f"validated {len(outcomes)} contracted delivery outcomes")


if __name__ == "__main__":
    main()
