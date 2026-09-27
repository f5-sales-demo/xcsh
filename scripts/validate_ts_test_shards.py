#!/usr/bin/env python3
"""Fail closed unless every workspace test is assigned to exactly one shard."""
# ruff: noqa: EM101, EM102, TRY003

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / ".github" / "ts-test-shards.json"
EXPECTED_SHARDS = {"native-independent", "native-dependent"}


def load_json(path: Path) -> object:
    """Load one UTF-8 JSON document and identify malformed inputs."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(
            f"cannot read valid JSON from {path.relative_to(ROOT)}: {error}"
        ) from error


def main() -> None:
    """Compare the explicit shard manifest with package test scripts."""
    manifest = load_json(MANIFEST)
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 1:
        raise SystemExit("unsupported TypeScript test shard manifest schema")
    shards = manifest.get("shards")
    if not isinstance(shards, dict) or set(shards) != EXPECTED_SHARDS:
        raise SystemExit(
            f"TypeScript test shards must be exactly {sorted(EXPECTED_SHARDS)}"
        )

    classified: list[str] = []
    for shard, packages in shards.items():
        if (
            not isinstance(packages, list)
            or not packages
            or not all(isinstance(package, str) for package in packages)
        ):
            raise SystemExit(
                f"TypeScript test shard {shard!r} must contain package names"
            )
        classified.extend(packages)

    duplicates = sorted(
        package for package, count in Counter(classified).items() if count > 1
    )
    if duplicates:
        raise SystemExit(
            f"TypeScript test workspaces classified more than once: {duplicates}"
        )

    discovered: set[str] = set()
    for package_json in sorted((ROOT / "packages").glob("*/package.json")):
        package = load_json(package_json)
        if not isinstance(package, dict):
            raise SystemExit(
                f"workspace manifest must be an object: {package_json.relative_to(ROOT)}"
            )
        scripts = package.get("scripts")
        test = scripts.get("test") if isinstance(scripts, dict) else None
        if isinstance(test, str) and test:
            name = package.get("name")
            if not isinstance(name, str) or not name:
                raise SystemExit(
                    f"tested workspace has no package name: {package_json.relative_to(ROOT)}"
                )
            discovered.add(name)

    missing = sorted(discovered - set(classified))
    unexpected = sorted(set(classified) - discovered)
    if missing or unexpected:
        raise SystemExit(
            f"TypeScript test shard coverage mismatch; missing={missing}, unexpected={unexpected}"
        )
    print(
        f"validated {len(discovered)} TypeScript test workspaces across {len(shards)} shards"
    )


if __name__ == "__main__":
    main()
