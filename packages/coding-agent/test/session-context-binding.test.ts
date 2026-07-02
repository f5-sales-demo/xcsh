import { describe, expect, test } from "bun:test";
import { type AutoBindResult, chooseSessionContext, resolveAutoBind } from "../src/services/session-context-binding";

describe("resolveAutoBind — cli", () => {
	test("folder-linked context wins", () => {
		expect(resolveAutoBind({ kind: "cli", availableContexts: ["a", "b"], folderContext: "b" })).toEqual({
			kind: "bind",
			contextName: "b",
		});
	});
	test("exactly one context auto-binds", () => {
		expect(resolveAutoBind({ kind: "cli", availableContexts: ["only"], folderContext: null })).toEqual({
			kind: "bind",
			contextName: "only",
		});
	});
	test("multiple contexts, no link → needsSelection", () => {
		expect(resolveAutoBind({ kind: "cli", availableContexts: ["a", "b"], folderContext: null })).toEqual({
			kind: "needsSelection",
		});
	});
	test("no contexts → none", () => {
		expect(resolveAutoBind({ kind: "cli", availableContexts: [], folderContext: null })).toEqual({ kind: "none" });
	});
});

describe("resolveAutoBind — extension", () => {
	test("matches a context by tenant key", () => {
		expect(
			resolveAutoBind({
				kind: "extension",
				availableContexts: ["acme", "globex"],
				tenantKey: "globex|production",
				contextTenantKeys: { acme: "acme|staging", globex: "globex|production" },
			}),
		).toEqual({ kind: "bind", contextName: "globex" });
	});
	test("no tenant match → needsSelection", () => {
		expect(
			resolveAutoBind({
				kind: "extension",
				availableContexts: ["acme"],
				tenantKey: "globex|production",
				contextTenantKeys: { acme: "acme|staging" },
			}),
		).toEqual({ kind: "needsSelection" });
	});
	test("no tenant key → none", () => {
		expect(resolveAutoBind({ kind: "extension", availableContexts: ["acme"], tenantKey: null })).toEqual({
			kind: "none",
		});
	});
});

describe("chooseSessionContext", () => {
	const bindA: AutoBindResult = { kind: "bind", contextName: "a" };
	test("resume: bound name wins over auto-bind", () => {
		expect(chooseSessionContext("resumed", bindA)).toEqual({ activate: "resumed" });
	});
	test("new: falls back to auto-bind result", () => {
		expect(chooseSessionContext(undefined, bindA)).toEqual({ activate: "a" });
	});
	test("new + needsSelection", () => {
		expect(chooseSessionContext(undefined, { kind: "needsSelection" })).toEqual({ needsSelection: true });
	});
	test("new + none", () => {
		expect(chooseSessionContext(undefined, { kind: "none" })).toEqual({ none: true });
	});
});
