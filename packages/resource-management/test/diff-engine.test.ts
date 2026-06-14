import { describe, expect, it } from "bun:test";
import { computeResourceDiff, formatDiff } from "@f5xc-salesdemos/pi-resource-management";

describe("computeResourceDiff", () => {
	it("detects no differences for identical objects", () => {
		const obj = { domains: ["example.com"], port: 8080 };
		const diff = computeResourceDiff(obj, { ...obj });
		expect(diff.hasDifferences).toBe(false);
		expect(diff.added).toHaveLength(0);
		expect(diff.removed).toHaveLength(0);
		expect(diff.changed).toHaveLength(0);
	});

	it("detects added fields", () => {
		const current = { name: "test" };
		const desired = { name: "test", port: 8080 };
		const diff = computeResourceDiff(current, desired);
		expect(diff.hasDifferences).toBe(true);
		expect(diff.added).toHaveLength(1);
		expect(diff.added[0].path).toBe("port");
		expect(diff.added[0].newValue).toBe(8080);
	});

	it("detects removed fields", () => {
		const current = { name: "test", port: 8080 };
		const desired = { name: "test" };
		const diff = computeResourceDiff(current, desired);
		expect(diff.hasDifferences).toBe(true);
		expect(diff.removed).toHaveLength(1);
		expect(diff.removed[0].path).toBe("port");
		expect(diff.removed[0].oldValue).toBe(8080);
	});

	it("detects changed values", () => {
		const current = { port: 8080 };
		const desired = { port: 9090 };
		const diff = computeResourceDiff(current, desired);
		expect(diff.hasDifferences).toBe(true);
		expect(diff.changed).toHaveLength(1);
		expect(diff.changed[0].path).toBe("port");
		expect(diff.changed[0].oldValue).toBe(8080);
		expect(diff.changed[0].newValue).toBe(9090);
	});

	it("handles nested objects", () => {
		const current = { config: { nested: { value: 1 } } };
		const desired = { config: { nested: { value: 2 } } };
		const diff = computeResourceDiff(current, desired);
		expect(diff.hasDifferences).toBe(true);
		expect(diff.changed).toHaveLength(1);
		expect(diff.changed[0].path).toBe("config.nested.value");
	});

	it("handles array element changes", () => {
		const current = { domains: ["a.com", "b.com"] };
		const desired = { domains: ["a.com", "c.com"] };
		const diff = computeResourceDiff(current, desired);
		expect(diff.hasDifferences).toBe(true);
		expect(diff.changed).toHaveLength(1);
		expect(diff.changed[0].path).toBe("domains[1]");
	});

	it("handles array element addition", () => {
		const current = { domains: ["a.com"] };
		const desired = { domains: ["a.com", "b.com"] };
		const diff = computeResourceDiff(current, desired);
		expect(diff.hasDifferences).toBe(true);
		expect(diff.added).toHaveLength(1);
		expect(diff.added[0].path).toBe("domains[1]");
	});

	it("handles array element removal", () => {
		const current = { domains: ["a.com", "b.com"] };
		const desired = { domains: ["a.com"] };
		const diff = computeResourceDiff(current, desired);
		expect(diff.hasDifferences).toBe(true);
		expect(diff.removed).toHaveLength(1);
		expect(diff.removed[0].path).toBe("domains[1]");
	});

	it("handles empty objects", () => {
		const diff = computeResourceDiff({}, {});
		expect(diff.hasDifferences).toBe(false);
	});

	it("handles deeply nested changes", () => {
		const current = { a: { b: { c: { d: "old" } } } };
		const desired = { a: { b: { c: { d: "new" } } } };
		const diff = computeResourceDiff(current, desired);
		expect(diff.changed).toHaveLength(1);
		expect(diff.changed[0].path).toBe("a.b.c.d");
	});
});

describe("formatDiff", () => {
	it("formats no-change diff", () => {
		const diff = computeResourceDiff({ x: 1 }, { x: 1 });
		const output = formatDiff(diff, "http_loadbalancer", "my-lb");
		expect(output).toContain("no changes");
	});

	it("formats changes with +/- prefixes", () => {
		const diff = computeResourceDiff({ port: 8080 }, { port: 9090, domains: ["a.com"] });
		const output = formatDiff(diff, "http_loadbalancer", "my-lb");
		expect(output).toContain("diff http_loadbalancer/my-lb");
		expect(output).toContain("+ domains");
		expect(output).toContain("~ port");
	});
});
