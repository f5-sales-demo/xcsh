#!/usr/bin/env python3
"""Enforce the xcsh documentation purpose and evidence contract."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
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
    try:
        inventory = _load_json(inventory_path)
        manifest = _load_json(manifest_path)
    except ValueError as exc:
        return [str(exc)]

    pages = sorted((root / "docs" / "en").rglob("*.mdx"))
    inventory_pages = {entry.get("path"): entry for entry in inventory.get("pages", [])}
    actual_paths = {page.relative_to(root).as_posix() for page in pages}
    errors = [
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
