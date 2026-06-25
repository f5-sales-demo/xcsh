import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { getLocalF5XCActiveContextPath, getLocalF5XCContextPath, getLocalF5XCContextsDir } from "../src/dirs";

describe("F5XC local context path helpers", () => {
	const projectDir = "/home/user/my-project";

	describe("getLocalF5XCContextsDir", () => {
		it("returns .xcsh/contexts under the given cwd", () => {
			expect(getLocalF5XCContextsDir(projectDir)).toBe(path.join(projectDir, ".xcsh", "contexts"));
		});
	});

	describe("getLocalF5XCActiveContextPath", () => {
		it("returns .xcsh/contexts/active_context under the given cwd", () => {
			expect(getLocalF5XCActiveContextPath(projectDir)).toBe(
				path.join(projectDir, ".xcsh", "contexts", "active_context"),
			);
		});
	});

	describe("getLocalF5XCContextPath", () => {
		it("returns .xcsh/contexts/<name>.json under the given cwd", () => {
			expect(getLocalF5XCContextPath("staging", projectDir)).toBe(
				path.join(projectDir, ".xcsh", "contexts", "staging.json"),
			);
		});
	});
});
