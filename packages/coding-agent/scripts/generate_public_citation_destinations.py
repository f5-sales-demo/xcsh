# ruff: noqa: INP001
"""Generate public citation destinations from verified release assets and saved sitemap bytes.

Usage: python3 packages/coding-agent/scripts/generate_public_citation_destinations.py
       --evidence-root /path/to/qmd-resume-evidence
The evidence root contains sources/{content,provider,api} and assessment/source-receipts.json.
"""

import argparse
import collections
import gzip
import hashlib
import json
import pathlib
import re
import sqlite3
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

parser = argparse.ArgumentParser(
    description="Generate verified public citation destinations from pinned offline inputs"
)
parser.add_argument("--evidence-root", type=pathlib.Path, required=True)
args = parser.parse_args()
root = args.evidence_root
repo = pathlib.Path(__file__).resolve().parents[3]
receipts = json.loads((root / "assessment/source-receipts.json").read_text())
SITEMAP_NAMESPACE = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
ARCHIVE_EXPANSION_ERROR = "API archive expanded payload exceeds limit"


def sitemap(file: pathlib.Path) -> tuple[set[str], str]:
    """Read a bounded saved publication sitemap without XML entities or a DTD."""
    xml_bytes = file.read_bytes()
    if (
        len(xml_bytes) > 10 * 1024 * 1024
        or b"<!DOCTYPE" in xml_bytes.upper()
        or b"<!ENTITY" in xml_bytes.upper()
    ):
        xml_error = "unsafe or oversized publication sitemap"
        raise SystemExit(xml_error)
    root_xml = ET.fromstring(xml_bytes)  # noqa: S314 - bounded, DTD and entities rejected above
    urls = {
        x.text for x in root_xml.iter(SITEMAP_NAMESPACE + "loc") if x.text is not None
    }
    return urls, hashlib.sha256(xml_bytes).hexdigest()


provider_sitemap, provider_sitemap_digest = sitemap(
    root / "sources/provider/sitemap-0.xml"
)
api_sitemap, api_sitemap_digest = sitemap(root / "sources/api/sitemap-0.xml")
provider = json.loads((root / "sources/provider/manifest.json").read_text())
provider_paths = {}
for row in provider["documents"]:
    p = row["path"]
    if not p.startswith("documentation/") or not p.endswith("/index.md"):
        raise SystemExit("unsafe provider path " + p)
    url = (
        "https://f5-sales-demo.github.io/terraform-provider-xcsh/"
        + p[len("documentation/") : -len("index.md")]
    )
    if url not in provider_sitemap:
        raise SystemExit("unpublished provider path " + url)
    machine = row["metadata"].get("source_url")
    expected = (
        "https://f5-sales-demo.github.io/terraform-provider-xcsh/_data/pages/"
        + p[len("documentation/") : -len("index.md")]
        + "index.txt"
    )
    if machine is not None and machine != expected:
        raise SystemExit("provider source mapping mismatch " + p)
    provider_paths[p] = row["metadata"].get("summary") or p.split("/")[-2]
# The generated SQLite contains the verified original title and URL, with no source media bytes.
gzip_path = repo / (
    "packages/coding-agent/src/internal-urls/.documentation-generated/"
    "documentation-index.sqlite.gz"
)
with tempfile.NamedTemporaryFile(suffix=".sqlite") as tmp:
    with gzip.open(gzip_path, "rb") as f:
        while b := f.read(1024 * 1024):
            tmp.write(b)
    tmp.flush()
    db = sqlite3.connect(tmp.name)
    general = {
        f"{s}/{p}": {"title": t, "url": u}
        for s, p, t, u in db.execute(
            "SELECT source,stable_path,title,original_url FROM documentation_documents"
        )
    }
    for source, route, target_source, target in db.execute(
        "SELECT source,stable_path,target_source,target_stable_path FROM documentation_routes"
    ):
        general[f"{source}/{route}"] = general[f"{target_source}/{target}"]
    db.close()
manifest = json.loads((root / "sources/content/manifest.json").read_text())
if len(general) != len(manifest["documents"]) + len(manifest.get("enrichment", {}).get("aliases", [])):
    GENERAL_COUNT_ERROR = "general document count mismatch"
    raise SystemExit(GENERAL_COUNT_ERROR)
for row in manifest["documents"]:
    key = row["sourceId"] + "/" + row["path"].split("/", 2)[2].removesuffix("/index.md")
    if general.get(key, {}).get("url") != row["url"]:
        raise SystemExit("general source URL mismatch " + key)
api_domains = {}
spec_operations = collections.defaultdict(set)


def norm(api_path: str) -> str:
    """Normalize only the published metadata path placeholders."""
    return re.sub(
        r"\{(?:metadata|system_metadata)\.(namespace|name)\}", r"{\1}", api_path
    )


api_zip = root / ("sources/api/f5xc-api-specs-" + receipts["api"]["tag"] + ".zip")
ARCHIVE_DIGEST = hashlib.sha256(api_zip.read_bytes()).hexdigest()
if receipts["api"]["assets"][api_zip.name]["sha256"] != ARCHIVE_DIGEST:
    ARCHIVE_DIGEST_ERROR = (
        "API source archive digest disagrees with the publication receipt"
    )
    raise SystemExit(ARCHIVE_DIGEST_ERROR)
with zipfile.ZipFile(api_zip) as z:
    names: set[str] = set()
    EXPANDED_BYTES = 0
    member_hashes: list[str] = []
    for member in z.infolist():
        name = member.filename
        invalid_path = not name or name.startswith("/") or "\\" in name or "%" in name
        invalid_segments = any(part in ("", ".", "..") for part in name.split("/"))
        duplicate_or_oversized = name in names or member.file_size > 64 * 1024 * 1024
        if invalid_path or invalid_segments or duplicate_or_oversized:
            raise SystemExit(
                "unsafe, duplicate, or oversized API archive member: " + name
            )
        names.add(name)
        EXPANDED_BYTES += member.file_size
        if EXPANDED_BYTES > 512 * 1024 * 1024:
            raise SystemExit(ARCHIVE_EXPANSION_ERROR)
        payload = z.read(member)
        if len(payload) != member.file_size:
            raise SystemExit("API archive member size mismatch: " + name)
        member_hashes.append(name + "\0" + hashlib.sha256(payload).hexdigest() + "\n")
    idx = json.loads(z.read("index.json"))
    for e in idx["specifications"]:
        doc = json.loads(z.read("domains/" + e["file"]))
        url = doc["info"].get("x-f5xc-api-reference-url")
        if url not in api_sitemap:
            raise SystemExit("unpublished API reference " + str(url))
        api_domains[e["domain"]] = {"title": e["title"], "url": url}
        for path, methods in doc["paths"].items():
            for method, op in methods.items():
                if (
                    method.lower()
                    not in ("get", "post", "put", "patch", "delete", "head", "options")
                    or not isinstance(op, dict)
                    or not op.get("operationId")
                ):
                    continue
                key = json.dumps(
                    [method.upper(), norm(path), op["operationId"]],
                    separators=(",", ":"),
                )
                spec_operations[key].add(e["domain"])
api_catalog = json.loads((root / "sources/api/api-catalog.json").read_text())
api_operations = {}
api_categories = {}
ambiguous = []
for category in api_catalog["categories"]:
    domains = set()
    for op in category["operations"]:
        key = json.dumps(
            [op["method"].upper(), norm(op["path"]), op["operationId"]],
            separators=(",", ":"),
        )
        owners = spec_operations.get(key, set())
        if len(owners) == 1:
            owner = next(iter(owners))
            api_operations[key] = owner
            domains.add(owner)
        elif len(owners) > 1:
            ambiguous.append(
                {
                    "category": category["name"],
                    "key": json.loads(key),
                    "domains": sorted(owners),
                }
            )
        else:
            raise SystemExit("unmapped API operation " + key)
    if len(domains) == 1 and all(
        len(
            spec_operations[
                json.dumps(
                    [o["method"].upper(), norm(o["path"]), o["operationId"]],
                    separators=(",", ":"),
                )
            ]
        )
        == 1
        for o in category["operations"]
    ):
        api_categories[category["name"]] = next(iter(domains))
source = {
    "general": {
        "version": receipts["content"]["tag"],
        "digest": receipts["content"]["assets"]["html-to-markdown-content.tar.gz"][
            "sha256"
        ],
    },
    "terraform": {
        "version": receipts["provider"]["tag"],
        "digest": receipts["provider"]["assets"]["canonical-documentation.tar.gz"][
            "sha256"
        ],
    },
    "api": {
        "version": receipts["api"]["tag"],
        "digest": receipts["api"]["assets"][api_zip.name]["sha256"],
    },
}
target = (
    repo
    / "packages/coding-agent/src/internal-urls/public-citation-destinations.generated.ts"
)
parts = [
    "// Generated from verified release manifests and published sitemaps. Do not edit.",
    "export const PUBLIC_CITATION_SOURCES = "
    + json.dumps(source, separators=(",", ":"), ensure_ascii=False)
    + " as const;",
]
for name, data in [
    ("GENERAL_PUBLIC_DOCUMENTS", general),
    ("TERRAFORM_PUBLIC_DOCUMENTS", provider_paths),
    ("API_PUBLIC_DOMAINS", api_domains),
    ("API_PUBLIC_OPERATIONS", api_operations),
    ("API_PUBLIC_CATEGORIES", api_categories),
]:
    parts.append(
        "export const "
        + name
        + ": Readonly<Record<string, "
        + (
            "string"
            if name
            in (
                "TERRAFORM_PUBLIC_DOCUMENTS",
                "API_PUBLIC_OPERATIONS",
                "API_PUBLIC_CATEGORIES",
            )
            else "{ title: string; url: string }"
        )
        + ">> = "
        + json.dumps(data, separators=(",", ":"), ensure_ascii=False, sort_keys=True)
        + ";"
    )
target.write_text("\n".join(parts) + "\n")
audit = {
    "provider_sitemap_sha256": provider_sitemap_digest,
    "api_sitemap_sha256": api_sitemap_digest,
    "provider_page_count": len(provider_paths),
    "general_page_count": len(general),
    "api_domain_count": len(api_domains),
    "api_operations_unique": len(api_operations),
    "api_operations_ambiguous": len(ambiguous),
    "api_categories_unique": len(api_categories),
    "ambiguous_operations": ambiguous,
    "source": source,
    "api_archive_member_count": len(names),
    "api_archive_member_tree_sha256": hashlib.sha256(
        "".join(sorted(member_hashes)).encode()
    ).hexdigest(),
}
(root / "assessment/public-url-mapping-audit.json").write_text(
    json.dumps(audit, indent=2, sort_keys=True) + "\n"
)
summary = {
    key: audit[key]
    for key in (
        "provider_page_count",
        "general_page_count",
        "api_domain_count",
        "api_operations_unique",
        "api_operations_ambiguous",
        "api_categories_unique",
    )
}
sys.stdout.write(f"{json.dumps(summary)} generated_bytes={target.stat().st_size}\n")
