# pylint: disable=invalid-name,too-many-locals,too-many-branches,too-many-statements
# ruff: noqa: ANN001, ANN201, ANN202, D103, EM101, TRY003, PLR2004, S603, S607, S310, N999
"""Accept an installed xcsh Blindfold workflow using only fresh run-owned resources."""

import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import socket
import ssl
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", required=True, type=Path)
    parser.add_argument("--run-dir", required=True, type=Path)
    parser.add_argument("--context", required=True)
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument("--retain-hours", type=int, default=0)
    args = parser.parse_args()
    if args.timeout < 1 or args.retain_hours < 0:
        parser.error("Timeout must be positive and retention nonnegative")
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", args.namespace):
        parser.error("Namespace must be a valid approved resource label")
    os.umask(0o077)
    root = args.run_dir.resolve()
    root.mkdir(mode=0o700)  # Never resume by inferring success from files.
    cli = str(args.executable.resolve(strict=True))
    env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(("XCSH_API_", "XCSH_CONTEXT_", "VES_"))
    }
    name = "xcsh-bf-4803-" + secrets.token_hex(6)
    domain = name + ".example.test"
    owner = {
        "name": name,
        "namespace": args.namespace,
        "expires_at": int(time.time()) + args.retain_hours * 3600,
        "retained": False,
        "resources": [],
    }
    ownership = root / "ownership.json"
    ownership.write_text(json.dumps(owner, indent=2))
    private_values = []

    def run(case, argv, stdin=None, execution_env=None):
        with (
            (root / (case + ".stdout")).open("wb") as out,
            (root / (case + ".stderr")).open("wb") as err,
        ):
            result = subprocess.run(
                [cli, *argv],
                cwd=root,
                env=execution_env or env,
                input=stdin,
                stdout=out,
                stderr=err,
                timeout=args.timeout,
                check=False,
            )
        if result.returncode:
            raise RuntimeError(case + " failed, exit " + str(result.returncode))
        return (root / (case + ".stdout")).read_bytes()

    def openssl(argv):
        subprocess.run(
            ["openssl", *argv],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )

    # Inspect a selected native context privately; assert native retrieval before resource writes.
    context = json.loads(
        run("context", ["context", "export", args.context, "--json", "--include-token"])
    )

    def find(value, key):
        if isinstance(value, list):
            for child in value:
                found = find(child, key)
                if found:
                    return found
        if isinstance(value, dict):
            if key in value:
                return value[key]
            for child in value.values():
                found = find(child, key)
                if found:
                    return found
        return None

    api = find(context, "apiUrl") or find(context, "api_url") or find(context, "url")
    token = (
        find(context, "apiToken")
        or find(context, "api_token")
        or find(context, "token")
    )
    if not api or not token:
        raise RuntimeError(
            "Selected native context did not expose private resource credential snapshot"
        )
    api = api.rstrip("/")
    private_values.append(token.encode())
    resource_env = {
        **env,
        "XCSH_API_URL": api,
        "XCSH_API_TOKEN": token,
        "XCSH_NAMESPACE": args.namespace,
    }
    run(
        "context-link",
        [
            "context",
            "link",
            "blindfold-4803",
            args.context,
            "--source",
            "local",
            "--json",
        ],
    )
    selected = ["--context-name", "blindfold-4803"]
    headers = {"Authorization": "APIToken " + token, "Content-Type": "application/json"}

    def get(kind):
        request = urllib.request.Request(
            api
            + "/api/config/namespaces/"
            + args.namespace
            + "/"
            + kind
            + "/"
            + name
            + ("?response_format=2" if kind == "certificates" else ""),
            headers=headers,
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            value = json.load(response)
            return value.get("replace_form") or value

    def absent(kind):
        try:
            get(kind)
        except urllib.error.HTTPError as error:
            return error.code == 404
        return False

    def verify(fingerprint):
        deadline = time.monotonic() + args.timeout
        trust = ssl.create_default_context(cafile=str(root / "ca.pem"))
        while time.monotonic() < deadline:
            data = get("http_loadbalancers")
            spec = data["spec"]
            (root / "lb-readback.json").write_text(json.dumps(data))
            for vip in spec.get("dns_info", []):
                ip = vip.get("ip_address")
                if not ip:
                    continue
                try:
                    with (
                        socket.create_connection((ip, 443), timeout=5) as raw,
                        trust.wrap_socket(raw, server_hostname=domain) as tls,
                    ):
                        peer = tls.getpeercert(binary_form=True)
                        if peer is None:
                            continue
                        actual = hashlib.sha256(peer).hexdigest()
                        tls.sendall(
                            (
                                "GET / HTTP/1.1\r\nHost: "
                                + domain
                                + "\r\nConnection: close\r\n\r\n"
                            ).encode()
                        )
                        response = b""
                        while chunk := tls.recv(16384):
                            response += chunk
                        if (
                            actual == fingerprint
                            and b"200 OK" in response.split(b"\r\n")[0]
                            and b"blindfold interchangeable" in response
                        ):
                            if (
                                "ready" not in str(spec.get("state", "")).lower()
                                or "valid"
                                not in str(spec.get("cert_state", "")).lower()
                            ):
                                continue
                            return {
                                "ca_trust": True,
                                "sni": True,
                                "fingerprint_match": True,
                                "https": 200,
                                "ready": True,
                                "certificate_valid": True,
                            }
                except OSError:
                    pass
            time.sleep(5)
        raise RuntimeError("Trusted HTTPS readiness acceptance timed out")

    receipt: dict[str, Any] = {
        "version": subprocess.check_output([cli, "--version"], text=True).strip(),
        "binary_sha256": hashlib.sha256(Path(cli).read_bytes()).hexdigest(),
        "host": os.uname().sysname,
        "checks": [],
        "cleanup": False,
    }
    try:
        if not absent("certificates") or not absent("http_loadbalancers"):
            raise RuntimeError("Fresh run resource collision")
        # Native context retrieval uses the article's operation and flags.
        (root / "pubkey").write_bytes(
            run("public", ["request", "secrets", "get-public-key"])
        )
        (root / "policy").write_bytes(
            run(
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
        (root / "pub.json").write_bytes(
            run(
                "public-json",
                ["blindfold", "public-key", "--output", "json", *selected],
            )
        )
        (root / "policy.yaml").write_bytes(
            run("policy-yaml", ["blindfold", "policy", "--output", "yaml", *selected])
        )
        openssl(
            [
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-keyout",
                str(root / "ca-key.pem"),
                "-out",
                str(root / "ca.pem"),
                "-days",
                "2",
                "-subj",
                "/CN=Blindfold UAT CA",
                "-addext",
                "basicConstraints=critical,CA:true",
            ]
        )
        (root / "leaf.cnf").write_text(
            "basicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:"
            + domain
            + "\n"
        )
        (root / "certs").mkdir()
        for generation in [1, 2]:
            key, leaf, csr = [
                root / (prefix + str(generation) + suffix)
                for prefix, suffix in [
                    ("input", ".pem"),
                    ("leaf", ".pem"),
                    ("leaf", ".csr"),
                ]
            ]
            openssl(
                [
                    "req",
                    "-new",
                    "-newkey",
                    "rsa:2048",
                    "-nodes",
                    "-keyout",
                    str(key),
                    "-out",
                    str(csr),
                    "-subj",
                    "/CN=" + domain,
                ]
            )
            openssl(
                [
                    "x509",
                    "-req",
                    "-in",
                    str(csr),
                    "-CA",
                    str(root / "ca.pem"),
                    "-CAkey",
                    str(root / "ca-key.pem"),
                    "-CAcreateserial",
                    "-days",
                    "1",
                    "-extfile",
                    str(root / "leaf.cnf"),
                    "-out",
                    str(leaf),
                ]
            )
            private_values.append(key.read_bytes())
            # argv-safe shell wrapper executes the exact frozen pipeline with tail -1.
            script = 'set -euo pipefail\n"$1" request secrets encrypt --policy-document policy --public-key pubkey "$2" | tail -1 > "$3"\n'
            target = root / "certs" / ("key" + str(generation) + ".blindfold")
            subprocess.run(
                ["bash", "-c", script, "blindfold-uat", cli, str(key), str(target)],
                cwd=root,
                env=env,
                check=True,
                timeout=args.timeout,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            value = target.read_text().strip()
            if not re.fullmatch(r"[A-Za-z0-9+/]+=*", value):
                raise RuntimeError("Article output is not bare base64")
            location = "string:///" + value
            private_values.extend([value.encode(), location.encode()])
            modern = run(
                "modern" + str(generation),
                [
                    "blindfold",
                    "encrypt",
                    "--public-key",
                    "pub.json",
                    "--policy-document",
                    "policy.yaml",
                    "-",
                ],
                key.read_bytes(),
            ).strip()
            if not modern.startswith(b"string:///"):
                raise RuntimeError("Canonical location output changed")
            private_values.append(modern)
            run(
                "report" + str(generation),
                [
                    "blindfold",
                    "encrypt",
                    "--public-key",
                    "pub.json",
                    "--policy-document",
                    "policy.yaml",
                    str(key),
                    "--json",
                ],
            )
            raw = "raw" + str(generation)
            if run(
                "raw" + str(generation),
                [
                    "request",
                    "secrets",
                    "encrypt",
                    "--public-key",
                    "pubkey",
                    "--policy-document",
                    "policy",
                    str(key),
                    "--outfile",
                    raw,
                ],
            ):
                raise RuntimeError("Binary outfile stdout is not empty")
            if (root / raw).stat().st_mode & 0o777 != 0o600:
                raise RuntimeError("Artifact permissions failed")
            chain = leaf.read_bytes() + (root / "ca.pem").read_bytes()
            cert = {
                "kind": "certificate",
                "metadata": {
                    "name": name,
                    "namespace": args.namespace,
                    "labels": {"xcsh-uat": "blindfold-4803"},
                },
                "spec": {
                    "certificate_url": "string:///" + base64.b64encode(chain).decode(),
                    "private_key": {"blindfold_secret_info": {"location": location}},
                },
            }
            manifest = root / ("certificate" + str(generation) + ".json")
            manifest.write_text(json.dumps(cert))
            if generation == 1:
                owner["resources"].append("certificates")
                ownership.write_text(json.dumps(owner, indent=2))
            run(
                "certificate" + str(generation),
                [
                    "create" if generation == 1 else "update",
                    "-f",
                    str(manifest),
                    "--output",
                    "json",
                ],
                execution_env=resource_env,
            )
            if (
                get("certificates")["spec"]["private_key"]["blindfold_secret_info"][
                    "location"
                ]
                != location
            ):
                raise RuntimeError("Named certificate readback mismatch")
            if generation == 1:
                lb = {
                    "kind": "http_loadbalancer",
                    "metadata": cert["metadata"],
                    "spec": {
                        "domains": [domain],
                        "https": {
                            "port": 443,
                            "tls_cert_params": {
                                "certificates": [
                                    {"name": name, "namespace": args.namespace}
                                ],
                                "no_mtls": {},
                                "tls_config": {"default_security": {}},
                            },
                            "http_redirect": False,
                            "enable_path_normalize": {},
                        },
                        "advertise_on_public_default_vip": {},
                        "routes": [
                            {
                                "direct_response_route": {
                                    "http_method": "ANY",
                                    "path": {"prefix": "/"},
                                    "route_direct_response": {
                                        "response_code": 200,
                                        "response_body": "blindfold interchangeable\n",
                                    },
                                }
                            }
                        ],
                        "default_route_pools": [],
                        "disable_waf": {},
                        "no_service_policies": {},
                        "disable_api_definition": {},
                        "disable_api_discovery": {},
                        "disable_bot_defense": {},
                        "disable_rate_limit": {},
                        "disable_ip_reputation": {},
                        "disable_malicious_user_detection": {},
                        "origin_pools": [],
                    },
                }
                (root / "lb.json").write_text(json.dumps(lb))
                owner["resources"].append("http_loadbalancers")
                ownership.write_text(json.dumps(owner, indent=2))
                run(
                    "lb-create",
                    ["create", "-f", "lb.json", "--output", "json"],
                    execution_env=resource_env,
                )
            fingerprint = hashlib.sha256(
                subprocess.check_output(
                    ["openssl", "x509", "-in", str(leaf), "-outform", "DER"]
                )
            ).hexdigest()
            receipt["checks"].append(
                {
                    "generation": generation,
                    "fingerprint": fingerprint,
                    **verify(fingerprint),
                }
            )
        if receipt["checks"][0]["fingerprint"] == receipt["checks"][1]["fingerprint"]:
            raise RuntimeError("Rotation did not change fingerprint")
        receipt["rotation"] = True
        receipt["article_pipeline"] = True
        # Public reports must exclude ciphertext, private keys and credential values.
        reports = b"".join(
            (root / (case + ".stdout")).read_bytes()
            for case in ["raw1", "raw2", "report1", "report2"]
        )
        if (
            any(value and value in reports for value in private_values)
            or b"BEGIN PRIVATE KEY" in reports
        ):
            raise RuntimeError("Public resource report containment failed")
        receipt["public_report_containment"] = True
    finally:
        if args.retain_hours and receipt.get("rotation"):
            owner["retained"] = True
        else:
            for kind in reversed(owner["resources"]):
                if not absent(kind):
                    run(
                        "delete-" + kind,
                        [
                            "delete",
                            "http_loadbalancer"
                            if kind == "http_loadbalancers"
                            else "certificate",
                            name,
                            "-n",
                            args.namespace,
                        ],
                        execution_env=resource_env,
                    )
                deadline = time.monotonic() + args.timeout
                while not absent(kind) and time.monotonic() < deadline:
                    time.sleep(2)
                if not absent(kind):
                    raise RuntimeError("Run-owned resource cleanup failed")
            receipt["cleanup"] = True
        owner["teardown"] = [
            [cli, "delete", "http_loadbalancer", name, "-n", args.namespace],
            [cli, "delete", "certificate", name, "-n", args.namespace],
        ]
        ownership.write_text(json.dumps(owner, indent=2))
        (root / "receipt.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
