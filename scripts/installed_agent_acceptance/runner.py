"""Run the matrix against one fingerprinted installed executable."""

from __future__ import annotations

import argparse
import os
import pathlib
import platform
import shutil
import subprocess

from .common import NEGATIVE_SCENARIOS, SCENARIOS, digest, fail, write_json
from .credentials import check_live_token, load_enabled_credential
from .scenarios import RunOptions, ScenarioRun


def main() -> int:
    """Run selected scenarios against one fingerprinted executable."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", required=True, type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument("--backend", required=True, choices=("deterministic", "live"))
    parser.add_argument("--scenario", action="append", choices=SCENARIOS)
    parser.add_argument(
        "--credential-store",
        type=pathlib.Path,
        help="read-only store for one enabled live subscription credential",
    )
    parser.add_argument(
        "--artifact-origin",
        choices=("published", "local-build", "unverified"),
        default="unverified",
    )
    args = parser.parse_args()
    if not args.executable.is_absolute() or not os.access(args.executable, os.X_OK):
        parser.error("--executable must be an absolute executable path")
    if args.output.exists():
        parser.error("--output must be a new directory; retain failed runs")
    with args.executable.open("rb") as binary:
        if binary.read(4) not in (
            b"\x7fELF",
            b"\xcf\xfa\xed\xfe",
            b"\xfe\xed\xfa\xcf",
            b"\xca\xfe\xba\xbe",
            b"\xbe\xba\xfe\xca",
        ):
            parser.error("--executable must be the actual ELF or Mach-O executable")
    os.umask(0o077)
    args.output.mkdir(parents=True, mode=0o700)
    (args.output / "receipts").mkdir()
    (args.output / "private").mkdir()
    version = subprocess.run(  # noqa: S603 - validated actual executable path, no shell
        [str(args.executable), "--version"],
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    ).stdout.strip()
    fingerprint = {
        "executable": str(args.executable.resolve()),
        "version": version,
        "sha256": digest(args.executable),
        "host": platform.node(),
        "platform": platform.system(),
        "architecture": platform.machine(),
        "artifactOrigin": args.artifact_origin,
    }
    token = (
        os.environ.get("OPENAI_CODEX_OAUTH_TOKEN") if args.backend == "live" else None
    )
    if args.backend == "live":
        if args.credential_store:
            if token:
                fail("choose one in-memory credential source")
            token = load_enabled_credential(args.credential_store)
        check_live_token(token)
    tls = args.output / "private/tls"
    tls.mkdir()
    openssl = shutil.which("openssl")
    if openssl is None:
        fail("openssl is required for loopback TLS fixtures")
    result = subprocess.run(  # noqa: S603 - resolved OpenSSL path and fixed fixture arguments, no shell
        [
            openssl,
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-keyout",
            str(tls / "key.pem"),
            "-out",
            str(tls / "certificate.pem"),
            "-subj",
            "/CN=127.0.0.1",
            "-addext",
            "subjectAltName=IP:127.0.0.1",
        ],
        capture_output=True,
        check=False,
    )
    if result.returncode:
        fail("loopback TLS fixture certificate generation failed")
    selected = [
        s
        for s in (args.scenario or SCENARIOS)
        if args.backend != "live" or s not in NEGATIVE_SCENARIOS
    ]
    if len(set(selected)) != len(selected) or not selected:
        parser.error("select distinct scenarios supported by this backend")
    options = RunOptions(
        args.executable, args.output, args.backend, fingerprint, tls, token
    )
    receipts = []
    for scenario in selected:
        if args.backend == "live" and scenario in NEGATIVE_SCENARIOS:
            continue
        for repetition in range(1, 3 if args.backend == "live" else 2):
            receipt = ScenarioRun(options, scenario, repetition).execute()
            receipts.append(receipt)
            print(
                scenario + " " + str(repetition) + ": " + receipt["result"], flush=True
            )
            if receipt["result"] != "pass":
                break
    passed = bool(receipts) and all(r["result"] == "pass" for r in receipts)
    write_json(
        args.output / "receipts/summary.json",
        {
            "result": "pass" if passed else "fail",
            "backend": args.backend,
            "scenarios": selected,
            "runs": len(receipts),
            "requiredConsecutivePasses": 2 if args.backend == "live" else 1,
            "fingerprint": fingerprint,
            "completeMatrix": set(selected)
            == set(
                SCENARIOS
                if args.backend == "deterministic"
                else [s for s in SCENARIOS if s not in NEGATIVE_SCENARIOS]
            ),
        },
    )
    return 0 if passed else 1
