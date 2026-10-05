# ruff: noqa: INP001, T201
"""Offline, development-only MiniLM candidate evaluation with pinned inputs."""

import argparse
import hashlib
import json
import math
import time
from pathlib import Path


def digest(path: Path) -> str:
    """Hash input bytes without loading a large vector artifact into memory."""
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


# Digest validation keeps each distinct provenance boundary visible.
# pylint: disable=too-many-locals
def validate_inputs(
    corpus_path: Path,
    lexical_path: Path,
    suite_path: Path,
    receipt_path: Path,
    vectors_path: Path,
    model_path: Path,
    preparation_path: Path,
) -> tuple[dict, dict, dict]:
    """Reject drift, exposed qualification data, and unknown destinations."""
    corpus = json.loads(corpus_path.read_text())
    lexical = json.loads(lexical_path.read_text())
    receipt = json.loads(receipt_path.read_text())
    preparation = json.loads(preparation_path.read_text())
    if not lexical.get("development_only"):
        message = "Only explicitly marked development inputs are accepted"
        raise ValueError(message)
    if (suite_path.parent / "eligibility.json").exists():
        message = "Qualification suites require a separate qualified harness"
        raise ValueError(message)
    if digest(suite_path) != lexical["suite_sha256"]:
        message = "Lexical input does not match the development suite"
        raise ValueError(message)
    if digest(corpus_path) != receipt["corpus_sha256"]:
        message = "Corpus digest mismatch"
        raise ValueError(message)
    if digest(vectors_path) != receipt["vector_sha256"]:
        message = "Vector digest mismatch"
        raise ValueError(message)
    if corpus["source_commit"] != receipt["source_commit"]:
        message = "Corpus source revision mismatch"
        raise ValueError(message)
    if receipt["model_revision"] != preparation["model_revision"]["revision"]:
        message = "Model revision mismatch"
        raise ValueError(message)
    for artifact in preparation["model_files"]:
        filename, expected = artifact["path"], artifact["sha256"]
        target = model_path / filename
        if not target.resolve().is_relative_to(model_path.resolve()):
            message = "Unsafe model manifest path"
            raise ValueError(message)
        if digest(target) != expected:
            message = "Model file digest mismatch: " + filename
            raise ValueError(message)
    raw_suite = json.loads(suite_path.read_text())
    suite = raw_suite.get("cases", []) if isinstance(raw_suite, dict) else raw_suite
    cases = lexical["cases"]
    if len(cases) != len(suite):
        message = "Development case count mismatch"
        raise ValueError(message)
    rows = corpus["destinations"]
    destinations = {
        "xcsh://terraform-documentation/" + row["path"] + "#" + row["anchor"]
        for row in rows
    }
    for case, expected in zip(cases, suite, strict=True):
        if any(case[key] != expected[key] for key in ("prompt", "kind", "expected")):
            message = "Development prompt or labels mismatch"
            raise ValueError(message)
        if case["kind"] == "answerable" and any(
            "#schema-" in uri and uri not in destinations for uri in case["expected"]
        ):
            message = "Expected destination is absent from pinned corpus"
            raise ValueError(message)
    return corpus, lexical, receipt


def destination_hits(destinations: list[str], expected: list[str]) -> tuple[bool, bool]:
    """Top-five recall counts only the first five actual ranked destinations."""
    return bool(destinations and destinations[0] in expected), any(
        uri in expected for uri in destinations[:5]
    )


def main() -> None:
    """Measure candidate embedding/fusion only; never certify qualification."""
    parser = argparse.ArgumentParser(description=__doc__)
    for name in (
        "corpus",
        "lexical",
        "suite",
        "receipt",
        "vectors",
        "model",
        "preparation",
        "output",
    ):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--property-only", action="store_true")
    parser.add_argument("--query-prefix", default="")
    args = parser.parse_args()
    corpus, lexical, receipt = validate_inputs(
        args.corpus,
        args.lexical,
        args.suite,
        args.receipt,
        args.vectors,
        args.model,
        args.preparation,
    )
    # Validate provenance before loading optional model dependencies.
    # pylint: disable=import-outside-toplevel
    import numpy as np  # noqa: PLC0415
    import torch  # noqa: PLC0415
    from hybrid_ranking import fuse_rankings  # noqa: PLC0415
    from sentence_transformers import SentenceTransformer  # noqa: PLC0415
    # pylint: enable=import-outside-toplevel

    torch.set_num_threads(4)
    rows = corpus["destinations"]
    vectors = np.load(args.vectors, allow_pickle=False)
    if (
        vectors.shape != (len(rows), receipt["dimensions"])
        or not np.isfinite(vectors).all()
    ):
        message = "Invalid vector dimensions or values"
        raise ValueError(message)
    model = SentenceTransformer(str(args.model), local_files_only=True, device="cpu")
    uris = [
        "xcsh://terraform-documentation/" + row["path"] + "#" + row["anchor"]
        for row in rows
    ]
    uri_set = set(uris)
    results = []
    all_times = []
    for case in lexical["cases"]:
        subset = [
            i
            for i, row in enumerate(rows)
            if (not case.get("role") or row["provider_type"] == case["role"])
            and (not case.get("provider") or row["provider_name"] == case["provider"])
        ]
        matrix = np.ascontiguousarray(vectors[subset])
        timings, embedding, ranking = [], [], []
        prior = None
        for _repeat in range(5):
            before = time.perf_counter()
            query = model.encode(
                args.query_prefix + case["prompt"],
                normalize_embeddings=True,
                convert_to_numpy=True,
            )
            query /= np.linalg.norm(query)
            embedded = time.perf_counter()
            order = np.argsort(-(matrix @ query), kind="stable")[:100]
            semantic = [uris[subset[i]] for i in order]
            lexical_destinations = case["destinations"]
            if args.property_only:
                lexical_destinations = [
                    uri for uri in lexical_destinations if uri in uri_set
                ]
            ranked = fuse_rankings(lexical_destinations, semantic)
            destinations = [uri for uri, _score in ranked]
            if prior is not None and ranked != prior:
                message = "Non-deterministic candidate ranking"
                raise ValueError(message)
            prior = ranked
            end = time.perf_counter()
            timings.append((end - before) * 1000)
            embedding.append((embedded - before) * 1000)
            ranking.append((end - embedded) * 1000)
        all_times.extend(timings)
        top1, top5 = destination_hits(destinations, case["expected"])
        results.append(
            {
                "id": case["id"],
                "kind": case["kind"],
                "destinations": destinations,
                "ranked": ranked,
                "top1": top1,
                "top5": top5,
                "embedding_ms": embedding,
                "ranking_fusion_ms": ranking,
                "semantic_route_ms": timings,
                "lexical_precomputed_ms": case["lexical_ms"],
            }
        )
    answerable = [row for row in results if row["kind"] == "answerable"]
    report = {
        "development_only": True,
        "property_only": args.property_only,
        "query_prefix": args.query_prefix,
        "qualification_passed": False,
        "production_imported": False,
        "source_commit": corpus["source_commit"],
        "corpus_sha256": receipt["corpus_sha256"],
        "vector_sha256": receipt["vector_sha256"],
        "suite_sha256": lexical["suite_sha256"],
        "evaluator_sha256": digest(Path(__file__)),
        "lexical_sha256": digest(args.lexical),
        "expected_outside_property_corpus": [
            case["id"]
            for case in lexical["cases"]
            if case["kind"] == "answerable"
            and not set(case["expected"]).issubset(uri_set)
        ],
        "answerable": len(answerable),
        "top1": sum(row["top1"] for row in answerable),
        "top5": sum(row["top5"] for row in answerable),
        "semantic_route_p95_ms": sorted(all_times)[
            math.ceil(len(all_times) * 0.95) - 1
        ],
        "limitations": [
            "Lexical precomputed separately; no complete response latency qualification.",
            "Candidate ranking only; no confidence selection or prerequisite rendering.",
            "Local offline embedding runtime, not bundled production dependency.",
        ],
        "results": results,
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "results"}))


if __name__ == "__main__":
    main()
