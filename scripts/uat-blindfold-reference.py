# pylint: disable=invalid-name
# ruff: noqa: N999, ANN001, ANN002, ANN201, ANN202, D101, D102, D103, EM101, TRY003, PLR2004, S603, S607, S310, S101, PT018
import argparse
import base64
import gzip
import hashlib
import http.server
import json
import os
import pathlib
import re
import shlex
import ssl
import subprocess
import sys
import threading
import urllib.request
from typing import Any

import yaml
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

os.umask(0o077)
parser = argparse.ArgumentParser(
    description="Synthetic Ubuntu container-only vesctl interchangeability UAT"
)
parser.add_argument("--run-dir", type=pathlib.Path, required=True)
options = parser.parse_args()
if sys.flags.optimize:
    raise SystemExit("Reference assertions require Python without optimization")
if sys.platform != "linux":
    raise SystemExit("Reference acceptance requires Ubuntu containers")
ROOT = pathlib.Path(__file__).resolve().parent.parent
D = options.run_dir.resolve()
D.mkdir(mode=0o700)
if D.stat().st_mode & 0o077:
    raise SystemExit("Run directory must be private")
DOWNLOAD_URL = (
    "https://downloads.volterra.io/releases/vesctl/0.2.47/vesctl.linux-amd64.gz"
)
with urllib.request.urlopen(DOWNLOAD_URL, timeout=60) as download:
    BINARY = gzip.decompress(download.read())
assert (
    hashlib.sha256(BINARY).hexdigest()
    == "35d29e517498feff9f12a41ff702e90f10a1cc8a20c589c3e524474dbfe53801"
)
(D / "vesctl-0.2.47").write_bytes(BINARY)
(D / "vesctl-0.2.47").chmod(0o700)
subprocess.run(
    [
        "docker",
        "pull",
        "kreynoldsf5/vesctl@sha256:6ef8dc145b53130273bca4d3400ff9349e057ae36ed8e36d943eb1465e7edd82",
    ],
    check=True,
    stdout=subprocess.DEVNULL,
)
IMAGE = "kreynoldsf5/vesctl@sha256:6ef8dc145b53130273bca4d3400ff9349e057ae36ed8e36d943eb1465e7edd82"
synthetic = json.loads(
    (ROOT / "packages/natives/test/fixtures/blindfold-synthetic.json").read_text()
)
k = serialization.load_pem_private_key(
    base64.b64decode(synthetic["rsa-key.pem"]), None
).private_numbers()
public_numbers = k.public_numbers


def b64(n: int) -> str:
    return base64.b64encode(n.to_bytes((n.bit_length() + 7) // 8, "big")).decode()


pub = {
    "data": {
        "tenant": "example-tenant",
        "key_version": 1,
        "modulus_base64": b64(public_numbers.n),
        "public_exponent_base64": b64(public_numbers.e),
    }
}
policy = {
    "data": {
        "tenant": "example-tenant",
        "policy_id": "101",
        "namespace": "shared",
        "name": "ves-io-allow-volterra",
    }
}
(D / "secret").write_bytes(bytes(range(256)) * 8)
for name, obj in [("pub", pub), ("policy", policy)]:
    (D / name).write_text(json.dumps(obj))
subprocess.run(
    [
        "openssl",
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        str(D / "client.key"),
        "-out",
        str(D / "client.pem"),
        "-days",
        "2",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    check=True,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
paths: list[str] = []


def recover(raw):
    at = 0

    def take(n):
        nonlocal at
        assert n >= 0 and at + n <= len(raw)
        value = raw[at : at + n]
        at += n
        return value

    def lp():
        return take(int.from_bytes(take(4), "big"))

    assert lp() == b"example-tenant"
    assert int.from_bytes(take(4), "big") == 1
    assert int.from_bytes(take(8), "big") == 101
    assert take(1) == b"\x02"
    exponent = int.from_bytes(lp(), "big")
    modulus = int.from_bytes(lp(), "big")
    assert exponent == public_numbers.e and modulus == public_numbers.n
    wrapped = int.from_bytes(lp(), "big")
    private = pow(exponent * (2 * 101 + (1 << 31) + 1), -1, (k.p - 1) * (k.q - 1))
    block = pow(wrapped, private, modulus).to_bytes(
        (modulus.bit_length() + 7) // 8 - 2, "big"
    )
    assert block[:4] == bytes.fromhex("deadbeef")
    return AESGCM(block[16:48]).decrypt(block[4:16], raw[at:], None)


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        paths.append(self.path)
        body = json.dumps(pub if "get_public_key" in self.path else policy).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(D / "client.pem", D / "client.key")
server.socket = ctx.wrap_socket(server.socket, server_side=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
receipt: dict[str, Any] = {
    "image": IMAGE,
    "binary_sha256": hashlib.sha256(BINARY).hexdigest(),
    "reference": {},
}
bridge = D / "xcsh-bridge.ts"
bridge.write_text(
    "import { parseBlindfoldCli } from "
    + json.dumps(str(ROOT / "packages/coding-agent/src/commands/blindfold-args.ts"))
    + ";\nimport { BlindfoldService } from "
    + json.dumps(str(ROOT / "packages/coding-agent/src/services/blindfold.ts"))
    + ';\nconst args=parseBlindfoldCli(process.argv.slice(3),process.argv[2]==="request",false);\nconst service=new BlindfoldService({env:{XCSH_API_URL:"https://example-tenant.test",XCSH_API_TOKEN:"synthetic"},emit:s=>process.stdout.write(s),fetch:async (url,init)=>fetch('
    + json.dumps(f"https://localhost:{server.server_port}")
    + "+new URL(url).pathname+new URL(url).search,{...init,tls:{ca:await Bun.file("
    + json.dumps(str(D / "client.pem"))
    + ").text()}})});\nawait service.run(args);\n"
)


def xcsh(name, argv):
    r = subprocess.run(
        ["bun", str(bridge), *argv], capture_output=True, cwd=D, timeout=60, check=False
    )
    assert r.returncode == 0, name + ": " + r.stderr.decode()
    assert not r.stderr, name
    return r.stdout


(D / "xcsh-pub").write_bytes(xcsh("public", ["request", "secrets", "get-public-key"]))
(D / "xcsh-policy").write_bytes(
    xcsh(
        "policy",
        [
            "request",
            "secrets",
            "get-policy-document",
            "--namespace",
            "shared",
            "--name",
            "ves-io-allow-volterra",
        ],
    )
)

for version, entry in [
    ("historical", "/opt/vesctl"),
    ("0.2.47", "/fixture/vesctl-0.2.47"),
]:
    reference_records: list[dict[str, Any]] = []
    records = reference_records

    def run(
        name,
        args,
        online=False,
        entry=entry,
        records=None,
        version=version,
        sink=(records,),
    ):
        if records is None:
            records = sink[0]
        extra = (
            [
                "--server-urls",
                f"https://localhost:{server.server_port}/api",
                "--cert",
                "file:///fixture/client.pem",
                "--key",
                "file:///fixture/client.key",
                "--cacert",
                "file:///fixture/client.pem",
            ]
            if online
            else []
        )
        r = subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                "host" if online else "none",
                "-v",
                str(D) + ":/fixture",
                "--entrypoint",
                entry,
                IMAGE,
                *args,
                *extra,
            ],
            capture_output=True,
            timeout=60,
            check=False,
        )
        records.append(
            {
                "name": name,
                "args": args,
                "exit": r.returncode,
                "stdout": r.stdout.decode(errors="replace"),
                "stderr": r.stderr.decode(errors="replace"),
                "paths": paths.copy() if online else [],
            }
        )
        paths.clear()
        print(version, name, "exit", r.returncode, flush=True)
        return r

    for args in [
        ["version"],
        ["--help"],
        ["request", "--help"],
        ["request", "secrets", "--help"],
        ["request", "secrets", "get-public-key", "--help"],
        ["request", "secrets", "get-policy-document", "--help"],
        ["request", "secrets", "encrypt", "--help"],
    ]:
        run("help-" + str(len(records)), args)
    for suffix in [
        [],
        ["--outfmt", "json"],
        ["--outfmt", "yaml"],
        ["--key-version", "7"],
        ["--key-version", "0"],
    ]:
        r = run(
            "public-" + str(len(records)),
            ["request", "secrets", "get-public-key", *suffix],
            True,
        )
        if not suffix:
            (D / (version + "-pub")).write_bytes(r.stdout)
    for suffix in [[], ["--outfmt", "json"], ["--outfmt", "yaml"]]:
        r = run(
            "policy-" + str(len(records)),
            [
                "request",
                "secrets",
                "get-policy-document",
                "--namespace",
                "shared",
                "--name",
                "ves-io-allow-volterra",
                *suffix,
            ],
            True,
        )
        if not suffix:
            (D / (version + "-policy")).write_bytes(r.stdout)
    run(
        "policy-default",
        ["request", "secrets", "get-policy-document", "--name", "custom"],
        True,
    )
    run("policy-missing-name", ["request", "secrets", "get-policy-document"], True)
    for producer in ["native", version]:
        pf = "/fixture/pub" if producer == "native" else "/fixture/" + version + "-pub"
        sf = (
            "/fixture/policy"
            if producer == "native"
            else "/fixture/" + version + "-policy"
        )
        for suffix in [
            [],
            ["--outfmt", "json"],
            ["--outfmt", "yaml"],
            ["--outfile", "/fixture/" + version + "-raw"],
        ]:
            r = run(
                "encrypt-" + producer + "-" + str(len(records)),
                [
                    "request",
                    "secrets",
                    "encrypt",
                    "--public-key",
                    pf,
                    "--policy-document",
                    sf,
                    "/fixture/secret",
                    *suffix,
                ],
            )
            if not suffix:
                (D / (version + "-" + producer + "-cipher")).write_bytes(r.stdout)
    raw = D / (version + "-raw")
    if raw.exists():
        records.append(
            {
                "name": "binary-outfile",
                "bytes": raw.stat().st_size,
                "prefix_hex": raw.read_bytes()[:40].hex(),
                "sha256": hashlib.sha256(raw.read_bytes()).hexdigest(),
            }
        )
    receipt["reference"][version] = records
    for pk_producer in [version, "xcsh"]:
        for policy_producer in [version, "xcsh"]:
            pf = "/fixture/" + pk_producer + "-pub"
            sf = "/fixture/" + policy_producer + "-policy"
            for consumer in [version, "xcsh"]:
                av = [
                    "request",
                    "secrets",
                    "encrypt",
                    "--public-key",
                    pf,
                    "--policy-document",
                    sf,
                    "/fixture/secret",
                ]
                if consumer == version:
                    r = run("matrix-" + pk_producer + "-" + policy_producer, av)
                    assert r.returncode == 0 and not r.stderr
                    cipher = r.stdout.strip().splitlines()[-1]
                else:
                    av = [
                        str(D / x.removeprefix("/fixture/"))
                        if x.startswith("/fixture/")
                        else x
                        for x in av
                    ]
                    cipher = xcsh("matrix", av).strip()
                    assert b"\n" not in cipher
                assert re.fullmatch(rb"[A-Za-z0-9+/]+=*", cipher)
                raw = base64.b64decode(cipher, validate=True)
                assert recover(raw) == (D / "secret").read_bytes()
                try:
                    recover(raw[:-1] + bytes([raw[-1] ^ 1]))
                except InvalidTag:
                    print("authenticated corruption rejected")
                else:
                    raise AssertionError("GCM corruption accepted")
    # Qualify reference consumption of JSON/YAML and exact known spellings.
    spellings = [(pub, policy)]
    camel_pub = yaml.safe_load((D / (version + "-pub")).read_text())
    camel_policy = yaml.safe_load((D / (version + "-policy")).read_text())
    spellings.append((camel_pub, camel_policy))
    spellings.append(
        (
            {"data": {**pub["data"], **camel_pub["data"]}},
            {"data": {**policy["data"], **camel_policy["data"]}},
        )
    )
    for spelling, (public_doc, policy_doc) in enumerate(spellings):
        for fmt in ["json", "yaml"]:
            encode = json.dumps if fmt == "json" else yaml.safe_dump
            (D / "variant-pub").write_text(encode(public_doc))
            (D / "variant-policy").write_text(encode(policy_doc))
            command = [
                "request",
                "secrets",
                "encrypt",
                "--public-key",
                "/fixture/variant-pub",
                "--policy-document",
                "/fixture/variant-policy",
                "/fixture/secret",
            ]
            result = run("variant-" + str(spelling) + "-" + fmt, command)
            assert result.returncode == 0
            assert not result.stderr
            assert (
                recover(
                    base64.b64decode(
                        result.stdout.strip().splitlines()[-1], validate=True
                    )
                )
                == (D / "secret").read_bytes()
            )
    (D / "variant-pub").write_text(
        json.dumps({"data": {**camel_pub["data"], "key_version": 2}})
    )
    run(
        "conflicting-alias-observation",
        [
            "request",
            "secrets",
            "encrypt",
            "--public-key",
            "/fixture/variant-pub",
            "--policy-document",
            "/fixture/variant-policy",
            "/fixture/secret",
        ],
    )
    # Independently qualify raw outfile through the same decoder.
    assert recover((D / (version + "-raw")).read_bytes()) == (D / "secret").read_bytes()

# Exact frozen three commands, with only the executable changed to the bridge.
wrapper = D / "xcsh"
wrapper.write_text("#!/bin/sh\nexec bun " + shlex.quote(str(bridge)) + ' "$@"\n')
wrapper.chmod(0o700)
(D / "certs").mkdir()
pipeline = (
    "set -euo pipefail\n"
    + shlex.quote(str(wrapper))
    + " request secrets get-public-key > pubkey\n"
    + shlex.quote(str(wrapper))
    + " request secrets get-policy-document --namespace shared --name ves-io-allow-volterra > policy\n"
    + shlex.quote(str(wrapper))
    + " request secrets encrypt --policy-document policy --public-key pubkey "
    + shlex.quote(str(D / "secret"))
    + " | tail -1 > certs/key.blindfold\n"
)
subprocess.run(["bash", "-c", pipeline], cwd=D, check=True, timeout=60)
value = (D / "certs/key.blindfold").read_text().strip()
assert not value.startswith("string:///")
assert recover(base64.b64decode(value, validate=True)) == (D / "secret").read_bytes()
assert ("string:///" + value).count("string:///") == 1
server.shutdown()
(D / "observations.json").write_text(json.dumps(receipt, indent=2) + "\n")
summary = {
    "image": IMAGE,
    "binary_sha256": receipt["binary_sha256"],
    "matrix_cases": 16,
    "reference_format_cases": 12,
    "independent_recovery": True,
    "authenticated_integrity": True,
    "binary_outfile": True,
    "article_pipeline": True,
    "synthetic_credentials_only": True,
    "offline_containers_network": "none",
}
(D / "receipt.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary))
