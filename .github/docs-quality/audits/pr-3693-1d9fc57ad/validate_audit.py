# ruff: noqa
"""Focused integrity validator for the PR #3693 audit artifact."""

from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument(
    "--audit", type=Path, default=Path(__file__).resolve().parent / "audit.json"
)
args = parser.parse_args()
audit = json.loads(args.audit.read_text())
errors = []
rows = audit.get("conceptResults", [])
if len(rows) != 374 or len({r.get("id") for r in rows}) != 374:
    errors.append("expected exactly 374 unique concept results")
for row in rows:
    for key in (
        "legacy",
        "destination",
        "authorityCitations",
        "primaryVerdict",
        "severity",
        "reasoning",
    ):
        if not row.get(key):
            errors.append(f"missing {key}: {row.get('id')}")
    if "@1d9fc57ad" not in row["destination"].get(
        "lineCitation", ""
    ) or "@95c019fa" not in row["legacy"].get("lineCitation", ""):
        errors.append(f"unfrozen citation: {row.get('id')}")
if len(audit.get("pageResults", [])) != 62:
    errors.append("expected 62 page results")
challenges = audit.get("checkerChallenges", [])
if not challenges or any(
    not x.get("command") or not x.get("cleanup") for x in challenges
):
    errors.append("incomplete checker challenge receipt")
if not any(
    x.get("invalidFixture") and x.get("outcome") == "accepted" for x in challenges
):
    errors.append("missing fail-open finding")
if errors:
    print("audit-validator: " + "; ".join(errors), file=sys.stderr)
    sys.exit(1)
print(
    "audit-validator: 374 concepts, 62 pages, frozen citations, and checker receipts verified"
)
