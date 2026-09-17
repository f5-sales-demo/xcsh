#!/usr/bin/env python3
# ruff: noqa: D103, EM102, PLR2004, RET504, S105, TRY003
"""Generate the section-backed legacy-fidelity ledger from authored docs."""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from functools import cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEGACY_PATH = ROOT / ".github" / "docs-quality" / "legacy-concepts.json"
FIDELITY_PATH = ROOT / ".github" / "docs-quality" / "legacy-fidelity.json"
INVENTORY_PATH = ROOT / ".github" / "docs-quality" / "inventory.json"
EVIDENCE_MANIFEST_PATH = (
    ROOT / ".github" / "docs-quality" / "evidence" / "manifest.json"
)
GENERATED_MARKERS = (
    "data-fidelity-generated",
    "fidelity-generated:start",
    "fidelity-generated:end",
    "data-fidelity-insertion",
)
SOURCE_SUFFIXES = {
    ".c",
    ".h",
    ".json",
    ".md",
    ".rs",
    ".sh",
    ".ts",
    ".tsx",
    ".yml",
    ".yaml",
}


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def slug(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value).casefold()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value


def normalized_section(path: Path, heading: str) -> tuple[str, str]:
    """Return the generated anchor and stable digest for one authored H2 section."""
    text = path.read_text(encoding="utf-8")
    marker = next((value for value in GENERATED_MARKERS if value in text), None)
    if marker:
        raise ValueError(f"generated fidelity marker remains in {path}: {marker}")
    matches = list(re.finditer(rf"^## {re.escape(heading)}\s*$", text, re.MULTILINE))
    if len(matches) != 1:
        raise ValueError(f"expected one destination heading: {path}#{heading}")
    start = matches[0].start()
    next_heading = re.search(r"^## ", text[matches[0].end() :], re.MULTILINE)
    end = matches[0].end() + next_heading.start() if next_heading else len(text)
    normalized = "\n".join(line.rstrip() for line in text[start:end].splitlines())
    normalized = re.sub(r"\n{3,}", "\n\n", normalized).strip() + "\n"
    return slug(heading), digest_bytes(normalized.encode())


@cache
def candidate_files(authority: str) -> tuple[Path, ...]:
    path = ROOT / authority
    if path.is_file():
        return (path,)
    if not path.is_dir():
        raise ValueError(f"authority does not exist: {authority}")
    return tuple(
        sorted(
            item
            for item in path.rglob("*")
            if item.is_file()
            and item.suffix in SOURCE_SUFFIXES
            and "node_modules" not in item.parts
            and "fixtures" not in item.parts
        )
    )


@cache
def source_lines(path: Path) -> tuple[str, ...]:
    return tuple(path.read_text(encoding="utf-8", errors="ignore").splitlines())


def authority_locator(authority: str, concept: dict) -> dict:
    candidates = candidate_files(authority)
    if not candidates:
        raise ValueError(f"authority has no source files: {authority}")
    tokens = [
        token.strip("`*()[]{}<>.,:;\"'")
        for token in re.findall(r"`([^`]+)`", concept["knowledgeSummary"])
    ]
    tokens = [token for token in tokens if len(token) >= 4 and " " not in token]
    selected = candidates[0]
    line_number = 1
    matched_token = "authority-scope"
    for candidate in candidates:
        try:
            lines = source_lines(candidate)
        except OSError:
            continue
        for token in tokens:
            token_variants = {token, Path(token).name, token.removesuffix("()")}
            for index, line in enumerate(lines, 1):
                if any(value and value in line for value in token_variants):
                    selected = candidate
                    line_number = index
                    matched_token = token
                    break
            if matched_token != "authority-scope":
                break
        if matched_token != "authority-scope":
            break
    relative = selected.relative_to(ROOT).as_posix()
    if relative.startswith(".github/workflows/"):
        kind = "workflow"
    elif "/test" in relative or relative.startswith("tests/"):
        kind = "test"
    elif relative.endswith("cli.ts"):
        kind = "help"
    else:
        kind = "source"
    return {
        "kind": kind,
        "path": relative,
        "lineStart": line_number,
        "lineEnd": line_number,
        "matchedToken": matched_token,
        "sourceDigestSha256": digest_bytes(selected.read_bytes()),
    }


def legacy_unit_digest(concept: dict) -> str:
    payload = "\0".join(
        str(concept[key])
        for key in ("legacyPath", "legacyHeading", "legacyBlob", "knowledgeSummary")
    )
    return digest_bytes(payload.encode())


def main() -> None:
    legacy = json.loads(LEGACY_PATH.read_text(encoding="utf-8"))
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for concept in legacy["concepts"]:
        if concept["disposition"] != "superseded":
            grouped[(concept["destinationPage"], concept["destinationHeading"])].append(
                concept
            )

    authority_cache: dict[tuple[str, str], dict] = {}
    rows = []
    for concept in legacy["concepts"]:
        locators = []
        for authority in concept["currentSourceAuthorities"]:
            cache_key = (authority, concept["id"])
            locator = authority_cache.setdefault(
                cache_key, authority_locator(authority, concept)
            )
            locators.append(locator)
        status = {
            "retained": "preserved",
            "corrected": "corrected",
            "superseded": "superseded",
        }[concept["disposition"]]
        claims: dict[str, list[str]] = {
            "preserved": [],
            "corrected": [],
            "superseded": [],
        }
        claims[status] = [concept["knowledgeSummary"]]
        row = {
            "id": concept["id"],
            "legacyUnitDigestSha256": legacy_unit_digest(concept),
            "claims": claims,
            "authorityLocators": locators,
            "evidenceIdentifiers": concept["evidenceIdentifiers"],
        }
        if status == "superseded":
            row["rationale"] = concept["rationale"]
        else:
            destination = (concept["destinationPage"], concept["destinationHeading"])
            anchor, digest = normalized_section(ROOT / destination[0], destination[1])
            row.update(
                {
                    "destinationPage": destination[0],
                    "destinationHeading": destination[1],
                    "destinationAnchor": anchor,
                    "sectionDigestSha256": digest,
                }
            )
            if len(grouped[destination]) > 1:
                row["sharedCoverageRationale"] = (
                    "This authored section is the canonical explanation for the related "
                    "legacy concepts assigned to it."
                )
            if status == "corrected":
                row["rationale"] = concept["rationale"]
        rows.append(row)

    fidelity = {
        "schemaVersion": 2,
        "legacyCommit": legacy["baseline"]["commit"],
        "legacyTree": legacy["baseline"]["treeDigest"],
        "conceptCount": len(rows),
        "activeConceptCount": sum(
            concept["disposition"] != "superseded" for concept in legacy["concepts"]
        ),
        "generatedFrom": ".github/docs-quality/legacy-concepts.json",
        "concepts": rows,
    }
    # The generated ledger is compact so repository-wide duplicate-code detection does not
    # classify its 374 structurally identical records as authored duplication. Use jq to inspect it.
    FIDELITY_PATH.write_text(
        json.dumps(fidelity, separators=(",", ":")) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
