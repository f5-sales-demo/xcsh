import { describe, expect, it } from "bun:test";
import type { GlabExecApi, GlabExecResult } from "../../src/tools/glab/exec";
import {
	checkAuth,
	checkInstalled,
	execGlab,
	execGlabJson,
	GlabAuthError,
	GlabExecError,
	GlabNotFoundError,
} from "../../src/tools/glab/exec";

function makeMockPi(result: Partial<GlabExecResult>): GlabExecApi {
	return {
		cwd: "/tmp/test",
		exec: async (_cmd: string, _args: string[]) => ({
			stdout: "",
			stderr: "",
			code: 0,
			killed: false,
			...result,
		}),
	};
}

describe("checkInstalled", () => {
	it("returns true when which glab succeeds", async () => {
		const pi = makeMockPi({ code: 0, stdout: "/usr/local/bin/glab\n" });
		expect(await checkInstalled(pi)).toBe(true);
	});

	it("returns false when which glab fails", async () => {
		const pi = makeMockPi({ code: 1, stderr: "glab not found" });
		expect(await checkInstalled(pi)).toBe(false);
	});
});

describe("checkAuth", () => {
	it("returns true when auth status is ok", async () => {
		const pi = makeMockPi({ code: 0, stdout: "Logged in to gitlab.com as mordasiewicz" });
		expect(await checkAuth(pi)).toBe(true);
	});

	it("returns false when not logged in", async () => {
		const pi = makeMockPi({ code: 1, stderr: "not logged in" });
		expect(await checkAuth(pi)).toBe(false);
	});
});

describe("execGlab", () => {
	it("returns result on success", async () => {
		const pi = makeMockPi({ code: 0, stdout: "ok" });
		const result = await execGlab(pi, ["issue", "list"]);
		expect(result.stdout).toBe("ok");
	});

	it("throws GlabAuthError on auth-related stderr", async () => {
		const pi = makeMockPi({ code: 1, stderr: "authentication required: not logged in" });
		await expect(execGlab(pi, ["issue", "list"])).rejects.toBeInstanceOf(GlabAuthError);
	});

	it("throws GlabNotFoundError on 404 stderr", async () => {
		const pi = makeMockPi({ code: 1, stderr: "GraphQL: 404 Not Found" });
		await expect(execGlab(pi, ["issue", "list"])).rejects.toBeInstanceOf(GlabNotFoundError);
	});

	it("throws GlabExecError on generic failure", async () => {
		const pi = makeMockPi({ code: 1, stderr: "connection timeout" });
		await expect(execGlab(pi, ["issue", "list"])).rejects.toBeInstanceOf(GlabExecError);
	});

	it("throws on killed signal", async () => {
		const pi = makeMockPi({ killed: true, code: 0, stdout: "" });
		await expect(execGlab(pi, ["issue", "list"])).rejects.toThrow("cancelled");
	});
});

describe("execGlabJson", () => {
	it("parses JSON stdout", async () => {
		const data = [{ iid: 1, title: "Test Issue" }];
		const pi = makeMockPi({ code: 0, stdout: JSON.stringify(data) });
		const result = await execGlabJson(pi, ["issue", "list"]);
		expect(result).toEqual(data);
	});

	it("throws on invalid JSON", async () => {
		const pi = makeMockPi({ code: 0, stdout: "not-json" });
		await expect(execGlabJson(pi, ["issue", "list"])).rejects.toThrow();
	});
});
