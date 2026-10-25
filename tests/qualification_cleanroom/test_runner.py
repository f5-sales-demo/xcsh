"""Adversarial qualification checks: no replay, stale promotion, or false success."""

import contextlib
import hashlib
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import observer
import pytest
import runner


@contextlib.contextmanager
def temporary_workspace():
    """Let unittest cleanup own the lifetime of a temporary workspace."""
    with tempfile.TemporaryDirectory() as directory:
        yield directory


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.base = pathlib.Path(self.enterContext(temporary_workspace())).resolve()
        self.source = self.base / "source"
        self.source.mkdir()
        (self.source / "catalog.json").write_text('{"immutable": true}')
        self.binary = self.base / "binary"
        self.binary.write_text("test candidate")
        self.candidate = {
            "commit": "a" * 40,
            "sha256": runner.digest(self.binary),
            "executable": str(self.binary),
        }
        gates = [
            {"id": "core." + str(i), "requirement": "retained", "status": "verified"}
            for i in range(34)
        ]
        plugins = [
            {
                "plugin": "p" + str(p),
                "gates": [
                    {
                        "id": f"plugin.{p}.{g}",
                        "requirement": "retained",
                        "status": "verified",
                    }
                    for g in range(13)
                ],
            }
            for p in range(23)
        ]
        self.ledger = self.base / "ledger.json"
        runner.write(self.ledger, {"gates": gates, "marketplace": plugins})
        self.evidence = self.base / "result.json"
        runner.write(self.evidence, {"state": "ONLINE", "success": True})
        self.spec = {
            "candidate": self.candidate,
            "sources": {"marketplace": str(self.source)},
            "adapters": {},
            "effectiveConfiguration": {
                "model": "frozen-test-model",
                "voice": "frozen-test-voice",
            },
            "workspace": str(self.base),
            "ledgerPath": str(self.ledger),
            "cases": {
                "core.0": {
                    "assertions": [
                        {
                            "id": "state",
                            "kind": "equals",
                            "path": str(self.evidence),
                            "field": "state",
                            "expected": "ONLINE",
                        }
                    ]
                }
            },
        }
        self.spec_path = self.base / "spec.json"
        runner.write(self.spec_path, self.spec)
        self.root = self.base / "campaign"

    def prepare(self):
        return runner.execute(self.root, "prepare", str(self.spec_path))

    def test_all_gates_are_retained_without_historical_promotion(self):
        self.prepare()
        scope = runner.load(self.root / "scope.json")
        assert len(scope["cases"]) == 333
        assert all(g["status"] == "incomplete" for g in scope["cases"].values())
        assert scope["finalRepetitionsRequired"] == 2

    def test_reduced_scope_is_rejected(self):
        ledger = runner.load(self.ledger)
        ledger["marketplace"].pop()
        with pytest.raises(ValueError, match="campaign scope was reduced"):
            runner.campaign_cases(ledger)

    def test_wrong_candidate_is_rejected_before_creation(self):
        self.binary.write_text("wrong binary")
        with pytest.raises(ValueError, match="candidate mismatch"):
            self.prepare()
        assert not self.root.exists()

    def test_mutable_catalog_invalidates_resume(self):
        self.prepare()
        (self.source / "catalog.json").write_text("changed")
        with pytest.raises(
            ValueError,
            match="frozen candidate, adapter, catalog, or configuration changed",
        ):
            runner.execute(self.root, "resume")

    def test_resume_never_runs_adapter_or_replays_mutation(self):
        self.prepare()
        with patch.object(runner, "adapter") as adapter:
            result = runner.execute(self.root, "resume")
            adapter.assert_not_called()
        assert result["replayedMutations"] == 0

    def test_mutated_fixture_invalidates_resume(self):
        fixture = self.base / "fixture.json"
        fixture.write_text('{"identity":"first"}')
        self.spec["fixtureHashes"] = {str(fixture): runner.digest(fixture)}
        self.spec_path.write_text(json.dumps(self.spec))
        self.prepare()
        fixture.write_text('{"identity":"different"}')
        with pytest.raises(ValueError, match="fixture hash mismatch"):
            runner.execute(self.root, "resume")

    def test_wrong_declared_fixture_hash_rejects_preparation(self):
        fixture = self.base / "fixture.json"
        fixture.write_text("{}")
        self.spec["fixtureHashes"] = {str(fixture): "0" * 64}
        self.spec_path.write_text(json.dumps(self.spec))
        with pytest.raises(ValueError, match="fixture hash mismatch"):
            self.prepare()
        assert not self.root.exists()

    def test_capture_inventory_retains_fresh_diagnostics_and_deduplicates(self):
        directory = self.base / "diagnostics"
        directory.mkdir()
        old = directory / "old.jsonl"
        fresh = directory / "fresh.jsonl"
        old.write_text("historical")
        fresh.write_text("current")
        binding = {
            "capturePaths": [str(fresh)],
            "diagnosticDirectory": str(directory),
            "diagnosticBaseline": [old.name],
        }
        assert runner.capture_paths(binding) == [str(fresh)]

    def test_sideband_capture_directory_is_included_without_old_files(self):
        directory = self.base / "captures"
        directory.mkdir()
        old = directory / "voice-old.jsonl"
        fresh = directory / "voice-new.jsonl"
        host = directory / "host-current.jsonl"
        for path in (old, fresh, host):
            path.write_text("capture")
        binding = {
            "capturePaths": [str(host)],
            "captureDirectory": str(directory),
            "captureBaseline": [old.name, host.name],
        }
        assert runner.capture_paths(binding) == [str(host), str(fresh)]

    def test_admission_spec_and_journal_tampering_are_rejected(self):
        self.prepare()
        path = self.root / "spec.json"
        spec = runner.load(path)
        spec["cases"]["core.0"]["assertions"] = []
        path.write_text(json.dumps(spec))
        with pytest.raises(ValueError, match="campaign admission changed"):
            runner.execute(self.root, "resume")

    def test_missing_and_incomplete_footer_never_seal(self):
        trace = self.base / "trace.jsonl"
        rows = [
            {
                "kind": "manifest",
                "sourceCommit": self.candidate["commit"],
                "artifactSha256": self.candidate["sha256"],
            },
            {
                "kind": "event",
                "sequence": 1,
                "direction": "in",
                "message": {"type": "session.created"},
            },
        ]
        trace.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
        assert not observer.trace_state(trace, self.candidate)["complete"]
        rows.append({"kind": "footer", "complete": False, "events": 1})
        trace.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
        assert not observer.trace_state(trace, self.candidate)["complete"]

    def test_sequence_gaps_and_wrong_manifests_fail(self):
        trace = self.base / "trace.jsonl"
        rows = [
            {
                "kind": "wrong",
                "sourceCommit": self.candidate["commit"],
                "artifactSha256": self.candidate["sha256"],
            },
            {"kind": "event", "sequence": 3, "direction": "in", "message": {}},
            {"kind": "footer", "complete": True, "events": 1},
        ]
        trace.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
        result = observer.trace_state(trace, self.candidate)
        assert "sequence-gap" in result["failures"]
        assert "manifest-missing" in result["failures"]

    def test_reported_success_is_not_an_assertion(self):
        rule = {
            "kind": "equals",
            "path": str(self.evidence),
            "field": "success",
            "expected": True,
        }
        with pytest.raises(ValueError, match="reported acceptance cannot prove itself"):
            runner.assertion(rule)

    def test_empty_plan_is_not_zero_change_acceptance(self):
        self.evidence.write_text(json.dumps({"resource_changes": []}))
        assert not runner.assertion(
            {"kind": "plan-no-change", "path": str(self.evidence)}
        )

    def test_saved_plan_requires_content_and_matching_hash(self):
        content = "Install KVM and its Platform dependency in the configured namespace."
        plan = {
            "content": content,
            "sha256": hashlib.sha256(content.encode()).hexdigest(),
        }
        self.evidence.write_text(json.dumps({"plan": plan}))
        rule = {"kind": "saved-plan", "path": str(self.evidence), "field": "plan"}
        assert runner.assertion(rule)
        plan["content"] = "Changed plan"
        self.evidence.write_text(json.dumps({"plan": plan}))
        assert not runner.assertion(rule)
        self.evidence.write_text(
            json.dumps({"plan": {"content": "", "sha256": "0" * 64}})
        )
        assert not runner.assertion(rule)

    def test_http_200_wrong_origin_or_missing_nonce_log_fails(self):
        sample = {
            "nonce": "fresh",
            "status": 200,
            "body": {"fixtureId": "owned", "nonce": "fresh"},
            "ceUid": "ce",
            "loadBalancerUid": "lb",
        }
        rule = {
            "kind": "traffic",
            "path": str(self.evidence),
            "fixtureId": "owned",
            "ceUid": "ce",
            "loadBalancerUid": "lb",
            "ceInsideIp": "10.0.0.1",
        }
        data = {"samples": [sample], "workloadLogs": []}
        self.evidence.write_text(json.dumps(data))
        assert not runner.assertion(rule)
        data["workloadLogs"] = [
            {"nonce": "fresh", "fixtureId": "owned", "sourceIp": "10.0.0.1"}
        ]
        self.evidence.write_text(json.dumps(data))
        assert runner.assertion(rule)
        data["samples"].append(sample)
        self.evidence.write_text(json.dumps(data))
        assert not runner.assertion(rule)

    def test_unsafe_attempt_id_is_rejected(self):
        self.prepare()
        with pytest.raises(ValueError, match="explicit safe attempt ID required"):
            runner.execute(
                self.root,
                "arm",
                case_id="core.0",
                attempt_id="../old-seal",
            )


if __name__ == "__main__":
    unittest.main()
