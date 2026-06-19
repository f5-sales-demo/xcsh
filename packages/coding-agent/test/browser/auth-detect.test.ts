import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import type { AuthDocument } from "../../src/browser/auth";
import { isAuthenticated, isLoginWall } from "../../src/browser/auth";

function loadDoc(fixture: string): AuthDocument {
	const html = readFileSync(join(import.meta.dir, "fixtures", fixture), "utf-8");
	const { document } = parseHTML(html);
	// linkedom's document is structurally compatible with AuthDocument
	return document as unknown as AuthDocument;
}

const loginWall = loadDoc("xc-login-wall.html");
const consoleAuthed = loadDoc("xc-console-authed.html");

describe("auth detection", () => {
	it("classifies the login wall as a login wall (not authenticated)", () => {
		expect(isLoginWall(loginWall)).toBe(true);
		expect(isAuthenticated(loginWall)).toBe(false);
	});

	it("classifies the authenticated console as authenticated (not a login wall)", () => {
		expect(isAuthenticated(consoleAuthed)).toBe(true);
		expect(isLoginWall(consoleAuthed)).toBe(false);
	});

	it("the two fixtures are classified distinctly", () => {
		expect(isLoginWall(loginWall)).not.toBe(isLoginWall(consoleAuthed));
		expect(isAuthenticated(loginWall)).not.toBe(isAuthenticated(consoleAuthed));
	});
});
