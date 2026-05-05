import { describe, expect, it } from "bun:test";
import type { SfExecApi, SfRawResult } from "../../src/tools/sf/exec";
import {
	detectSfError,
	execSfJson,
	execSfRaw,
	parseSfJsonOutput,
	SfAuthError,
	SfExecError,
	SfNoDefaultOrgError,
	SfNotFoundError,
	SfQueryError,
	SfSessionExpiredError,
} from "../../src/tools/sf/exec";
import type { SfJsonResult } from "../../src/tools/sf/types";

function makeMockApi(result: Partial<SfRawResult>): SfExecApi {
	return {
		exec: async (_command: string, _args: string[]) => ({
			stdout: "",
			stderr: "",
			exitCode: 0,
			...result,
		}),
	};
}

describe("SF error classes", () => {
	it("SfNotFoundError has correct message and name", () => {
		const err = new SfNotFoundError();
		expect(err.message).toContain("brew install sf");
		expect(err.name).toBe("SfNotFoundError");
	});

	it("SfAuthError has correct message and name", () => {
		const err = new SfAuthError();
		expect(err.message).toContain("sf org login web");
		expect(err.name).toBe("SfAuthError");
	});

	it("SfSessionExpiredError has correct message and name", () => {
		const err = new SfSessionExpiredError();
		expect(err.message).toContain("session expired");
		expect(err.name).toBe("SfSessionExpiredError");
	});

	it("SfNoDefaultOrgError has correct message and name", () => {
		const err = new SfNoDefaultOrgError();
		expect(err.message).toContain("no default is set");
		expect(err.name).toBe("SfNoDefaultOrgError");
	});

	it("SfExecError stores exitCode and formats message", () => {
		const err = new SfExecError("something failed", 2);
		expect(err.message).toContain("exit 2");
		expect(err.message).toContain("something failed");
		expect(err.exitCode).toBe(2);
		expect(err.name).toBe("SfExecError");
	});

	it("SfQueryError stores query and extends SfExecError", () => {
		const err = new SfQueryError("bad field", "SELECT Bad FROM Object");
		expect(err.query).toBe("SELECT Bad FROM Object");
		expect(err.exitCode).toBe(1);
		expect(err.name).toBe("SfQueryError");
		expect(err).toBeInstanceOf(SfExecError);
	});
});

describe("detectSfError", () => {
	it("returns SfSessionExpiredError for invalid_session_id", () => {
		const err = detectSfError("INVALID_SESSION_ID: session has expired", 1);
		expect(err).toBeInstanceOf(SfSessionExpiredError);
	});

	it("returns SfAuthError for no orgs found", () => {
		const err = detectSfError("No orgs found in the system", 1);
		expect(err).toBeInstanceOf(SfAuthError);
	});

	it("returns SfNoDefaultOrgError for no default org", () => {
		const err = detectSfError("No default org has been set", 1);
		expect(err).toBeInstanceOf(SfNoDefaultOrgError);
	});

	it("returns SfQueryError for malformed_query when query is provided", () => {
		const err = detectSfError("MALFORMED_QUERY: unexpected token", 1, "SELECT * FROM");
		expect(err).toBeInstanceOf(SfQueryError);
	});

	it("returns SfExecError for generic failures", () => {
		const err = detectSfError("network timeout", 1);
		expect(err).toBeInstanceOf(SfExecError);
	});
});

describe("parseSfJsonOutput", () => {
	it("parses valid JSON output", () => {
		const data: SfJsonResult = { status: 0, result: { id: "abc" } };
		const parsed = parseSfJsonOutput(JSON.stringify(data));
		expect(parsed.status).toBe(0);
		expect(parsed.result).toEqual({ id: "abc" });
	});

	it("throws SfExecError on malformed JSON without leaking raw output", () => {
		const rawInput = '{"access_token":"00D_SENSITIVE_TOKEN_DATA","partial":true';
		try {
			parseSfJsonOutput(rawInput);
			throw new Error("Expected parseSfJsonOutput to throw");
		} catch (err) {
			expect(err).toBeInstanceOf(SfExecError);
			expect((err as Error).message).not.toContain("SENSITIVE_TOKEN_DATA");
			expect((err as Error).message).not.toContain("access_token");
			expect((err as Error).message).toContain("Failed to parse sf CLI JSON output");
		}
	});

	it("preserves message field from parsed output", () => {
		const data: SfJsonResult = { status: 1, result: null, message: "org not found" };
		const parsed = parseSfJsonOutput(JSON.stringify(data));
		expect(parsed.message).toBe("org not found");
	});
});

describe("execSfJson", () => {
	it("appends --json flag and returns parsed result", async () => {
		let capturedArgs: string[] = [];
		const api: SfExecApi = {
			exec: async (_cmd, args) => {
				capturedArgs = args;
				return { stdout: JSON.stringify({ status: 0, result: "ok" }), stderr: "", exitCode: 0 };
			},
		};
		const result = await execSfJson(api, ["org", "display"]);
		expect(capturedArgs).toContain("--json");
		expect(result.status).toBe(0);
	});

	it("throws detectSfError when status is non-zero and message exists", async () => {
		const api = makeMockApi({
			stdout: JSON.stringify({ status: 1, result: null, message: "INVALID_SESSION_ID: expired" }),
			exitCode: 0,
		});
		await expect(execSfJson(api, ["org", "display"])).rejects.toBeInstanceOf(SfSessionExpiredError);
	});
});

describe("execSfRaw", () => {
	it("returns result on success", async () => {
		const api = makeMockApi({ stdout: "output text", exitCode: 0 });
		const result = await execSfRaw(api, ["version"]);
		expect(result.stdout).toBe("output text");
	});

	it("throws detectSfError on non-zero exit code", async () => {
		const api = makeMockApi({ stderr: "No orgs found", exitCode: 1 });
		await expect(execSfRaw(api, ["org", "list"])).rejects.toBeInstanceOf(SfAuthError);
	});
});
