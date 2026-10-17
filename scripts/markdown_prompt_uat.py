"""Run the Markdown prompt catalog without tools; keep raw responses private."""

import argparse
import json
import subprocess
from pathlib import Path
from typing import NoReturn


def fail(message: str) -> NoReturn:
    """Stop with a diagnostic that points to private evidence."""
    raise RuntimeError(message)


def main() -> None:
    """Run or resume the read-only prompt catalog and validate completed turns."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", default="xcsh")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument(
        "--catalog",
        default=str(
            Path(__file__).resolve().parents[1]
            / "packages/chat-ui/test/markdown/fixtures/synthesized.catalog.json"
        ),
    )
    args = parser.parse_args()
    root = Path(args.output_dir).resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    root.chmod(0o700)
    records = []
    for item in json.loads(Path(args.catalog).read_text()):
        event_path = root / f"{item['id']}.events.jsonl"
        if not event_path.exists():
            with (
                event_path.open("w") as out,
                (root / f"{item['id']}.stderr.txt").open("w") as err,
            ):
                result = subprocess.run(  # noqa: S603 - executable is explicitly selected by the operator.
                    [
                        args.executable,
                        "--print",
                        "--mode",
                        "json",
                        "--no-tools",
                        "--no-session",
                        "--no-memories",
                        "--no-title",
                        "--no-extensions",
                        "--no-skills",
                        "--no-rules",
                        "--no-lsp",
                        item["prompt"],
                    ],
                    cwd=root,
                    stdout=out,
                    stderr=err,
                    timeout=600,
                    check=False,
                )
                if result.returncode:
                    fail(
                        f"{item['id']} exited {result.returncode}; private stderr: {root}"
                    )
        events = [
            json.loads(line)
            for line in event_path.read_text().splitlines()
            if line.strip()
        ]
        messages = [
            event["message"]
            for event in events
            if event.get("type") == "message_end"
            and event.get("message", {}).get("role") == "assistant"
        ]
        if not messages:
            fail(f"{item['id']} has no completed assistant response")
        if any(
            part.get("type") == "toolCall"
            for message in messages
            for part in message.get("content", [])
        ):
            fail(f"{item['id']} unexpectedly requested a tool")
        message = messages[-1]
        if message.get("stopReason") != "stop":
            fail(f"{item['id']} did not stop normally")
        markdown = "\n".join(
            part["text"]
            for part in message.get("content", [])
            if part.get("type") == "text"
        )
        (root / f"{item['id']}.md").write_text(markdown)
        records.append(
            {
                "id": item["id"],
                "provider": message.get("provider"),
                "model": message.get("model"),
                "stop_reason": message.get("stopReason"),
                "tools": 0,
                "characters": len(markdown),
            }
        )
        (root / "responses.json").write_text(json.dumps(records, indent=2) + "\n")
        print(
            f"{item['id']}: completed; {len(markdown)} Markdown characters", flush=True
        )


if __name__ == "__main__":
    main()
