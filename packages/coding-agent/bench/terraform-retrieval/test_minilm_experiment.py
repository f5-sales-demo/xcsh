# ruff: noqa: INP001, PT027
"""Check experiment provenance without downloading or executing a model."""

import json
import tempfile
import unittest
from pathlib import Path

from minilm_experiment import digest, validate_inputs


class MiniLMInputTests(unittest.TestCase):
    """Reject corrupted artifacts and qualification-suite reuse."""

    def test_drift_and_qualification_inputs_fail_closed(self) -> None:
        """A valid fixture succeeds before independently corrupting each boundary."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = root / "model"
            model.mkdir()
            (model / "weights").write_bytes(b"synthetic weights")
            uri = "xcsh://terraform-documentation/documentation/resources/example/index.md#schema-name"
            case = {
                "prompt": "Terraform example name",
                "kind": "answerable",
                "expected": [uri],
            }
            files = {
                "corpus": {
                    "source_commit": "synthetic",
                    "destinations": [
                        {
                            "path": "documentation/resources/example/index.md",
                            "anchor": "schema-name",
                        }
                    ],
                },
                "suite": {"cases": [case]},
            }
            for name, value in files.items():
                (root / name).write_text(json.dumps(value))
            (root / "vectors").write_bytes(b"synthetic vectors")
            (root / "lexical").write_text(
                json.dumps(
                    {
                        "development_only": True,
                        "suite_sha256": digest(root / "suite"),
                        "cases": [case],
                    }
                )
            )
            receipt = {
                "corpus_sha256": digest(root / "corpus"),
                "vector_sha256": digest(root / "vectors"),
                "source_commit": "synthetic",
                "model_revision": "pinned",
            }
            (root / "receipt").write_text(json.dumps(receipt))
            (root / "preparation").write_text(
                json.dumps(
                    {
                        "model_revision": {"revision": "pinned"},
                        "model_files": [
                            {"path": "weights", "sha256": digest(model / "weights")}
                        ],
                    }
                )
            )
            args = tuple(
                root / name
                for name in (
                    "corpus",
                    "lexical",
                    "suite",
                    "receipt",
                    "vectors",
                    "model",
                    "preparation",
                )
            )
            validate_inputs(*args)
            for target in (
                root / "corpus",
                root / "suite",
                root / "vectors",
                model / "weights",
            ):
                original = target.read_bytes()
                target.write_bytes(original + b" ")
                with self.assertRaises(ValueError):
                    validate_inputs(*args)
                target.write_bytes(original)
            (root / "eligibility.json").write_text("{}")
            with self.assertRaisesRegex(ValueError, "Qualification suites"):
                validate_inputs(*args)


if __name__ == "__main__":
    unittest.main()
