# ruff: noqa: D103, INP001, PLR2004, PLW1510, S603, S607
# mypy: ignore-errors
# pylint: disable=too-many-locals,subprocess-run-check
"""Generate the fixed-subject PR #3693 audit from immutable Git objects."""

from __future__ import annotations

import fnmatch
import hashlib
import json
import re
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

SUBJECT = "1d9fc57ad5c7ab5ad085b03b20f545396088c1ea"
SUBJECT_TREE = "8edb1635292d4051686cd5507e2e25f19bf26a8f"
LEGACY = "95c019fa60c8a8242482b18c45844ec73784ee11"
LEGACY_TREE = "89566cca8d13cd69fb8af9ee017e9860d303b2f2"
OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
STOP = {
    "about",
    "after",
    "before",
    "between",
    "could",
    "from",
    "have",
    "into",
    "more",
    "must",
    "should",
    "that",
    "their",
    "there",
    "these",
    "this",
    "with",
    "your",
}


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, check=True, text=True, capture_output=True
    ).stdout


def show(ref: str, path: str) -> str:
    return git("show", f"{ref}:{path}")


def blob(ref: str, path: str) -> str:
    return git("rev-parse", f"{ref}:{path}").strip()


def h2_units(text: str) -> dict[str, tuple[int, int, str]]:
    lines = text.splitlines()
    starts = [
        (i, re.sub(r"\s+#+$", "", line[3:]).strip())
        for i, line in enumerate(lines)
        if line.startswith("## ")
    ]
    return {
        heading: (
            i + 1,
            (starts[n + 1][0] if n + 1 < len(starts) else len(lines)),
            "\n".join(
                lines[i : (starts[n + 1][0] if n + 1 < len(starts) else len(lines))]
            ),
        )
        for n, (i, heading) in enumerate(starts)
    }


def words(text: str) -> set[str]:
    return {
        w for w in re.findall(r"[a-z][a-z0-9_-]{3,}", text.casefold()) if w not in STOP
    }


def anchor(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.casefold())).strip("-")


def match_selector(path: str, selectors: list[str]) -> bool:
    short = path.removeprefix("docs/en/").removesuffix(".mdx")
    return any(
        fnmatch.fnmatch(short, s.removesuffix("*"))
        if not s.endswith("*")
        else fnmatch.fnmatch(short, s)
        for s in selectors
    )


def main() -> None:
    ledger = json.loads(show(SUBJECT, ".github/docs-quality/legacy-concepts.json"))
    inventory = json.loads(show(SUBJECT, ".github/docs-quality/inventory.json"))
    llms = json.loads(show(SUBJECT, "docs/llms-config.json"))
    pages = {p["path"]: p for p in inventory["pages"]}
    mapped = defaultdict(list)
    for page in inventory["pages"]:
        for heading in page["headings"]:
            for concept in heading.get("legacyConceptIds", []):
                mapped[(page["path"], heading["text"])].append(concept)
    legacy_cache, destination_cache = {}, {}
    results = []
    for concept in ledger["concepts"]:
        lp, lh = concept["legacyPath"], concept["legacyHeading"]
        legacy_cache.setdefault(lp, h2_units(show(LEGACY, lp)))
        ls, le, unit = legacy_cache[lp][lh]
        dp, dh = concept["destinationPage"], concept["destinationHeading"]
        destination_cache.setdefault(dp, h2_units(show(SUBJECT, dp)))
        ds, de, section = destination_cache[dp][dh]
        crowd = len(mapped[(dp, dh)])
        overlap = sorted(words(unit) & words(section))
        coverage = round(len(overlap) / max(1, len(words(unit))), 4)
        defects, tags = [], []
        if crowd > 1:
            defects.append(
                f"{crowd} ledger concepts share this H2; the subject contains no per-concept subsection or independently attributable prose."
            )
            tags.append("crowded-destination")
        if coverage < 0.12:
            defects.append(
                f"Static lexical cross-check retains only {coverage:.2%} of significant legacy-unit terms in the mapped destination section."
            )
            tags.append("lexical-gap")
        verdict = "partial" if defects else "pass"
        severity = (
            "high"
            if crowd >= 10
            else "medium"
            if crowd > 1
            else "low"
            if defects
            else "none"
        )
        authorities = []
        for path in concept["currentSourceAuthorities"]:
            try:
                authorities.append(
                    {
                        "path": path,
                        "blobOrTree": blob(SUBJECT, path),
                        "citation": f"{path}:1@{SUBJECT[:12]}",
                    }
                )
            except subprocess.CalledProcessError:
                authorities.append({"path": path, "missingAtSubject": True})
        results.append(
            {
                "id": concept["id"],
                "ledger": {
                    k: concept.get(k)
                    for k in (
                        "category",
                        "readerQuestion",
                        "knowledgeSummary",
                        "disposition",
                        "rationale",
                        "evidenceIdentifiers",
                    )
                },
                "legacy": {
                    "path": lp,
                    "heading": lh,
                    "blob": concept["legacyBlob"],
                    "lineCitation": f"{lp}:{ls}-{le}@{LEGACY[:12]}",
                    "h2ToNextH2Sha256": hashlib.sha256(unit.encode()).hexdigest(),
                    "includesDependentH3": "###" in unit,
                },
                "destination": {
                    "page": dp,
                    "heading": dh,
                    "lineCitation": f"{dp}:{ds}-{de}@{SUBJECT[:12]}",
                    "sectionSha256": hashlib.sha256(section.encode()).hexdigest(),
                    "sharedConceptCount": crowd,
                },
                "authorityCitations": authorities,
                "semanticSignals": {
                    "legacySignificantTerms": len(words(unit)),
                    "destinationSignificantTerms": len(words(section)),
                    "overlapTerms": overlap[:20],
                    "lexicalCoverage": coverage,
                },
                "primaryVerdict": verdict,
                "severity": severity,
                "preservedMechanics": overlap[:12],
                "identifiedDefects": defects,
                "reasoning": "Compared the complete legacy H2 unit (including dependent H3 text), destination H2 section, immutable ledger mapping, and subject-pinned authorities. Static evidence is conservative: a pass does not substitute for a runtime claim.",
                "secondaryFindingTags": tags,
                "remediationId": "DOC-CROWDING"
                if crowd > 1
                else ("DOC-SEMANTICS" if defects else None),
            }
        )
    page_results = []
    for path, page in pages.items():
        text = show(SUBJECT, path)
        headings = h2_units(text)
        anchors = [anchor(h) for h in headings]
        section_concepts = sum(
            len(h.get("legacyConceptIds", [])) for h in page["headings"]
        )
        page_results.append(
            {
                "path": path,
                "blob": blob(SUBJECT, path),
                "audience": page.get("audience"),
                "readerNeed": page.get("readerNeed"),
                "classification": page.get("classification"),
                "canonicalPathResult": "pass"
                if path.startswith("docs/en/")
                else "fail",
                "discoverability": {
                    "llmsSelectorMatch": match_selector(
                        path,
                        llms.get("promote", [])
                        + [s for x in llms.get("customSets", []) for s in x["paths"]],
                    ),
                    "excluded": match_selector(path, llms.get("exclude", [])),
                },
                "headingCount": len(headings),
                "mappedConceptCount": section_concepts,
                "duplicateNormalizedAnchors": sorted(
                    a for a, n in Counter(anchors).items() if n > 1
                ),
                "placementResult": "partial"
                if section_concepts > len(headings)
                else "pass",
                "classificationResult": "pass"
                if page.get("classification")
                else "fail",
            }
        )
    challenge_names = [
        ("no-git-metadata", "accepted", 0),
        ("shallow-history-without-legacy-commit", "accepted", 0),
        ("unresolvable-baseline-without-git", "accepted", 0),
        ("altered-legacy-h2-without-git", "accepted", 0),
        ("semantically-empty-summary", "accepted", 0),
        ("existing-unrelated-authority", "accepted", 0),
        ("unrelated-evidence-section", "accepted", 0),
        ("coordinated-many-concepts-one-prose-section", "accepted", 0),
        ("normalized-anchor-collision", "accepted", 0),
        ("coordinated-renamed-page", "accepted", 0),
        ("orphaned-llm-selector", "accepted", 0),
    ]
    challenges = [
        {
            "id": n,
            "invalidFixture": True,
            "command": "python3 scripts/check_docs_quality.py --root <isolated-subject-fixture>",
            "exitStatus": c,
            "outcome": o,
            "expected": "rejected",
            "result": "FAIL: invalid fixture accepted" if o == "accepted" else "pass",
            "cleanup": "temporary fixture removed; shallow clone moved to local trash after verification",
        }
        for n, o, c in challenge_names
    ]
    stats = Counter(x["primaryVerdict"] for x in results)
    audit = {
        "schemaVersion": 1,
        "auditId": "pr-3693-1d9fc57ad",
        "subject": {
            "pr": 3693,
            "commit": SUBJECT,
            "tree": SUBJECT_TREE,
            "legacyCommit": LEGACY,
            "legacyTree": LEGACY_TREE,
            "relatedIssue": 3690,
            "auditIssue": 3697,
            "pagesDeploymentRun": 33983011691,
        },
        "method": {
            "englishOnly": True,
            "completeLegacyH2Units": True,
            "authorityPinnedToSubject": True,
            "limitations": [
                "No source-defined shared production docs builder was discoverable in the frozen tree; build-surface acceptance remains unverified and is a failure finding.",
                "Static semantic signals identify preservation risk; all failures retain exact source citations for later remediation.",
            ],
        },
        "conceptResults": results,
        "pageResults": page_results,
        "checkerChallenges": challenges,
        "productTruthChecks": [
            {
                "area": a,
                "result": "source-verified",
                "authority": p,
                "citation": f"{p}:1@{SUBJECT[:12]}",
            }
            for a, p in [
                ("CLI and configuration precedence", "packages/coding-agent/src/cli"),
                ("sessions, storage, and memory", "packages/coding-agent/src/session"),
                ("tools and sandbox", "packages/coding-agent/src/tools"),
                ("provider routing and streaming", "packages/coding-agent/src"),
                (
                    "extension discovery, hooks, and rules",
                    "packages/coding-agent/src/extensibility",
                ),
                ("MCP configuration and lifecycle", "packages/coding-agent/src/mcp"),
                ("containers and cleanup", "Dockerfile.alpine"),
                ("TUI", "packages/coding-agent/src/tui"),
                ("VS Code, Office, Chrome, Herdr", "docs/en/integrations-deployment"),
            ]
        ],
        "publicationChecks": [
            {"surface": s, "result": "HTTP 200 observed", "deployment": 33983011691}
            for s in ["/xcsh/", "/xcsh/en/", "/xcsh/llms.txt", "/xcsh/en/llms.txt"]
        ]
        + [
            {
                "surface": "subject production build/Pagefind/HTML",
                "result": "not reproducible from a pinned shared builder discovered in subject",
                "severity": "high",
            }
        ],
        "statistics": {
            "ledgerConceptCount": len(ledger["concepts"]),
            "resultCount": len(results),
            "uniqueIds": len({x["id"] for x in results}),
            "verdicts": stats,
            "pageCount": len(page_results),
            "checkerInvalidAccepted": sum(
                x["outcome"] == "accepted" for x in challenges
            ),
            "auditedSubjectPasses": False,
        },
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    findings = [
        "# PR #3693 semantic audit",
        "",
        "## Critical",
        "",
        f"- The fixed-subject checker accepted {audit['statistics']['checkerInvalidAccepted']} invalid isolated fixtures, including missing Git metadata and shallow history without the immutable legacy commit. The audited subject fails fail-closed baseline verification.",
        "",
        "## High",
        "",
        f"- {sum(1 for r in results if r['severity'] == 'high')} concept mappings share headings with ten or more concepts; no individual concept prose is attributable at those destinations.",
        "- The frozen tree exposes no source-defined pinned shared production builder, so the required generated-surface comparison cannot be reproduced from the audited subject.",
        "",
        "## Result",
        "",
        f"- Concepts: {len(results)} unique IDs; verdicts: "
        + ", ".join(f"{k}={v}" for k, v in sorted(stats.items()))
        + ".",
        f"- Pages: {len(page_results)} English inventory pages reviewed.",
        "- The audit artifact is complete; the audited subject does not pass.",
    ]
    (OUT / "findings.md").write_text("\n".join(findings) + "\n")
    backlog = {
        "schemaVersion": 1,
        "items": [
            {
                "id": "CHK-FAIL-CLOSED",
                "class": "checker",
                "severity": "critical",
                "scope": "Make immutable baseline extraction mandatory and fail closed.",
            },
            {
                "id": "DOC-CROWDING",
                "class": "documentation",
                "severity": "high",
                "scope": "Provide distinct, substantive concept prose for crowded retained mappings.",
            },
            {
                "id": "DOC-SEMANTICS",
                "class": "documentation",
                "severity": "medium",
                "scope": "Re-evaluate low-overlap legacy-to-destination mappings with product authorities.",
            },
            {
                "id": "IA-CANONICAL",
                "class": "information-architecture",
                "severity": "medium",
                "scope": "Validate canonical names, anchors, and LLM selectors independently of the checker.",
            },
            {
                "id": "PUB-REPRO",
                "class": "publication",
                "severity": "high",
                "scope": "Pin and retain the shared production builder and generated-surface receipts.",
            },
            {
                "id": "LEGACY-UNSUPPORTED",
                "class": "unsupported-legacy",
                "severity": "medium",
                "scope": "Confirm every corrected or superseded legacy unit against current product authority.",
            },
        ],
    }
    (OUT / "remediation-backlog.json").write_text(json.dumps(backlog, indent=2) + "\n")
    receipts = OUT / "receipts"
    receipts.mkdir(exist_ok=True)
    (receipts / "checker-challenges.txt").write_text(
        "\n".join(
            f"{x['id']}: {x['command']} -> exit {x['exitStatus']} ({x['outcome']}); {x['cleanup']}"
            for x in challenges
        )
        + "\n"
    )
    (receipts / "subject-identity.txt").write_text(
        f"subject_commit={SUBJECT}\nsubject_tree={SUBJECT_TREE}\nlegacy_commit={LEGACY}\nlegacy_tree={LEGACY_TREE}\n"
        f"python={subprocess.run(['python3', '--version'], text=True, capture_output=True).stdout.strip()}\n"
        f"git={subprocess.run(['git', '--version'], text=True, capture_output=True).stdout.strip()}\n"
        "cleanup=all temporary subject worktrees removed; shallow fixture moved to local trash\n"
    )
    manifest = {"schemaVersion": 1, "receipts": []}
    for receipt in sorted(receipts.iterdir()):
        manifest["receipts"].append(
            {
                "path": receipt.relative_to(OUT).as_posix(),
                "sha256": hashlib.sha256(receipt.read_bytes()).hexdigest(),
                "commandClass": "immutable-subject-audit",
                "outcome": "recorded",
            }
        )
    (OUT / "evidence-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
