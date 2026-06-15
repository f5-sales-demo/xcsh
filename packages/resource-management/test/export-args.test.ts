import { describe, expect, test } from "bun:test";
import { parseExportArgs } from "../src/arg-parser";

describe("parseExportArgs", () => {
	test("parses kind only", () => {
		const result = parseExportArgs("http_loadbalancer");
		expect(result).toEqual({
			kind: "http_loadbalancer",
			name: undefined,
			namespace: undefined,
			outputFormat: "json",
			outputFile: undefined,
			all: false,
		});
	});

	test("parses kind and name", () => {
		const result = parseExportArgs("http_loadbalancer my-lb");
		expect(result).toEqual({
			kind: "http_loadbalancer",
			name: "my-lb",
			namespace: undefined,
			outputFormat: "json",
			outputFile: undefined,
			all: false,
		});
	});

	test("parses namespace flag", () => {
		const result = parseExportArgs("http_loadbalancer my-lb -n production");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.namespace).toBe("production");
		}
	});

	test("parses short namespace flag", () => {
		const result = parseExportArgs("origin_pool -nproduction");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.namespace).toBe("production");
		}
	});

	test("parses output format json", () => {
		const result = parseExportArgs("origin_pool -o json");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.outputFormat).toBe("json");
		}
	});

	test("parses output format yaml", () => {
		const result = parseExportArgs("origin_pool -o yaml");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.outputFormat).toBe("yaml");
		}
	});

	test("parses output format hcl", () => {
		const result = parseExportArgs("origin_pool -o hcl");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.outputFormat).toBe("hcl");
		}
	});

	test("parses short output format", () => {
		const result = parseExportArgs("origin_pool -oyaml");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.outputFormat).toBe("yaml");
		}
	});

	test("rejects invalid output format", () => {
		const result = parseExportArgs("origin_pool -o table");
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toContain("Invalid output format");
		}
	});

	test("parses output file flag", () => {
		const result = parseExportArgs("http_loadbalancer my-lb -f output.json");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.outputFile).toBe("output.json");
		}
	});

	test("parses short output file flag", () => {
		const result = parseExportArgs("origin_pool -fmanifests/");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.outputFile).toBe("manifests/");
		}
	});

	test("parses --all flag", () => {
		const result = parseExportArgs("--all");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.all).toBe(true);
			expect(result.kind).toBeUndefined();
		}
	});

	test("parses --all with output file", () => {
		const result = parseExportArgs("--all -f backup/ -o yaml");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.all).toBe(true);
			expect(result.outputFile).toBe("backup/");
			expect(result.outputFormat).toBe("yaml");
		}
	});

	test("errors on no args", () => {
		const result = parseExportArgs("");
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toContain("Specify a resource kind");
		}
	});

	test("errors on unknown flag", () => {
		const result = parseExportArgs("origin_pool --unknown");
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toContain("Unknown flag");
		}
	});

	test("errors when -n missing value", () => {
		const result = parseExportArgs("origin_pool -n");
		expect("error" in result).toBe(true);
	});

	test("errors when -o missing value", () => {
		const result = parseExportArgs("origin_pool -o");
		expect("error" in result).toBe(true);
	});

	test("errors when -f missing value", () => {
		const result = parseExportArgs("origin_pool -f");
		expect("error" in result).toBe(true);
	});

	test("parses all flags together", () => {
		const result = parseExportArgs("http_loadbalancer my-lb -n prod -o yaml -f lb.yaml");
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.kind).toBe("http_loadbalancer");
			expect(result.name).toBe("my-lb");
			expect(result.namespace).toBe("prod");
			expect(result.outputFormat).toBe("yaml");
			expect(result.outputFile).toBe("lb.yaml");
			expect(result.all).toBe(false);
		}
	});
});
