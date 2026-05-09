import { describe, expect, it } from "bun:test";
import {
	finalizeSubprocessOutput,
	SUBAGENT_WARNING_MISSING_SUBMIT_RESULT,
	SUBAGENT_WARNING_NULL_SUBMIT_RESULT,
} from "../../src/task/executor";

describe("subagent warning injection", () => {
	it("injects null-data warning when submit_result is success without data", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: "partial output",
			exitCode: 0,
			stderr: "",
			doneAborted: false,
			signalAborted: false,
			submitResultItems: [{ status: "success" }],
			outputSchema: undefined,
		});

		expect(result.rawOutput).toBe(`${SUBAGENT_WARNING_NULL_SUBMIT_RESULT}\n\npartial output`);
		expect(result.hasSubmitResult).toBe(true);
	});

	it("injects missing-submit warning when subagent exits cleanly without submit_result", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: "",
			exitCode: 0,
			stderr: "",
			doneAborted: false,
			signalAborted: false,
			submitResultItems: undefined,
			outputSchema: { properties: { ok: { type: "boolean" } } },
		});

		expect(result.rawOutput).toBe(SUBAGENT_WARNING_MISSING_SUBMIT_RESULT);
		expect(result.hasSubmitResult).toBe(false);
	});

	it("does not inject missing-submit warning when fallback completion is recoverable", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: '{"data":{"ok":true}}',
			exitCode: 0,
			stderr: "",
			doneAborted: false,
			signalAborted: false,
			submitResultItems: undefined,
			outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
		});

		expect(result.rawOutput).toBe('{\n  "ok": true\n}');
		expect(result.rawOutput.includes("SYSTEM WARNING")).toBe(false);
	});

	it("prefixes missing-submit warning on stop outputs", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: "agent stopped after writing analysis",
			exitCode: 0,
			stderr: "",
			doneAborted: false,
			signalAborted: false,
			submitResultItems: undefined,
			outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
		});

		expect(result.rawOutput).toBe(
			`${SUBAGENT_WARNING_MISSING_SUBMIT_RESULT}\n\nagent stopped after writing analysis`,
		);
	});

	it("does not inject missing-submit warning when execution exits non-zero", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: "",
			exitCode: 1,
			stderr: "subagent terminated",
			doneAborted: true,
			signalAborted: false,
			submitResultItems: undefined,
			outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
		});

		expect(result.rawOutput).toBe("");
		expect(result.stderr).toBe("subagent terminated");
		expect(result.exitCode).toBe(1);
	});

	it("normalizes explicit aborted submit_result into aborted payload", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: "partial output",
			exitCode: 1,
			stderr: "old error",
			doneAborted: false,
			signalAborted: false,
			submitResultItems: [{ status: "aborted", error: "blocked by permissions" }],
			outputSchema: undefined,
		});

		expect(result.abortedViaSubmitResult).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("blocked by permissions");
		expect(result.rawOutput).toContain('"aborted": true');
		expect(result.rawOutput).toContain('"blocked by permissions"');
	});

	it("accepts successful submit_result data without warning", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: "should be replaced",
			exitCode: 1,
			stderr: "should clear",
			doneAborted: false,
			signalAborted: false,
			submitResultItems: [{ status: "success", data: { ok: true } }],
			outputSchema: undefined,
		});

		expect(result.rawOutput).toBe('{\n  "ok": true\n}');
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.rawOutput.includes("SYSTEM WARNING")).toBe(false);
	});

	it("does not inject missing-submit warning when no schema and raw text exists", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: "plain text notes",
			exitCode: 0,
			stderr: "",
			doneAborted: false,
			signalAborted: false,
			submitResultItems: undefined,
			outputSchema: undefined,
		});

		expect(result.rawOutput).toBe("plain text notes");
		expect(result.rawOutput.includes("SYSTEM WARNING")).toBe(false);
		expect(result.exitCode).toBe(0);
	});
	it("salvages text output from aborted run without output schema", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: "exploration notes: found 5 files related to auth",
			exitCode: 1,
			stderr: "subagent terminated",
			doneAborted: true,
			signalAborted: false,
			submitResultItems: undefined,
			outputSchema: undefined,
		});

		expect(result.rawOutput).toBe("exploration notes: found 5 files related to auth");
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
	});

	it("does not salvage aborted output when output schema is required", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: "unstructured text",
			exitCode: 1,
			stderr: "subagent terminated",
			doneAborted: true,
			signalAborted: false,
			submitResultItems: undefined,
			outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
		});

		expect(result.rawOutput).toBe("unstructured text");
		expect(result.exitCode).toBe(1);
	});

	it("does not salvage when signal aborted even without schema", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: "partial notes",
			exitCode: 1,
			stderr: "cancelled",
			doneAborted: true,
			signalAborted: true,
			submitResultItems: undefined,
			outputSchema: undefined,
		});

		expect(result.rawOutput).toBe("partial notes");
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("cancelled");
	});

	it("salvages aborted output when valid JSON matches output schema", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: '{"ok": true}',
			exitCode: 1,
			stderr: "subagent terminated",
			doneAborted: true,
			signalAborted: false,
			submitResultItems: undefined,
			outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.rawOutput).toContain('"ok": true');
	});

	it("does not salvage aborted output when JSON does not match schema", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: '{"wrong": "field"}',
			exitCode: 1,
			stderr: "subagent terminated",
			doneAborted: true,
			signalAborted: false,
			submitResultItems: undefined,
			outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("subagent terminated");
	});

	it("does not salvage aborted run when rawOutput is empty", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: "",
			exitCode: 1,
			stderr: "subagent terminated",
			doneAborted: true,
			signalAborted: false,
			submitResultItems: undefined,
			outputSchema: undefined,
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("subagent terminated");
		expect(result.rawOutput).toBe("");
	});

	it("does not salvage aborted run when rawOutput is whitespace-only", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: "   \n\t  ",
			exitCode: 1,
			stderr: "subagent terminated",
			doneAborted: true,
			signalAborted: false,
			submitResultItems: undefined,
			outputSchema: undefined,
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("subagent terminated");
	});

	it("uses last submit_result when multiple items are provided", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: "partial",
			exitCode: 1,
			stderr: "error",
			doneAborted: false,
			signalAborted: false,
			submitResultItems: [
				{ status: "success", data: { first: true } },
				{ status: "success", data: { last: true } },
			],
			outputSchema: undefined,
		});

		expect(result.rawOutput).toContain('"last": true');
		expect(result.rawOutput).not.toContain('"first"');
		expect(result.exitCode).toBe(0);
	});

	it("merges report_findings into submit_result data when findings key is absent", () => {
		const findings = [
			{
				title: "unused import",
				body: "The import `foo` is declared but never used.",
				file_path: "src/foo.ts",
				line_start: 1,
				line_end: 1,
				priority: 3,
				confidence: 9,
			},
		];
		const result = finalizeSubprocessOutput({
			rawOutput: "",
			exitCode: 0,
			stderr: "",
			doneAborted: false,
			signalAborted: false,
			submitResultItems: [{ status: "success", data: { summary: "review done" } }],
			reportFindings: findings,
			outputSchema: undefined,
		});

		const parsed = JSON.parse(result.rawOutput);
		expect(parsed.summary).toBe("review done");
		expect(parsed.findings).toHaveLength(1);
		expect(parsed.findings[0].title).toBe("unused import");
	});

	it("extracts nested data from {data: ...} wrapper in submit_result", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: "",
			exitCode: 0,
			stderr: "",
			doneAborted: false,
			signalAborted: false,
			submitResultItems: [{ status: "success", data: { data: { inner: true } } }],
			outputSchema: undefined,
		});

		// normalizeCompleteData calls extractCompletionData which unwraps {data: ...}
		// but only when submit_result.data itself has a 'data' key
		const parsed = JSON.parse(result.rawOutput);
		expect(parsed.inner).toBeUndefined();
		expect(parsed.data).toEqual({ inner: true });
	});

	it("does not overwrite existing findings key with reportFindings", () => {
		const existingFindings = [
			{
				title: "from agent",
				body: "agent found this",
				priority: 1,
				confidence: 9,
				file_path: "a.ts",
				line_start: 1,
				line_end: 1,
			},
		];
		const reportFindings = [
			{
				title: "from reporter",
				body: "reporter found this",
				priority: 2,
				confidence: 8,
				file_path: "b.ts",
				line_start: 5,
				line_end: 5,
			},
		];
		const result = finalizeSubprocessOutput({
			rawOutput: "",
			exitCode: 0,
			stderr: "",
			doneAborted: false,
			signalAborted: false,
			submitResultItems: [{ status: "success", data: { summary: "done", findings: existingFindings } }],
			reportFindings,
			outputSchema: undefined,
		});

		const parsed = JSON.parse(result.rawOutput);
		expect(parsed.findings).toHaveLength(1);
		expect(parsed.findings[0].title).toBe("from agent");
	});

	it("recovers fallback completion from raw output with {data:...} wrapper", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: '{"data": {"ok": true}}',
			exitCode: 0,
			stderr: "",
			doneAborted: false,
			signalAborted: false,
			submitResultItems: undefined,
			outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
		});

		// extractCompletionData unwraps {data: ...}, then schema validation passes
		const parsed = JSON.parse(result.rawOutput);
		expect(parsed.ok).toBe(true);
		expect(result.exitCode).toBe(0);
	});

	it("handles double-stringified JSON in submit_result data", () => {
		// Model outputs data as a JSON string instead of an object
		const result = finalizeSubprocessOutput({
			rawOutput: "",
			exitCode: 0,
			stderr: "",
			doneAborted: false,
			signalAborted: false,
			submitResultItems: [{ status: "success", data: '{"ok": true}' }],
			outputSchema: undefined,
		});

		// parseStringifiedJson should unwrap the string into an object
		const parsed = JSON.parse(result.rawOutput);
		expect(parsed.ok).toBe(true);
		expect(result.exitCode).toBe(0);
	});

	it("preserves non-JSON string data from submit_result", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: "",
			exitCode: 0,
			stderr: "",
			doneAborted: false,
			signalAborted: false,
			submitResultItems: [{ status: "success", data: "plain text result" }],
			outputSchema: undefined,
		});

		// Non-JSON strings should be preserved as-is (JSON.stringify wraps them)
		expect(result.rawOutput).toBe('"plain text result"');
		expect(result.exitCode).toBe(0);
	});

	it("handles JSON.stringify failure on submit_result data with circular reference", () => {
		// Create circular reference that makes JSON.stringify throw
		const circular: Record<string, unknown> = { ok: true };
		circular.self = circular;

		const result = finalizeSubprocessOutput({
			rawOutput: "",
			exitCode: 0,
			stderr: "",
			doneAborted: false,
			signalAborted: false,
			submitResultItems: [{ status: "success", data: circular }],
			outputSchema: undefined,
		});

		// Should produce error JSON instead of crashing
		expect(result.rawOutput).toContain('"error"');
		expect(result.rawOutput).toContain("Failed to serialize submit_result data");
		expect(result.exitCode).toBe(0);
	});

	it("injects null-data warning when submit_result has explicit data: null", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: "some output",
			exitCode: 0,
			stderr: "",
			doneAborted: false,
			signalAborted: false,
			submitResultItems: [{ status: "success", data: null }],
			outputSchema: undefined,
		});

		expect(result.rawOutput).toContain(SUBAGENT_WARNING_NULL_SUBMIT_RESULT);
		expect(result.rawOutput).toContain("some output");
		expect(result.hasSubmitResult).toBe(true);
	});

	it("recovers schema-less output from aborted run even with only whitespace in schema", () => {
		// Schema error (malformed) + raw text output: should still salvage text
		const result = finalizeSubprocessOutput({
			rawOutput: "useful analysis notes",
			exitCode: 1,
			stderr: "subagent terminated",
			doneAborted: true,
			signalAborted: false,
			submitResultItems: undefined,
			outputSchema: "not valid json",
		});

		// Schema parse error means hasOutputSchema is false, so schema-less salvage applies
		expect(result.rawOutput).toBe("useful analysis notes");
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
	});

	it("uses default abort message when submit_result aborted has empty error", () => {
		const result = finalizeSubprocessOutput({
			rawOutput: "partial",
			exitCode: 1,
			stderr: "old error",
			doneAborted: false,
			signalAborted: false,
			submitResultItems: [{ status: "aborted" }],
			outputSchema: undefined,
		});

		expect(result.abortedViaSubmitResult).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("Subagent aborted task");
		expect(result.rawOutput).toContain('"aborted": true');
	});
});
