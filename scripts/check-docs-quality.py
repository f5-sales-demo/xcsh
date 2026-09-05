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


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read {path}: {exc}") from exc


def strip_frontmatter(text: str) -> str:
    if not text.startswith("---\n"):
        return text
    end = text.find("\n---\n", 4)
    return text[end + 5 :] if end >= 0 else text


def headings(text: str) -> list[str]:
    in_fence = False
    found: list[str] = []
    for line in strip_frontmatter(text).splitlines():
        if line.startswith("```"):
            in_fence = not in_fence
            continue
        match = None if in_fence else re.match(r"^#{2,6}\s+(.+?)\s*$", line)
        if match:
            found.append(re.sub(r"\s+#+$", "", match.group(1)).strip())
    return found


def prose_paragraphs(text: str) -> list[str]:
    body = strip_frontmatter(text)
    body = re.sub(r"```.*?```", "", body, flags=re.DOTALL)
    body = re.sub(r"<[^>]+>", " ", body)
    paragraphs: list[str] = []
    for paragraph in re.split(r"\n\s*\n", body):
        lines = [line for line in paragraph.splitlines() if not re.match(r"^\s*(#|[-*+] |\d+\. )", line)]
        normalized = re.sub(r"\s+", " ", " ".join(lines)).strip().casefold()
        if len(normalized) >= MIN_DUPLICATE_LENGTH:
            paragraphs.append(normalized)
    return paragraphs


def output_fences(text: str) -> int:
    return sum(
        1
        for language in re.findall(r"^```([^\s`]*)", strip_frontmatter(text), flags=re.MULTILINE)
        if language.casefold() in OUTPUT_LANGUAGES
    )


def check(root: Path) -> list[str]:
    errors: list[str] = []
    docs_root = root / "docs" / "en"
    inventory_path = root / ".github" / "docs-quality" / "inventory.json"
    manifest_path = root / ".github" / "docs-quality" / "evidence" / "manifest.json"
    try:
        inventory = load_json(inventory_path)
        manifest = load_json(manifest_path)
    except ValueError as exc:
        return [str(exc)]

    pages = sorted(docs_root.rglob("*.mdx"))
    inventory_pages = {entry.get("path"): entry for entry in inventory.get("pages", [])}
    actual_paths = {page.relative_to(root).as_posix() for page in pages}

    for path in sorted(actual_paths - set(inventory_pages)):
        errors.append(f"page missing from inventory: {path}")
    for path in sorted(set(inventory_pages) - actual_paths):
        errors.append(f"inventory references missing page: {path}")

    evidence_entries = {entry.get("id"): entry for entry in manifest.get("evidence", [])}
    used_evidence: set[str] = set()
    paragraph_locations: dict[str, list[str]] = defaultdict(list)

    for page in pages:
        relative = page.relative_to(root).as_posix()
        text = page.read_text(encoding="utf-8")
        lowered = text.casefold()
        for phrase in BOILERPLATE:
            if phrase in lowered:
                errors.append(f"known boilerplate in {relative}: {phrase}")
        for phrase in GENERIC_CLAIMS:
            if phrase in lowered:
                errors.append(f"unsupported generic claim in {relative}: {phrase}")
        for paragraph in prose_paragraphs(text):
            paragraph_locations[paragraph].append(relative)

        entry = inventory_pages.get(relative)
        if entry is None:
            continue
        for field in ("classification", "audience", "readerNeed", "purpose"):
            if not str(entry.get(field, "")).strip():
                errors.append(f"inventory page field missing: {relative} {field}")
        if not entry.get("sourceAuthority"):
            errors.append(f"source authority missing: {relative}")

        declared_headings = {item.get("text"): item for item in entry.get("headings", [])}
        actual_headings = headings(text)
        for heading in actual_headings:
            if heading not in declared_headings:
                errors.append(f"heading missing from inventory: {relative}#{heading}")
        for heading in sorted(set(declared_headings) - set(actual_headings)):
            errors.append(f"inventory references missing heading: {relative}#{heading}")
        for heading, heading_entry in declared_headings.items():
            for field in ("readerQuestion", "purpose"):
                if not str(heading_entry.get(field, "")).strip():
                    errors.append(f"inventory heading field missing: {relative}#{heading} {field}")
            used_evidence.update(heading_entry.get("evidence", []))
        page_evidence = entry.get("evidence", [])
        used_evidence.update(page_evidence)
        if output_fences(text) and not page_evidence:
            errors.append(f"output block has no evidence: {relative}")
        if any(re.search(r"\b(procedure|verify|verification|result|outcome)\b", h, re.I) for h in actual_headings):
            if not page_evidence:
                errors.append(f"procedure or outcome heading has no evidence: {relative}")

    for paragraph, locations in paragraph_locations.items():
        if len(set(locations)) > 1:
            errors.append(f"duplicate substantive prose in {', '.join(sorted(set(locations)))}")

    for evidence_id in sorted(used_evidence):
        if evidence_id not in evidence_entries:
            errors.append(f"missing evidence reference: {evidence_id}")

    evidence_root = manifest_path.parent
    manifest_receipts: set[Path] = set()
    known_sections: set[str] = set()
    for path, entry in inventory_pages.items():
        known_sections.add(path)
        known_sections.update(f"{path}#{heading.get('text')}" for heading in entry.get("headings", []))
    for evidence_id, entry in evidence_entries.items():
        if not evidence_id:
            errors.append("evidence entry has no id")
            continue
        for field in (
            "receipt",
            "receiptSha256",
            "sourceDigest",
            "xcshVersion",
            "command",
            "exitStatus",
            "verificationLevel",
            "cleanupResult",
            "sections",
        ):
            if field not in entry or entry[field] in ("", [], None):
                errors.append(f"evidence field missing: {evidence_id} {field}")
        receipt_value = entry.get("receipt")
        if receipt_value:
            receipt = root / receipt_value
            manifest_receipts.add(receipt.resolve())
            if not receipt.is_file():
                errors.append(f"missing evidence receipt: {evidence_id} {receipt_value}")
            else:
                digest = hashlib.sha256(receipt.read_bytes()).hexdigest()
                if digest != entry.get("receiptSha256"):
                    errors.append(f"receipt digest mismatch: {evidence_id}")
        for section in entry.get("sections", []):
            if section not in known_sections:
                errors.append(f"evidence references unknown section: {evidence_id} {section}")
        if evidence_id not in used_evidence:
            errors.append(f"orphaned evidence reference: {evidence_id}")

    for receipt in sorted(evidence_root.glob("*")):
        if receipt.name == "manifest.json" or not receipt.is_file():
            continue
        if receipt.resolve() not in manifest_receipts:
            errors.append(f"orphaned evidence receipt: {receipt.relative_to(root).as_posix()}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    errors = check(args.root.resolve())
    if errors:
        for error in errors:
            print(f"docs-quality: {error}", file=sys.stderr)
        return 1
    print("docs-quality: contract satisfied")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
