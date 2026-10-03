# ruff: noqa: INP001, T201
"""Build development vectors offline from verified model files and canonical destinations."""

import argparse
import json
import time
from pathlib import Path

from minilm_experiment import digest


def main() -> None:
    """Keep source bytes, input format, token coverage and runtime provenance."""
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("corpus", "preparation", "model", "output", "receipt"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.receipt.exists():
        message = "Refusing to replace an existing vector artifact or receipt"
        raise ValueError(message)
    preparation = json.loads(args.preparation.read_text())
    for artifact in preparation["model_files"]:
        filename, expected = artifact["path"], artifact["sha256"]
        target = args.model / filename
        if (
            not target.resolve().is_relative_to(args.model.resolve())
            or digest(target) != expected
        ):
            message = "Pinned model file mismatch"
            raise ValueError(message)
    corpus = json.loads(args.corpus.read_text())
    rows = corpus["destinations"]
    if any(not row["path"].startswith("documentation/") for row in rows):
        message = "Only canonical documentation destinations are accepted"
        raise ValueError(message)
    texts = [
        row["description"]
        + " "
        + row["provider_type"]
        + " "
        + row["provider_name"].replace("_", " ")
        + " "
        + row["schema_path"].replace(".", " ").replace("_", " ")
        for row in rows
    ]
    import numpy as np  # noqa: PLC0415
    import torch  # noqa: PLC0415
    from sentence_transformers import SentenceTransformer  # noqa: PLC0415

    torch.set_num_threads(4)
    model = SentenceTransformer(str(args.model), local_files_only=True, device="cpu")
    token_lengths = [
        len(ids) for ids in model.tokenizer(texts, truncation=False)["input_ids"]
    ]
    if max(token_lengths) > model.max_seq_length:
        message = "An input exceeds the pinned model sequence limit"
        raise ValueError(message)
    before = time.perf_counter()
    vectors = model.encode(
        texts,
        batch_size=128,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=True,
    ).astype(np.float32)
    with args.output.open("wb") as stream:
        np.save(stream, vectors, allow_pickle=False)
    receipt = {
        "development_only": True,
        "qualification_passed": False,
        "source_commit": corpus["source_commit"],
        "provider_version": corpus["provider_version"],
        "corpus_sha256": digest(args.corpus),
        "vector_sha256": digest(args.output),
        "rows": len(rows),
        "dimensions": vectors.shape[1],
        "vector_bytes": args.output.stat().st_size,
        "materialization_ms": (time.perf_counter() - before) * 1000,
        "model_revision": preparation["model_revision"]["revision"],
        "preparation_sha256": digest(args.preparation),
        "builder_sha256": digest(Path(__file__)),
        "input_format": "description role provider-name schema-path; underscores and dots become spaces",
        "max_tokens": max(token_lengths),
        "model_limit": model.max_seq_length,
        "over_model_limit": 0,
    }
    args.receipt.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
