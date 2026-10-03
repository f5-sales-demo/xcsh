# ruff: noqa: INP001, T201
"""Export canonical property destinations from a hash-pinned SQLite index."""

import argparse
import json
import sqlite3
from pathlib import Path

from minilm_experiment import digest


def main() -> None:
    """Preserve authoritative field descriptions and exact destination ordering."""
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("index", "pin", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    pin = json.loads(args.pin.read_text())
    if (
        pin["source_root"] != "documentation"
        or digest(args.index) != pin["index"]["sha256"]
    ):
        message = "Canonical source index digest mismatch"
        raise ValueError(message)
    if args.output.exists():
        message = "Refusing to replace an exported corpus"
        raise ValueError(message)
    with sqlite3.connect(
        args.index.resolve().as_uri() + "?mode=ro", uri=True
    ) as database:
        database.row_factory = sqlite3.Row
        rows = [
            dict(row)
            for row in database.execute(
                "SELECT anchor,description,path,provider_name,provider_type,schema_path "
                "FROM terraform_destinations ORDER BY provider_type,provider_name,schema_path"
            )
        ]
    if any(not row["path"].startswith("documentation/") for row in rows):
        message = "Unexpected non-canonical destination"
        raise ValueError(message)
    corpus = {
        "destinations": rows,
        "provider_version": pin["provider_version"],
        "source_commit": pin["source_commit"],
    }
    args.output.write_text(json.dumps(corpus, sort_keys=True) + "\n")
    print(
        json.dumps(
            {
                "development_only": True,
                "rows": len(rows),
                "corpus_sha256": digest(args.output),
                "index_sha256": pin["index"]["sha256"],
            }
        )
    )


if __name__ == "__main__":
    main()
