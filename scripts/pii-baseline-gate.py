#!/usr/bin/env python3
"""Ratchet gate over `scripts/check-pii.sh --format json`.

The repository carries a backlog of PII-shaped findings, so a gate that demands zero would block
every pull request and would be turned off within a day. This gate instead pins the backlog and
fails only when it **grows**: a new path, a new category in a known path, or more findings of a
category than the baseline records.

Counts are keyed by ``(path, category)`` rather than by line, because line numbers move whenever a
file is edited and a line-keyed baseline would churn on unrelated changes.

The baseline is data, not judgement: nothing here decides that a finding is acceptable. Lowering it
is the point — pass ``--update`` after fixing findings so the new, lower count becomes the ceiling.

Reads the scanner's JSON on stdin or from ``--findings``. Exit 0 means no growth, 1 means growth,
2 means the gate could not run. Never prints a matched value; the scanner does not emit one.
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path
from typing import Any

BASELINE_VERSION = 1


def load_findings(source: str | None) -> list[dict[str, Any]]:
    """Read the scanner's JSON document from a path or stdin."""
    raw = Path(source).read_text(encoding="utf-8") if source else sys.stdin.read()
    if not raw.strip():
        message = "no scanner output received (empty input)"
        raise ValueError(message)
    document = json.loads(raw)
    findings = document.get("findings") if isinstance(document, dict) else document
    if not isinstance(findings, list):
        message = "scanner output has no findings array"
        raise ValueError(message)
    return findings


def tally(findings: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    """Count findings per path and category."""
    counts: dict[str, collections.Counter[str]] = collections.defaultdict(collections.Counter)
    for finding in findings:
        path = str(finding.get("path", ""))
        category = str(finding.get("category", ""))
        if path and category:
            counts[path][category] += 1
    return {path: dict(sorted(categories.items())) for path, categories in sorted(counts.items())}


def annotate(finding: dict[str, Any]) -> str:
    """Render one finding as a GitHub Actions error annotation."""
    path = finding.get("path", "")
    line = finding.get("line", 1)
    category = finding.get("category", "unknown")
    message = finding.get("message", "PII-shaped value")
    return f"::error file={path},line={line}::[{category}] {message}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--findings", help="scanner JSON file; defaults to stdin")
    parser.add_argument("--baseline", default=".github/pii-baseline.json")
    parser.add_argument(
        "--update",
        action="store_true",
        help="rewrite the baseline from these findings instead of comparing",
    )
    args = parser.parse_args()

    try:
        findings = load_findings(args.findings)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"PII gate error: {error}", file=sys.stderr)
        return 2

    current = tally(findings)
    baseline_path = Path(args.baseline)

    if args.update:
        document = {"version": BASELINE_VERSION, "counts": current}
        baseline_path.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        total = sum(sum(c.values()) for c in current.values())
        print(f"PII gate: baseline written to {baseline_path} ({len(current)} path(s), {total} finding(s)).")
        return 0

    if not baseline_path.is_file():
        print(f"PII gate error: baseline not found at {baseline_path}; run with --update", file=sys.stderr)
        return 2
    try:
        baseline = json.loads(baseline_path.read_text(encoding="utf-8")).get("counts", {})
    except (OSError, json.JSONDecodeError) as error:
        print(f"PII gate error: cannot read baseline: {error}", file=sys.stderr)
        return 2

    # Growth is what fails. Anything at or below the recorded ceiling passes.
    grown: list[tuple[str, str, int, int]] = []
    for path, categories in current.items():
        allowed = baseline.get(path, {})
        for category, count in categories.items():
            ceiling = int(allowed.get(category, 0))
            if count > ceiling:
                grown.append((path, category, count, ceiling))

    if grown:
        offending = {(path, category) for path, category, _, _ in grown}
        for finding in findings:
            if (str(finding.get("path")), str(finding.get("category"))) in offending:
                print(annotate(finding))
        print("::error::PII findings increased over the recorded baseline.")
        for path, category, count, ceiling in sorted(grown):
            print(f"  {path} [{category}]: {count} > {ceiling}")
        print("Fix the finding at its source. STYLE_GUIDE.md defines the synthetic replacements.")
        print("If the increase is a scanner false positive, say so on the pull request and raise it")
        print("with docs-control rather than raising the baseline to hide it.")
        return 1

    # Report improvements so the ceiling can be lowered deliberately.
    improved = [
        (path, category, int(counts.get(category, 0)), current.get(path, {}).get(category, 0))
        for path, counts in baseline.items()
        for category in counts
        if current.get(path, {}).get(category, 0) < int(counts.get(category, 0))
    ]
    total = sum(sum(c.values()) for c in current.values())
    print(f"PII gate: no growth over baseline ({total} finding(s) across {len(current)} path(s)).")
    if improved:
        removed = sum(was - now for _, _, was, now in improved)
        print(f"::notice::{removed} finding(s) fixed since the baseline. Re-run with --update to lower it.")
        for path, category, was, now in sorted(improved)[:20]:
            print(f"  {path} [{category}]: {was} -> {now}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
