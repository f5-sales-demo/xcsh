import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { getLocalXCShActiveContextPath, getLocalXCShContextPath, getLocalXCShContextsDir } from "../src/dirs";

describe("XCSH local context path helpers", () => {
	const projectDir = "/home/user/my-project";

	describe("getLocalXCShContextsDir", () => {
		it("returns .xcsh/contexts under the given cwd", () => {
			expect(getLocalXCShContextsDir(projectDir)).toBe(path.join(projectDir, ".xcsh", "contexts"));
		});
	});

	describe("getLocalXCShActiveContextPath", () => {
		it("returns .xcsh/contexts/active_context under the given cwd", () => {
			expect(getLocalXCShActiveContextPath(projectDir)).toBe(
				path.join(projectDir, ".xcsh", "contexts", "active_context"),
			);
		});
	});

	describe("getLocalXCShContextPath", () => {
		it("returns .xcsh/contexts/<name>.json under the given cwd", () => {
			expect(getLocalXCShContextPath("staging", projectDir)).toBe(
				path.join(projectDir, ".xcsh", "contexts", "staging.json"),
			);
		});
	});
});
