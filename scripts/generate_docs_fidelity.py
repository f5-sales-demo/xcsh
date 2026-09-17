#!/usr/bin/env python3
# ruff: noqa: D103, EM102, PLR2004, RET504, S105, TRY003
"""Generate attributable legacy-fidelity blocks and their verification ledger."""

from __future__ import annotations

import hashlib
import json
import re
import textwrap
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
START = '<span data-fidelity-generated="start"></span>'
END = '<span data-fidelity-generated="end"></span>'
OLD_START = "<!-- fidelity-generated:start -->"
OLD_END = "<!-- fidelity-generated:end -->"
JSX_START = "{/* fidelity-generated:start */}"
JSX_END = "{/* fidelity-generated:end */}"
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
MDX_TRANSLATION: dict[int, str] = {
    ord("<"): "\u2039",
    ord(">"): "\u203a",
    ord("{"): "\uff5b",
    ord("}"): "\uff5d",
    ord("&"): "\uff06",
}


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def slug(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value).casefold()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value


def mdx_text(value: str) -> str:
    return value.translate(MDX_TRANSLATION)


def clean_summary(concept: dict) -> str:
    summary = re.sub(r"\s+", " ", concept["knowledgeSummary"]).strip()
    parts = re.split(r"(?<=[.!?])\s+", summary)
    if len(parts) > 1 and parts[0].startswith("Covers "):
        parts = parts[1:]
    summary = " ".join(parts)
    summary = re.sub(
        r"^(?:Primary implementation|Key integration points):?\s*", "", summary
    )
    summary = re.sub(
        r"^(?:Primary implementation|Key integration points)\s+", "", summary
    )
    summary = summary.replace(
        "Key interfaces include", "Current implementation points include"
    )
    summary = summary.replace(
        "Relevant interfaces include", "Current implementation points include"
    )
    # The source inventory intentionally condenses legacy lists. Do not publish list markers or
    # introductory colons after their list items have been removed; both read like truncated prose.
    summary = re.sub(r":\s+(?=[A-Z][A-Za-z -]+:)", ". ", summary)
    summary = re.sub(r":\s*[0-9]+\.\s*", ". ", summary)
    summary = re.sub(r":\s*(?=Current implementation points include)", ". ", summary)
    summary = re.sub(r"\s+", " ", summary).strip()
    summary = summary.replace(" url ", " URL ")
    summary = re.sub(r"\buri\b", "URI", summary, flags=re.IGNORECASE)
    summary = mdx_text(summary.replace("`", ""))
    if summary:
        summary = summary[0].upper() + summary[1:]
        terminology = {
            "Xcsh": "xcsh",
            "javascript": "JavaScript",
            "latex": "LaTeX",
            "sdk": "SDK",
            "typescript": "TypeScript",
        }
        for source, replacement in terminology.items():
            summary = re.sub(rf"\b{source}\b", replacement, summary)
    if not summary:
        summary = concept["readerQuestion"].rstrip("?") + "."
    if concept["disposition"] in {"corrected", "superseded"}:
        summary += " " + concept["rationale"].strip()
    return summary


def concept_block(concept: dict) -> str:
    concept_id = concept["id"]
    label = mdx_text(concept["legacyHeading"].rstrip(".").replace("`", ""))
    content = textwrap.fill(
        clean_summary(concept),
        width=180,
        break_long_words=False,
        break_on_hyphens=False,
    )
    return (
        f'<p id="fidelity-{concept_id}" data-fidelity="{concept_id}">'
        f"<strong>{label}.</strong> {content}</p>"
    )


def strip_generated(text: str) -> str:
    for start, end in ((START, END), (OLD_START, OLD_END), (JSX_START, JSX_END)):
        pattern = rf"\n?{re.escape(start)}.*?{re.escape(end)}\n?"
        text = re.sub(pattern, "\n", text, flags=re.DOTALL)
    return text


def inject_blocks(path: Path, grouped: dict[str, list[dict]]) -> dict[str, str]:
    text = strip_generated(path.read_text(encoding="utf-8"))
    block_values: dict[str, str] = {}
    for heading, concepts in grouped.items():
        heading_match = re.search(rf"^## {re.escape(heading)}\s*$", text, re.MULTILINE)
        if heading_match is None:
            raise ValueError(f"missing destination heading: {path}#{heading}")
        next_heading = re.search(r"^## ", text[heading_match.end() :], re.MULTILINE)
        section_end = (
            heading_match.end() + next_heading.start()
            if next_heading is not None
            else len(text)
        )
        insertion_marker = f'<span data-fidelity-insertion="{heading}"></span>'
        marker_at = text.find(insertion_marker, heading_match.end(), section_end)
        insert_at = marker_at if marker_at >= 0 else section_end
        rendered = []
        for concept in concepts:
            block = concept_block(concept)
            block_values[concept["id"]] = block
            rendered.append(block)
        generated = f"\n\n{START}\n\n" + "\n\n".join(rendered) + f"\n\n{END}\n\n"
        text = text[:insert_at].rstrip() + generated + text[insert_at:].lstrip("\n")
    path.write_text(text.rstrip() + "\n", encoding="utf-8")
    return block_values


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


def sync_navigation_metadata(legacy: dict) -> None:
    for concept in legacy["concepts"]:
        if (
            concept["destinationPage"] == "docs/en/index.mdx"
            and concept["destinationHeading"]
            in {"Where should I start?", "Run the quickstart"}
        ):
            concept["destinationHeading"] = "Explore by goal"
    LEGACY_PATH.write_text(json.dumps(legacy, indent=2) + "\n", encoding="utf-8")

    inventory = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
    inventory["pages"] = [
        page
        for page in inventory["pages"]
        if page["path"] != "docs/en/getting-started/installation.mdx"
    ]
    homepage = next(
        page for page in inventory["pages"] if page["path"] == "docs/en/index.mdx"
    )
    legacy_ids = [
        concept["id"]
        for concept in legacy["concepts"]
        if concept["destinationPage"] == "docs/en/index.mdx"
    ]
    evidence = homepage["evidence"]
    if "installed-release" not in evidence:
        evidence.append("installed-release")
    homepage["headings"] = [
        {
            "text": "Install xcsh",
            "readerQuestion": "How do I install xcsh on macOS or Linux?",
            "purpose": "Provide the default copyable installation path beside the product introduction.",
            "evidence": evidence,
            "legacyConceptIds": [],
        },
        {
            "text": "What xcsh helps you do",
            "readerQuestion": "What can xcsh help me accomplish?",
            "purpose": "Explain terminal work, reviewable F5 workflows, and extensible automation before setup choices.",
            "evidence": evidence,
            "legacyConceptIds": [],
        },
        {
            "text": "Installation options",
            "readerQuestion": "Which installation channel fits my platform and lifecycle?",
            "purpose": "Present platform and package alternatives, including channel-specific upgrades and removal.",
            "evidence": evidence,
            "legacyConceptIds": [],
        },
        {
            "text": "Verify installation",
            "readerQuestion": "How do I prove which xcsh installation is active?",
            "purpose": "Detect PATH and channel conflicts before configuration.",
            "evidence": evidence,
            "legacyConceptIds": [],
        },
        {
            "text": "Authenticate a provider",
            "readerQuestion": "How do I authenticate a model provider safely?",
            "purpose": "Route readers to provider authentication before their first prompt.",
            "evidence": evidence,
            "legacyConceptIds": [],
        },
        {
            "text": "Quickstart",
            "readerQuestion": "How do I run a bounded first prompt?",
            "purpose": "Prove the executable and model route without tools or persistence.",
            "evidence": evidence,
            "legacyConceptIds": [],
        },
        {
            "text": "Explore by goal",
            "readerQuestion": "Where should I go after xcsh is working?",
            "purpose": "Route readers to task-oriented documentation and catalog context.",
            "evidence": evidence,
            "legacyConceptIds": legacy_ids,
        },
    ]
    INVENTORY_PATH.write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8")

    manifest = json.loads(EVIDENCE_MANIFEST_PATH.read_text(encoding="utf-8"))
    section_replacements = {
        "docs/en/getting-started/installation.mdx": "docs/en/index.mdx",
        "docs/en/getting-started/installation.mdx#How do I install on Ubuntu or Debian?": "docs/en/index.mdx#Installation options",
        "docs/en/getting-started/installation.mdx#How do I confirm the selected executable?": "docs/en/index.mdx#Verify installation",
        "docs/en/getting-started/installation.mdx#How do I remove it?": "docs/en/index.mdx#Installation options",
        "docs/en/index.mdx#Verify the active installation": "docs/en/index.mdx#Verify installation",
        "docs/en/index.mdx#Where should I start?": "docs/en/index.mdx#Explore by goal",
        "docs/en/index.mdx#Run the quickstart": "docs/en/index.mdx#Explore by goal",
    }
    for evidence in manifest["evidence"]:
        evidence["sections"] = list(
            dict.fromkeys(
                section_replacements.get(section, section)
                for section in evidence["sections"]
            )
        )
    EVIDENCE_MANIFEST_PATH.write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )


def main() -> None:
    legacy = json.loads(LEGACY_PATH.read_text(encoding="utf-8"))
    sync_navigation_metadata(legacy)
    grouped: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for concept in legacy["concepts"]:
        grouped[concept["destinationPage"]][concept["destinationHeading"]].append(
            concept
        )

    blocks: dict[str, str] = {}
    for relative, headings in grouped.items():
        blocks.update(inject_blocks(ROOT / relative, headings))

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
        claims[status] = [clean_summary(concept)]
        row = {
            "id": concept["id"],
            "legacyUnitDigestSha256": legacy_unit_digest(concept),
            "destinationPage": concept["destinationPage"],
            "destinationHeading": concept["destinationHeading"],
            "contentBlockLocator": f"fidelity-{concept['id']}",
            "destinationDigestSha256": digest_bytes(blocks[concept["id"]].encode()),
            "claims": claims,
            "authorityLocators": locators,
            "evidenceIdentifiers": concept["evidenceIdentifiers"],
        }
        if status != "preserved":
            row["rationale"] = concept["rationale"]
        rows.append(row)

    fidelity = {
        "schemaVersion": 1,
        "legacyCommit": legacy["baseline"]["commit"],
        "legacyTree": legacy["baseline"]["treeDigest"],
        "conceptCount": len(rows),
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
