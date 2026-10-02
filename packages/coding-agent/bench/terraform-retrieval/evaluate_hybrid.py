# ruff: noqa: INP001, T201
import argparse
import hashlib
import json
import time
import urllib.request
from pathlib import Path

import numpy as np

parser = argparse.ArgumentParser(
    description="Development-only local lexical/semantic fusion experiment"
)
parser.add_argument("--cache", type=Path, required=True)
parser.add_argument("--corpus", type=Path, required=True)
parser.add_argument("--suite", type=Path, required=True)
parser.add_argument("--lexical", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
root = args.cache
corpus = args.corpus
index = json.loads(corpus.read_text())
by_id = {p["id"]: p for p in index["pages"]}
pages = []
seen = set()
for parent in index["pages"]:
    for section in parent.get("sections", []):
        key = (
            parent["provider_type"],
            parent["provider_name"],
            tuple(section["schema_path"]),
        )
        if key in seen:
            continue
        seen.add(key)
        pages.append(
            {
                **by_id[section["document_id"]],
                "schema_path": section["schema_path"],
                "description": section["description"],
                "aliases": section["aliases"],
                "anchor": section["anchor"],
            }
        )
fingerprint = hashlib.sha256(corpus.read_bytes()).hexdigest()
vector_path = root / ("published-passage-vectors-" + fingerprint + ".npy")
if vector_path.exists():
    vectors = np.load(vector_path)
else:
    values = []
    texts = [
        "search_document: "
        + p["provider_type"]
        + " xcsh_"
        + p["provider_name"]
        + " "
        + ".".join(p["schema_path"])
        + " "
        + p["description"]
        + " "
        + " ".join(p["aliases"])
        for p in pages
    ]
    for offset in range(0, len(texts), 128):
        req = urllib.request.Request(
            "http://127.0.0.1:11435/api/embed",
            json.dumps(
                {"model": "embeddinggemma:300m", "input": texts[offset : offset + 128]}
            ).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=300) as response:  # noqa: S310 - fixed loopback HTTP service
            values.extend(json.load(response)["embeddings"])
        if offset % 2048 == 0:
            print("embedded", offset, "of", len(texts), flush=True)
    vectors = np.asarray(values, dtype=np.float32)
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    np.save(vector_path, vectors)

suite = json.loads(args.suite.read_text())["cases"]


def embed(query: str) -> np.ndarray:
    """Embed a query through the fixed task-local loopback service."""
    req = urllib.request.Request(
        "http://127.0.0.1:11435/api/embed",
        json.dumps(
            {"model": "embeddinggemma:300m", "input": "search_query: " + query}
        ).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as response:  # noqa: S310 - fixed loopback HTTP service
        vector = np.asarray(json.load(response)["embeddings"][0], dtype=np.float32)
    return vector / np.linalg.norm(vector)


lexical = json.loads(args.lexical.read_text())
uri_to_index = {
    "xcsh://terraform-documentation/" + p["path"] + "#" + p["anchor"]: i
    for i, p in enumerate(pages)
}
results = []
for case_no, case in enumerate(suite):
    query = case["prompt"]
    name = lexical[case_no].get("provider")
    role = lexical[case_no]["role"]
    subset = [
        i
        for i, p in enumerate(pages)
        if p["provider_type"] == role and (not name or p["provider_name"] == name)
    ]
    lex = [
        (r["score"], uri_to_index[r["uri"]])
        for r in lexical[case_no]["ranked"]
        if r["uri"] in uri_to_index
    ]
    times = []
    embedding_times = []
    ranking_times = []
    ranked = []
    for _repeat in range(5):
        start = time.perf_counter()
        q = embed(query)
        embedded = time.perf_counter()
        embedding_times.append((embedded - start) * 1000)
        semantic = sorted(((float(vectors[i] @ q), i) for i in subset), reverse=True)
        score = {}
        for rank, (_, i) in enumerate(lex[:100]):
            score[i] = score.get(i, 0) + 1 / (20 + rank)
        for rank, (_, i) in enumerate(semantic[:100]):
            score[i] = score.get(i, 0) + 1 / (20 + rank)
        ordered = sorted(
            score, key=lambda i: (-score[i], pages[i]["path"], pages[i]["anchor"])
        )[:5]
        ranked = [
            {
                "uri": "xcsh://terraform-documentation/"
                + pages[i]["path"]
                + "#"
                + pages[i]["anchor"],
                "score": score[i],
            }
            for i in ordered
        ]
        ranking_times.append((time.perf_counter() - embedded) * 1000)
        times.append((time.perf_counter() - start) * 1000)
    results.append(
        {
            "prompt": query,
            "kind": case["kind"],
            "expected": case["expected"],
            "provider": name,
            "role": role,
            "top1": bool(ranked and ranked[0]["uri"] in case["expected"]),
            "top5": any(r["uri"] in case["expected"] for r in ranked),
            "times_ms": times,
            "embedding_times_ms": embedding_times,
            "ranking_times_ms": ranking_times,
            "ranked": ranked,
        }
    )
times = sorted(t for r in results for t in r["times_ms"])
embedding = sorted(t for r in results for t in r["embedding_times_ms"])
ranking = sorted(t for r in results for t in r["ranking_times_ms"])
report = {
    "embedding_p95_ms": embedding[int(np.ceil(len(embedding) * 0.95)) - 1],
    "ranking_p95_ms": ranking[int(np.ceil(len(ranking) * 0.95)) - 1],
    "development_only": True,
    "qualification_passed": False,
    "model": "embeddinggemma:300m",
    "corpus_sha256": fingerprint,
    "answerable": 14,
    "top1": sum(r["top1"] for r in results if r["kind"] == "answerable"),
    "top5": sum(r["top5"] for r in results if r["kind"] == "answerable"),
    "p95_ms": times[int(np.ceil(len(times) * 0.95)) - 1],
    "limitations": [
        "Vectors built from exact tagged v12.2.0 metadata; experiment only.",
        "24known development prompts; no held-out claim.",
        "Local embedding time included; no production route shipped.",
    ],
    "results": results,
}
args.output.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({k: v for k, v in report.items() if k != "results"}), flush=True)
