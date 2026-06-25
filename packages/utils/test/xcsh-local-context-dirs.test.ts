import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { getLocalXCSHActiveContextPath, getLocalXCSHContextPath, getLocalXCSHContextsDir } from "../src/dirs";

describe("XCSH local context path helpers", () => {
	const projectDir = "/home/user/my-project";

	describe("getLocalXCSHContextsDir", () => {
		it("returns .xcsh/contexts under the given cwd", () => {
			expect(getLocalXCSHContextsDir(projectDir)).toBe(path.join(projectDir, ".xcsh", "contexts"));
		});
	});

	describe("getLocalXCSHActiveContextPath", () => {
		it("returns .xcsh/contexts/active_context under the given cwd", () => {
			expect(getLocalXCSHActiveContextPath(projectDir)).toBe(
				path.join(projectDir, ".xcsh", "contexts", "active_context"),
			);
		});
	});

	describe("getLocalXCSHContextPath", () => {
		it("returns .xcsh/contexts/<name>.json under the given cwd", () => {
			expect(getLocalXCSHContextPath("staging", projectDir)).toBe(
				path.join(projectDir, ".xcsh", "contexts", "staging.json"),
			);
		});
	});
});
