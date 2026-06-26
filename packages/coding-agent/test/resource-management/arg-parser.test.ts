import { describe, expect, it } from "bun:test";
import { parseResourceArgs } from "@f5-sales-demo/pi-resource-management";

describe("parseResourceArgs", () => {
	it("parses -f flag", () => {
		const result = parseResourceArgs("-f lb.json");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.filenames).toEqual(["lb.json"]);
		}
	});

	it("parses --filename flag", () => {
		const result = parseResourceArgs("--filename lb.yaml");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.filenames).toEqual(["lb.yaml"]);
		}
	});

	it("parses multiple -f flags", () => {
		const result = parseResourceArgs("-f lb.json -f pool.json");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.filenames).toEqual(["lb.json", "pool.json"]);
		}
	});

	it("parses -n flag", () => {
		const result = parseResourceArgs("-f lb.json -n production");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.namespace).toBe("production");
		}
	});

	it("parses short -n form", () => {
		const result = parseResourceArgs("-f lb.json -nproduction");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.namespace).toBe("production");
		}
	});

	it("parses -o flag", () => {
		const result = parseResourceArgs("-f lb.json -o json");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.outputFormat).toBe("json");
		}
	});

	it("rejects invalid output format", () => {
		const result = parseResourceArgs("-f lb.json -o xml");
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toContain("Invalid output format");
		}
	});

	it("parses --dry-run=client", () => {
		const result = parseResourceArgs("-f lb.json --dry-run=client");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.dryRun).toBe("client");
		}
	});

	it("parses --dry-run=server", () => {
		const result = parseResourceArgs("-f lb.json --dry-run=server");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.dryRun).toBe("server");
		}
	});

	it("parses --dry-run without value as client", () => {
		const result = parseResourceArgs("-f lb.json --dry-run");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.dryRun).toBe("client");
		}
	});

	it("parses -R flag", () => {
		const result = parseResourceArgs("-f ./configs/ -R");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.recursive).toBe(true);
		}
	});

	it("parses --force flag", () => {
		const result = parseResourceArgs("http_loadbalancer my-lb --force");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.force).toBe(true);
			expect(result.kind).toBe("http_loadbalancer");
			expect(result.name).toBe("my-lb");
		}
	});

	it("parses positional kind and name", () => {
		const result = parseResourceArgs("http_loadbalancer my-lb");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.kind).toBe("http_loadbalancer");
			expect(result.name).toBe("my-lb");
		}
	});

	it("defaults to table format, no recursive, no force", () => {
		const result = parseResourceArgs("-f lb.json");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.outputFormat).toBe("table");
			expect(result.recursive).toBe(false);
			expect(result.force).toBe(false);
			expect(result.dryRun).toBeUndefined();
		}
	});

	it("parses combined flags", () => {
		const result = parseResourceArgs("-f lb.json -n prod -o yaml --dry-run=server -R");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.filenames).toEqual(["lb.json"]);
			expect(result.namespace).toBe("prod");
			expect(result.outputFormat).toBe("yaml");
			expect(result.dryRun).toBe("server");
			expect(result.recursive).toBe(true);
		}
	});

	it("rejects unknown flag", () => {
		const result = parseResourceArgs("-f lb.json --unknown");
		expect("error" in result).toBe(true);
	});

	it("requires value for -f", () => {
		const result = parseResourceArgs("-f");
		expect("error" in result).toBe(true);
	});

	it("requires value for -n", () => {
		const result = parseResourceArgs("-n");
		expect("error" in result).toBe(true);
	});

	it("handles empty input", () => {
		const result = parseResourceArgs("");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.filenames).toEqual([]);
			expect(result.kind).toBeUndefined();
		}
	});
});
