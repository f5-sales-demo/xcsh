#!/usr/bin/env python3
# ruff: noqa: PERF401
"""Enforce the xcsh documentation purpose and evidence contract."""

# pylint: disable=too-many-branches,too-many-locals,too-many-statements

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

BOILERPLATE = (
    "the command or interface reports completion in the selected scope",
    "a current xcsh release and a shell in the intended working directory",
    "authorization for any account, tenant, repository, or file the procedure touches",
    "a backup or dry run before an operation that changes or deletes state",
    "retry with optional plugins, mcp servers, or extensions disabled",
)
GENERIC_CLAIMS = (
    "reports completion",
    "completed successfully",
    "should work",
    "you are ready to go",
)
OUTPUT_LANGUAGES = {"console", "output"}
MIN_DUPLICATE_LENGTH = 120
LEGACY_COMMIT = "95c019fa60c8a8242482b18c45844ec73784ee11"
LEGACY_TREE = "89566cca8d13cd69fb8af9ee017e9860d303b2f2"
LEGACY_PAGE_COUNT = 59
LEGACY_CONCEPT_COUNT = 374
ACTIVE_CONCEPT_COUNT = 372
LEGACY_UNIT_DIGEST = "7378b8bd45b3b0ad48864a094d97af76b212ff4ab892d8f28b80f7dd43fd012e"
INVENTORY_SCHEMA_VERSION = 2
FIDELITY_SCHEMA_VERSION = 2
MAX_SIDEBAR_LABEL_LENGTH = 24
GIT_EXECUTABLE = shutil.which("git")
GENERATED_FIDELITY_MARKERS = (
    "data-fidelity-generated",
    "fidelity-generated:start",
    "fidelity-generated:end",
    "data-fidelity-insertion",
    "data-fidelity=",
)


def _load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        message = f"cannot read {path}: {exc}"
        raise ValueError(message) from exc


def _strip_frontmatter(text: str) -> str:
    if not text.startswith("---\n"):
        return text
    end = text.find("\n---\n", 4)
    return text[end + 5 :] if end >= 0 else text


def _headings(text: str) -> list[str]:
    in_fence = False
    found: list[str] = []
    for line in _strip_frontmatter(text).splitlines():
        if line.startswith("```"):
            in_fence = not in_fence
            continue
        match = None if in_fence else re.match(r"^#{2,6}\s+(.+?)\s*$", line)
        if match:
            found.append(re.sub(r"\s+#+$", "", match.group(1)).strip())
    return found


def _prose_paragraphs(text: str) -> list[str]:
    body = _strip_frontmatter(text)
    body = re.sub(r"```.*?```", "", body, flags=re.DOTALL)
    body = re.sub(r"<[^>]+>", " ", body)
    paragraphs: list[str] = []
    for paragraph in re.split(r"\n\s*\n", body):
        lines = [
            line
            for line in paragraph.splitlines()
            if not re.match(r"^\s*(#|[-*+] |\d+\. )", line)
        ]
        normalized = re.sub(r"\s+", " ", " ".join(lines)).strip().casefold()
        if len(normalized) >= MIN_DUPLICATE_LENGTH:
            paragraphs.append(normalized)
    return paragraphs


def _output_fences(text: str) -> int:
    return sum(
        1
        for language in re.findall(
            r"^```([^\s`]*)", _strip_frontmatter(text), flags=re.MULTILINE
        )
        if language.casefold() in OUTPUT_LANGUAGES
    )


def _check_page(
    page: Path,
    root: Path,
    entry: dict | None,
    used_evidence: set[str],
    paragraph_locations: dict[str, list[str]],
) -> list[str]:
    errors: list[str] = []
    relative = page.relative_to(root).as_posix()
    text = page.read_text(encoding="utf-8")
    errors.extend(
        f"generated fidelity marker in {relative}: {marker}"
        for marker in GENERATED_FIDELITY_MARKERS
        if marker in text
    )
    errors.extend(
        f"known boilerplate in {relative}: {phrase}"
        for phrase in BOILERPLATE
        if phrase in text.casefold()
    )
    errors.extend(
        f"unsupported generic claim in {relative}: {phrase}"
        for phrase in GENERIC_CLAIMS
        if phrase in text.casefold()
    )
    for paragraph in _prose_paragraphs(text):
        paragraph_locations[paragraph].append(relative)
    if entry is None:
        return errors

    errors.extend(
        f"inventory page field missing: {relative} {field}"
        for field in ("classification", "audience", "readerNeed", "purpose")
        if not str(entry.get(field, "")).strip()
    )
    if not entry.get("sourceAuthority"):
        errors.append(f"source authority missing: {relative}")

    declared_headings = {item.get("text"): item for item in entry.get("headings", [])}
    actual_headings = _headings(text)
    errors.extend(
        f"heading missing from inventory: {relative}#{heading}"
        for heading in actual_headings
        if heading not in declared_headings
    )
    errors.extend(
        f"inventory references missing heading: {relative}#{heading}"
        for heading in sorted(set(declared_headings) - set(actual_headings))
    )
    for heading, heading_entry in declared_headings.items():
        errors.extend(
            f"inventory heading field missing: {relative}#{heading} {field}"
            for field in ("readerQuestion", "purpose")
            if not str(heading_entry.get(field, "")).strip()
        )
        used_evidence.update(heading_entry.get("evidence", []))
    page_evidence = entry.get("evidence", [])
    used_evidence.update(page_evidence)
    if _output_fences(text) and not page_evidence:
        errors.append(f"output block has no evidence: {relative}")
    has_outcome_heading = any(
        re.search(
            r"\b(procedure|verify|verification|result|outcome)\b",
            heading,
            re.IGNORECASE,
        )
        for heading in actual_headings
    )
    if has_outcome_heading and not page_evidence:
        errors.append(f"procedure or outcome heading has no evidence: {relative}")
    return errors


def _known_sections(inventory_pages: dict) -> set[str]:
    sections: set[str] = set()
    for path, entry in inventory_pages.items():
        sections.add(path)
        sections.update(
            f"{path}#{heading.get('text')}" for heading in entry.get("headings", [])
        )
    return sections


def _slug(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value).casefold()
    return re.sub(r"[^a-z0-9]+", "-", value).strip("-")


def _page_route(page: Path, root: Path) -> str:
    relative = page.relative_to(root / "docs" / "en")
    if relative.name == "index.mdx":
        return relative.parent.as_posix().strip(".")
    return relative.with_suffix("").as_posix()


def _check_navigation_and_links(root: Path, pages: list[Path]) -> list[str]:
    errors: list[str] = []
    routes = {_page_route(page, root): page for page in pages}
    labels: dict[Path, dict[str, str]] = defaultdict(dict)
    anchors: dict[Path, set[str]] = {}
    for page in pages:
        text = page.read_text(encoding="utf-8")
        frontmatter = text.split("---", 2)[1] if text.startswith("---") else ""
        match = re.search(
            r'^\s{2}label:\s*["\']?([^"\'\n]+)', frontmatter, re.MULTILINE
        )
        if match:
            label = match.group(1).strip()
            if len(label) > MAX_SIDEBAR_LABEL_LENGTH:
                errors.append(
                    f"sidebar label exceeds 24 characters: {page.relative_to(root)} {label}"
                )
            sibling = labels[page.parent]
            folded = label.casefold()
            if folded in sibling:
                errors.append(
                    f"sibling sidebar label collision: {page.relative_to(root)} and {sibling[folded]} {label}"
                )
            sibling[folded] = page.relative_to(root).as_posix()
        text_anchors = {_slug(heading) for heading in _headings(text)}
        heading_slugs = [_slug(heading) for heading in _headings(text)]
        for duplicate in sorted(
            {value for value in heading_slugs if heading_slugs.count(value) > 1}
        ):
            errors.append(f"anchor collision: {page.relative_to(root)}#{duplicate}")
        text_anchors.update(re.findall(r'<[^>]+\sid=["\']([^"\']+)["\']', text))
        anchors[page] = text_anchors

    for page in pages:
        text = page.read_text(encoding="utf-8")
        for href in re.findall(r"(?<!!)\[[^\]]+\]\(([^)\s]+)", text):
            target: Path | None
            if re.match(r"(?:https?:|mailto:)", href):
                continue
            target_value, _, fragment = href.partition("#")
            if not target_value:
                target = page
            elif target_value.startswith("/xcsh/en/"):
                route = target_value.removeprefix("/xcsh/en/").strip("/")
                target = routes.get(route)
            else:
                candidate = (page.parent / target_value).resolve()
                choices = [candidate]
                if candidate.suffix not in {".md", ".mdx"}:
                    choices.extend(
                        [candidate.with_suffix(".mdx"), candidate / "index.mdx"]
                    )
                target = next((choice for choice in choices if choice in pages), None)
            if target is None:
                errors.append(f"broken internal link: {page.relative_to(root)} {href}")
            elif fragment and fragment not in anchors[target]:
                errors.append(
                    f"broken internal anchor: {page.relative_to(root)} {href}"
                )

    llms_path = root / "docs" / "llms-config.json"
    if llms_path.is_file():
        llms = _load_json(llms_path)
        selectors: list[str] = []
        for custom_set in llms.get("customSets", []):
            selectors.extend(custom_set.get("paths", []))
        for key in ("promote", "demote", "exclude"):
            selectors.extend(llms.get(key, []))
        route_values = [route or "index" for route in routes]
        route_values.extend(
            page.relative_to(root / "docs" / "en").with_suffix("").as_posix()
            for page in pages
        )
        for selector in selectors:
            if not any(fnmatch.fnmatch(route, selector) for route in route_values):
                errors.append(f"orphaned LLM selector: {selector}")
    return errors


def _check_fidelity(
    root: Path, fidelity: dict, legacy: dict, evidence_entries: dict
) -> list[str]:
    errors: list[str] = []
    if fidelity.get("schemaVersion") != FIDELITY_SCHEMA_VERSION:
        errors.append("legacy fidelity schema must be version 2")
    rows = fidelity.get("concepts", [])
    row_ids = [row.get("id") for row in rows]
    errors.extend(
        f"duplicate fidelity concept id: {concept_id}"
        for concept_id in sorted(
            {value for value in row_ids if value and row_ids.count(value) > 1}
        )
    )
    legacy_by_id = {
        concept.get("id"): concept for concept in legacy.get("concepts", [])
    }
    if set(row_ids) != set(legacy_by_id):
        errors.append("fidelity concept set does not match immutable legacy ledger")
    if (
        fidelity.get("conceptCount") != LEGACY_CONCEPT_COUNT
        or len(rows) != LEGACY_CONCEPT_COUNT
    ):
        errors.append("fidelity ledger must contain exactly 374 concepts")
    active_rows = [
        row
        for row in rows
        if legacy_by_id.get(row.get("id"), {}).get("disposition") != "superseded"
    ]
    if (
        fidelity.get("activeConceptCount") != ACTIVE_CONCEPT_COUNT
        or len(active_rows) != ACTIVE_CONCEPT_COUNT
    ):
        errors.append("fidelity ledger must contain exactly 372 active concepts")

    file_digest_cache: dict[Path, str] = {}
    locator_owners: dict[tuple[str, str], list[dict]] = defaultdict(list)
    required = (
        "id",
        "legacyUnitDigestSha256",
        "claims",
        "authorityLocators",
        "evidenceIdentifiers",
    )
    allowed_authority_roots = ("packages/", "crates/", "scripts/", ".github/workflows/")
    for row in rows:
        concept_id = str(row.get("id") or "<missing>")
        errors.extend(
            f"fidelity field missing: {concept_id} {field}"
            for field in required
            if row.get(field) in (None, "", [])
        )
        legacy_concept = legacy_by_id.get(concept_id)
        if legacy_concept:
            payload = "\0".join(
                str(legacy_concept[key])
                for key in (
                    "legacyPath",
                    "legacyHeading",
                    "legacyBlob",
                    "knowledgeSummary",
                )
            )
            if hashlib.sha256(payload.encode()).hexdigest() != row.get(
                "legacyUnitDigestSha256"
            ):
                errors.append(f"stale legacy unit digest: {concept_id}")
        claims = row.get("claims", {})
        statuses = [
            name
            for name in ("preserved", "corrected", "superseded")
            if claims.get(name)
        ]
        if len(statuses) != 1:
            errors.append(f"fidelity claim disposition must be singular: {concept_id}")
        legacy_disposition = (
            str(legacy_concept.get("disposition")) if legacy_concept else ""
        )
        expected_status = {
            "retained": "preserved",
            "corrected": "corrected",
            "superseded": "superseded",
        }.get(legacy_disposition)
        if statuses and statuses[0] != expected_status:
            errors.append(f"fidelity disposition mismatch: {concept_id}")
        if (
            statuses
            and statuses[0] != "preserved"
            and not str(row.get("rationale", "")).strip()
        ):
            errors.append(f"fidelity correction rationale missing: {concept_id}")
        if expected_status == "superseded":
            forbidden = (
                "destinationPage",
                "destinationHeading",
                "destinationAnchor",
                "sectionDigestSha256",
                "contentBlockLocator",
            )
            if any(row.get(field) not in (None, "") for field in forbidden):
                errors.append(
                    f"superseded fidelity concept has a reader locator: {concept_id}"
                )
        else:
            destination_fields = (
                "destinationPage",
                "destinationHeading",
                "destinationAnchor",
                "sectionDigestSha256",
            )
            errors.extend(
                f"fidelity field missing: {concept_id} {field}"
                for field in destination_fields
                if row.get(field) in (None, "")
            )
            page_value = row.get("destinationPage", "")
            heading = row.get("destinationHeading", "")
            anchor = row.get("destinationAnchor", "")
            locator_owners[(page_value, anchor)].append(row)
            page = root / page_value
            if not page.is_file():
                errors.append(
                    f"missing fidelity destination: {concept_id} {page_value}"
                )
            else:
                text = page.read_text(encoding="utf-8")
                matches = list(
                    re.finditer(
                        rf"^## {re.escape(str(heading))}\s*$", text, re.MULTILINE
                    )
                )
                if len(matches) != 1 or anchor != _slug(str(heading)):
                    errors.append(f"unresolved fidelity section: {concept_id}")
                else:
                    start = matches[0].start()
                    next_heading = re.search(
                        r"^## ", text[matches[0].end() :], re.MULTILINE
                    )
                    end = (
                        matches[0].end() + next_heading.start()
                        if next_heading
                        else len(text)
                    )
                    normalized = "\n".join(
                        line.rstrip() for line in text[start:end].splitlines()
                    )
                    normalized = re.sub(r"\n{3,}", "\n\n", normalized).strip() + "\n"
                    if hashlib.sha256(normalized.encode()).hexdigest() != row.get(
                        "sectionDigestSha256"
                    ):
                        errors.append(f"stale fidelity section digest: {concept_id}")
        for evidence_id in row.get("evidenceIdentifiers", []):
            if evidence_id not in evidence_entries:
                errors.append(
                    f"fidelity references unknown evidence: {concept_id} {evidence_id}"
                )
        for locator in row.get("authorityLocators", []):
            authority = locator.get("path", "")
            if authority != "DEVELOPING.md" and not authority.startswith(
                allowed_authority_roots
            ):
                errors.append(f"unrelated fidelity authority: {concept_id} {authority}")
                continue
            authority_path = root / authority
            if not authority_path.is_file():
                errors.append(f"missing fidelity authority: {concept_id} {authority}")
                continue
            line_start = locator.get("lineStart")
            line_end = locator.get("lineEnd")
            line_count = len(
                authority_path.read_text(encoding="utf-8", errors="ignore").splitlines()
            )
            if (
                not isinstance(line_start, int)
                or not isinstance(line_end, int)
                or not (1 <= line_start <= line_end <= line_count)
            ):
                errors.append(
                    f"invalid fidelity authority locator: {concept_id} {authority}"
                )
            actual_digest = file_digest_cache.setdefault(
                authority_path, hashlib.sha256(authority_path.read_bytes()).hexdigest()
            )
            if actual_digest != locator.get("sourceDigestSha256"):
                errors.append(
                    f"stale fidelity authority digest: {concept_id} {authority}"
                )
    for locator, owners in locator_owners.items():
        if len(owners) > 1 and any(
            not str(row.get("sharedCoverageRationale", "")).strip() for row in owners
        ):
            errors.append(
                f"unexplained shared fidelity section: {locator[0]}#{locator[1]}"
            )
    return errors


def _git(root: Path, *args: str) -> str:
    """Run a fixed Git executable with repository-controlled arguments."""
    if GIT_EXECUTABLE is None:
        message = "git executable is unavailable"
        raise FileNotFoundError(message)
    return subprocess.run(  # noqa: S603
        [GIT_EXECUTABLE, *args],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout


# This function deliberately validates the complete cross-file legacy contract.
# pylint: disable=too-many-locals,too-many-branches,too-many-statements
def _check_legacy_coverage(
    root: Path,
    inventory: dict,
    inventory_pages: dict,
    ledger: dict,
    evidence_entries: dict,
    used_evidence: set[str],
) -> list[str]:
    errors: list[str] = []
    if inventory.get("schemaVersion") != INVENTORY_SCHEMA_VERSION:
        errors.append("inventory schema must be version 2")

    baseline = ledger.get("baseline", {})
    required_baseline = (
        "commit",
        "treeDigest",
        "corpusDigestSha256",
        "conceptDigestSha256",
        "pageCount",
        "conceptCount",
        "headingLevel",
    )
    errors.extend(
        f"legacy baseline field missing: {field}"
        for field in required_baseline
        if baseline.get(field) in (None, "")
    )
    expected = {
        "commit": LEGACY_COMMIT,
        "treeDigest": LEGACY_TREE,
        "pageCount": LEGACY_PAGE_COUNT,
        "conceptCount": LEGACY_CONCEPT_COUNT,
        "conceptDigestSha256": LEGACY_UNIT_DIGEST,
        "headingLevel": 2,
    }
    errors.extend(
        f"legacy baseline mismatch: {field}"
        for field, value in expected.items()
        if baseline.get(field) != value
    )
    if not (root / ".git").exists():
        errors.append("immutable legacy Git metadata is unavailable")
    else:
        try:
            observed_tree = _git(root, "rev-parse", f"{LEGACY_COMMIT}^{{tree}}").strip()
        except (OSError, subprocess.CalledProcessError):
            errors.append("immutable legacy commit is unavailable")
            observed_tree = None
        if observed_tree is not None and observed_tree != LEGACY_TREE:
            errors.append("legacy Git tree does not match immutable baseline")

    concepts = ledger.get("concepts", [])
    concept_ids = [item.get("id") for item in concepts]
    duplicates = sorted(
        concept_id
        for concept_id in set(concept_ids)
        if concept_id and concept_ids.count(concept_id) > 1
    )
    errors.extend(
        f"duplicate legacy concept id: {concept_id}" for concept_id in duplicates
    )
    known_concepts = {concept_id for concept_id in concept_ids if concept_id}
    ledger_digest = hashlib.sha256()
    for concept in sorted(
        concepts,
        key=lambda item: (str(item.get("legacyPath")), str(item.get("legacyHeading"))),
    ):
        ledger_digest.update(
            str(concept.get("legacyPath", "")).encode()
            + b"\0"
            + str(concept.get("legacyHeading", "")).encode()
            + b"\0"
            + str(concept.get("legacyBlob", "")).encode()
            + b"\n"
        )
    if ledger_digest.hexdigest() != baseline.get("conceptDigestSha256"):
        errors.append("legacy concept digest does not match baseline")
    if (root / ".git").exists():
        try:
            source_paths = _git(
                root,
                "ls-tree",
                "-r",
                "--name-only",
                LEGACY_COMMIT,
                "--",
                "docs/en",
                "docs/SYSTEM_PROMPT_GUIDE.md",
            ).splitlines()
            source_paths = [
                path for path in source_paths if path.endswith((".md", ".mdx"))
            ]
            source_units: set[tuple[str, str, str]] = set()
            corpus_digest = hashlib.sha256()
            for path in source_paths:
                blob = _git(root, "rev-parse", f"{LEGACY_COMMIT}:{path}").strip()
                text = _git(root, "show", f"{LEGACY_COMMIT}:{path}")
                corpus_digest.update(path.encode() + b"\0" + blob.encode() + b"\n")
                source_units.update(
                    (path, heading.strip(), blob)
                    for heading in re.findall(r"^## (?!#)(.+?)\s*$", text, re.MULTILINE)
                )
            ledger_units = {
                (
                    concept.get("legacyPath"),
                    concept.get("legacyHeading"),
                    concept.get("legacyBlob"),
                )
                for concept in concepts
            }
            if source_units != ledger_units:
                errors.append("legacy ledger does not match baseline H2 extraction")
            if corpus_digest.hexdigest() != baseline.get("corpusDigestSha256"):
                errors.append("legacy corpus digest does not match baseline")
        except (OSError, subprocess.CalledProcessError):
            errors.append("immutable legacy corpus extraction failed")
    known_sections = _known_sections(inventory_pages)
    required_fields = (
        "id",
        "legacyPath",
        "legacyHeading",
        "legacyBlob",
        "category",
        "readerQuestion",
        "knowledgeSummary",
        "disposition",
        "currentSourceAuthorities",
        "evidenceIdentifiers",
    )
    dispositions = {"retained", "corrected", "superseded"}
    for concept in concepts:
        concept_id = concept.get("id", "<missing>")
        errors.extend(
            f"legacy concept field missing: {concept_id} {field}"
            for field in required_fields
            if concept.get(field) in (None, "", [])
        )
        if (root / ".git").exists():
            errors.extend(
                f"legacy current authority does not exist: {concept_id} {authority}"
                for authority in concept.get("currentSourceAuthorities", [])
                if not (root / authority).exists()
            )
        summary = str(concept.get("knowledgeSummary", "")).strip()
        if re.fullmatch(r"Covers [^.]+ for [^.]+\.", summary):
            errors.append(f"generic legacy knowledge summary: {concept_id}")
        if concept.get("disposition") not in dispositions:
            errors.append(f"invalid legacy disposition: {concept_id}")
        if concept.get("disposition") != "superseded":
            errors.extend(
                f"legacy concept field missing: {concept_id} {field}"
                for field in ("destinationPage", "destinationHeading")
                if concept.get(field) in (None, "")
            )
        if (
            concept.get("disposition") in {"corrected", "superseded"}
            and not str(concept.get("rationale", "")).strip()
        ):
            errors.append(f"unexplained superseded or corrected concept: {concept_id}")
        if concept.get("disposition") == "superseded":
            if any(
                concept.get(field) not in (None, "")
                for field in ("destinationPage", "destinationHeading")
            ):
                errors.append(
                    f"superseded legacy concept has a reader destination: {concept_id}"
                )
        else:
            section = (
                f"{concept.get('destinationPage')}#{concept.get('destinationHeading')}"
            )
            if section not in known_sections:
                errors.append(f"stale legacy destination: {concept_id} {section}")
        errors.extend(
            f"legacy concept references unknown evidence: {concept_id} {evidence_id}"
            for evidence_id in concept.get("evidenceIdentifiers", [])
            if evidence_id not in evidence_entries
        )
        used_evidence.update(concept.get("evidenceIdentifiers", []))

    mapped: list[str] = []
    mapped_destination: dict[str, tuple[str, str]] = {}
    for path, page in inventory_pages.items():
        for heading in page.get("headings", []):
            for concept_id in heading.get("legacyConceptIds", []):
                mapped.append(concept_id)
                mapped_destination.setdefault(concept_id, (path, heading.get("text")))
    superseded_concepts = {
        concept.get("id")
        for concept in concepts
        if concept.get("disposition") == "superseded"
    }
    active_concepts = known_concepts - superseded_concepts
    errors.extend(
        f"unknown legacy concept id: {concept_id}"
        for concept_id in sorted(set(mapped) - known_concepts)
    )
    errors.extend(
        f"superseded legacy concept must not be mapped: {concept_id}"
        for concept_id in sorted(set(mapped) & superseded_concepts)
    )
    errors.extend(
        f"duplicate legacy concept mapping: {concept_id}"
        for concept_id in sorted({value for value in mapped if mapped.count(value) > 1})
    )
    errors.extend(
        f"unmapped legacy concept: {concept_id}"
        for concept_id in sorted(active_concepts - set(mapped))
    )
    for concept in concepts:
        concept_id = concept.get("id")
        if concept_id not in mapped_destination or concept_id in superseded_concepts:
            continue
        expected_destination = (
            concept.get("destinationPage"),
            concept.get("destinationHeading"),
        )
        if mapped_destination[concept_id] != expected_destination:
            errors.append(f"legacy destination mapping mismatch: {concept_id}")
    if baseline.get("conceptCount") != len(concepts):
        errors.append("legacy concept count does not match baseline")
    return errors


def _check_evidence(
    root: Path,
    manifest_path: Path,
    inventory_pages: dict,
    evidence_entries: dict,
    used_evidence: set[str],
) -> list[str]:
    errors = [
        f"missing evidence reference: {evidence_id}"
        for evidence_id in sorted(used_evidence)
        if evidence_id not in evidence_entries
    ]
    manifest_receipts: set[Path] = set()
    known_sections = _known_sections(inventory_pages)
    required_fields = (
        "receipt",
        "receiptSha256",
        "sourceDigest",
        "xcshVersion",
        "command",
        "exitStatus",
        "verificationLevel",
        "cleanupResult",
        "sections",
    )
    for evidence_id, entry in evidence_entries.items():
        if not evidence_id:
            errors.append("evidence entry has no id")
            continue
        errors.extend(
            f"evidence field missing: {evidence_id} {field}"
            for field in required_fields
            if field not in entry or entry[field] in ("", [], None)
        )
        receipt_value = entry.get("receipt")
        if receipt_value:
            receipt = root / receipt_value
            manifest_receipts.add(receipt.resolve())
            if not receipt.is_file():
                errors.append(
                    f"missing evidence receipt: {evidence_id} {receipt_value}"
                )
            else:
                digest = hashlib.sha256(receipt.read_bytes()).hexdigest()
                if digest != entry.get("receiptSha256"):
                    errors.append(f"receipt digest mismatch: {evidence_id}")
        errors.extend(
            f"evidence references unknown section: {evidence_id} {section}"
            for section in entry.get("sections", [])
            if section not in known_sections
        )
        if evidence_id not in used_evidence:
            errors.append(f"orphaned evidence reference: {evidence_id}")

    for receipt in sorted(manifest_path.parent.glob("*")):
        if receipt.name == "manifest.json" or not receipt.is_file():
            continue
        if receipt.resolve() not in manifest_receipts:
            errors.append(
                f"orphaned evidence receipt: {receipt.relative_to(root).as_posix()}"
            )
    return errors


def _check(root: Path) -> list[str]:
    inventory_path = root / ".github" / "docs-quality" / "inventory.json"
    manifest_path = root / ".github" / "docs-quality" / "evidence" / "manifest.json"
    legacy_path = root / ".github" / "docs-quality" / "legacy-concepts.json"
    fidelity_path = root / ".github" / "docs-quality" / "legacy-fidelity.json"
    try:
        inventory = _load_json(inventory_path)
        manifest = _load_json(manifest_path)
        ledger = _load_json(legacy_path)
    except ValueError as exc:
        return [str(exc)]
    initial_errors: list[str] = []
    try:
        fidelity = _load_json(fidelity_path)
    except ValueError as exc:
        fidelity = {}
        initial_errors.append(str(exc))

    pages = sorted((root / "docs" / "en").rglob("*.mdx"))
    inventory_pages = {entry.get("path"): entry for entry in inventory.get("pages", [])}
    actual_paths = {page.relative_to(root).as_posix() for page in pages}
    errors = [
        *initial_errors,
        *(
            f"page missing from inventory: {path}"
            for path in sorted(actual_paths - set(inventory_pages))
        ),
        *(
            f"inventory references missing page: {path}"
            for path in sorted(set(inventory_pages) - actual_paths)
        ),
    ]
    evidence_entries = {
        entry.get("id"): entry for entry in manifest.get("evidence", [])
    }
    used_evidence: set[str] = set()
    errors.extend(
        _check_legacy_coverage(
            root,
            inventory,
            inventory_pages,
            ledger,
            evidence_entries,
            used_evidence,
        )
    )
    errors.extend(_check_fidelity(root, fidelity, ledger, evidence_entries))
    errors.extend(_check_navigation_and_links(root, pages))
    paragraph_locations: dict[str, list[str]] = defaultdict(list)
    for page in pages:
        relative = page.relative_to(root).as_posix()
        errors.extend(
            _check_page(
                page,
                root,
                inventory_pages.get(relative),
                used_evidence,
                paragraph_locations,
            )
        )
    errors.extend(
        f"duplicate substantive prose in {', '.join(sorted(set(locations)))}"
        for locations in paragraph_locations.values()
        if len(set(locations)) > 1
    )
    errors.extend(
        _check_evidence(
            root, manifest_path, inventory_pages, evidence_entries, used_evidence
        )
    )
    return errors


def _main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    errors = _check(args.root.resolve())
    if errors:
        for error in errors:
            print(f"docs-quality: {error}", file=sys.stderr)
        return 1
    print("docs-quality: contract satisfied")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
