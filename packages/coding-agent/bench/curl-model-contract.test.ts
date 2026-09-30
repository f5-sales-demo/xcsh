import { describe, expect, it } from "bun:test";
import { MODEL_BENCHMARK_SCENARIOS } from "./model-scenario-library";
import { evaluateScenarioContract } from "./model-scenario-report";

describe("curl model scenario evidence and execution contracts", () => {
	const scenario = MODEL_BENCHMARK_SCENARIOS.find(candidate => candidate.id === "api-curl-get-example")!;
	const response =
		'curl "$XCSH_API_URL/api/config/namespaces/default/http_loadbalancers" -H "Authorization: APIToken $XCSH_API_TOKEN"; evidence xcsh://api-catalog/?resource=http_loadbalancer&compact=true and xcsh://api-spec/virtual?resource=http_loadbalancer';
	const reads = [
		{
			id: "catalog",
			name: "read",
			args: { path: "xcsh://api-catalog/?resource=http_loadbalancer&compact=true" },
			isError: false,
			isWarning: false,
			startedAtMs: 0,
		},
		{
			id: "schema",
			name: "read",
			args: { path: "xcsh://api-spec/virtual?resource=http_loadbalancer&field=spec.http.port", sel: "L1-L100" },
			isError: false,
			isWarning: false,
			startedAtMs: 0,
		},
	];

	it("accepts authoritative bounded schema reads without imposing redundant full reads", () => {
		expect(evaluateScenarioContract(scenario, response, reads)).toEqual([]);
	});
	it("rejects examples without endpoint evidence or with API or shell execution", () => {
		expect(evaluateScenarioContract(scenario, response, [])).toEqual(
			expect.arrayContaining([expect.stringContaining("tool sequence missing")]),
		);
		for (const name of ["bash", "xcsh_api"]) {
			expect(
				evaluateScenarioContract(scenario, response, [
					...reads,
					{ id: "execution", name, args: {}, startedAtMs: 0, isError: false, isWarning: false },
				]),
			).toEqual(expect.arrayContaining([expect.stringContaining(`tool ${name} called`)]));
		}
	});
	it("rejects unquoted credentials and unsolicited curl substitution in metadata scenarios", () => {
		expect(
			evaluateScenarioContract(
				scenario,
				response.replace('"Authorization: APIToken $XCSH_API_TOKEN"', "Authorization: APIToken $XCSH_API_TOKEN"),
				reads,
			),
		).toEqual(expect.arrayContaining([expect.stringContaining("quoted API token")]));
		const nativeMetadata = MODEL_BENCHMARK_SCENARIOS.find(candidate => candidate.id === "api-catalog-answer-waf")!;
		expect(evaluateScenarioContract(nativeMetadata, "curl", [])).toEqual(
			expect.arrayContaining([expect.stringContaining("forbidden content")]),
		);
	});
});
