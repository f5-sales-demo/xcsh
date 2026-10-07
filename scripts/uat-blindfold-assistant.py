# ruff: noqa: N999, S603, PLR2004, EM101, TRY003
"""Verify file-only assistant preparation and scan private provider/tool traces."""

import argparse
import json
import os
import subprocess
from pathlib import Path


def main() -> None:
    """Run two prompts on the installed executable after its live UAT."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--model", default="gpt-6-sol")
    parser.add_argument("--timeout", type=int, default=240)
    args = parser.parse_args()
    os.umask(0o077)
    root = args.run_dir.resolve(strict=True)
    env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(("XCSH_API_", "XCSH_CONTEXT_", "VES_"))
    }
    capture = root / "capture.ts"
    capture.write_text(
        "import {appendFileSync} from 'node:fs'; export default function(pi:any){const file=process.env.BLINDFOLD_CAPTURE_FILE; const save=(type:string,data:unknown)=>{if(file)appendFileSync(file,JSON.stringify({type,data})+'\\n',{mode:0o600})};pi.on('before_provider_request',(e:any)=>save('provider_request',e.payload));pi.on('tool_call',(e:any)=>save('tool_call',e));pi.on('tool_result',(e:any)=>save('tool_result',e));}"
    )
    cases = []
    for index in [1, 2]:
        output = root / ("assistant" + str(index) + ".blindfold")
        trace = root / ("assistant" + str(index) + ".capture.jsonl")
        if output.exists() or trace.exists():
            raise RuntimeError(
                "Assistant acceptance requires fresh output and trace files"
            )
        prompt = f"Use xcsh_blindfold to encrypt the file {root}/input{index}.pem offline with publicKey {root}/pub.json, policyDocument {root}/policy.yaml, and outputFile {output}. These are authorized private test fixtures. Do not read or echo private inputs or encrypted output. Return only public status and artifact path."
        argv = [
            str(args.executable.resolve(strict=True)),
            "-p",
            "--mode=json",
            "--no-session",
            "--no-memories",
            "--no-skills",
            "--no-rules",
            "--no-extensions",
            "--no-lsp",
            "--no-title",
            "--tools=xcsh_blindfold",
            "--model=" + args.model,
            "--thinking=low",
            "-e",
            str(capture),
            prompt,
        ]
        with (
            (root / ("assistant" + str(index) + ".stdout")).open("wb") as out,
            (root / ("assistant" + str(index) + ".stderr")).open("wb") as err,
        ):
            result = subprocess.run(
                argv,
                cwd=root,
                env={**env, "BLINDFOLD_CAPTURE_FILE": str(trace)},
                stdout=out,
                stderr=err,
                timeout=args.timeout,
                check=False,
            )
        if result.returncode:
            raise RuntimeError("Assistant invocation failed: " + str(result.returncode))
        events = [json.loads(line) for line in trace.read_text().splitlines()]
        results = [event["data"] for event in events if event["type"] == "tool_result"]
        if (
            not results
            or any(event.get("isError") for event in results)
            or not output.is_file()
        ):
            raise RuntimeError(
                "Assistant operation did not produce a successful tool result and artifact"
            )
        payload = output.read_bytes().strip()
        if (
            not payload.startswith(b"string:///")
            or output.stat().st_mode & 0o777 != 0o600
        ):
            raise RuntimeError("Assistant canonical artifact contract failed")
        private_key = (root / ("input" + str(index) + ".pem")).read_bytes()
        content = b"".join(
            (root / ("assistant" + str(index) + suffix)).read_bytes()
            for suffix in [".capture.jsonl", ".stdout", ".stderr"]
        )
        exported = json.loads((root / "context.stdout").read_text())
        tokens = [
            context["apiToken"].encode()
            for context in exported["contexts"]
            if context.get("apiToken")
        ]
        if (
            any(
                value and value in content
                for value in [payload, payload[10:], private_key, *tokens]
            )
            or b"BEGIN PRIVATE KEY" in content
        ):
            raise RuntimeError(
                "Assistant private provider/tool containment scan failed"
            )
        cases.append(
            {
                "case": index,
                "successful_tool_result": True,
                "secure_location_artifact": True,
                "provider_tool_scan": True,
            }
        )
    receipt = {"assistant_cases": cases, "containment": True}
    (root / "assistant-receipt.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
