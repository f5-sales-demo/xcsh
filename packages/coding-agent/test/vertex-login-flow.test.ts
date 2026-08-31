import { describe, expect, it } from "bun:test";
import {
	detectVertexProject,
	isHeadlessTerminal,
	type VertexLoginRuntime,
	validateVertexLogin,
	vertexFailureGuidance,
} from "../src/modes/controllers/vertex-login-flow";

function runtime(overrides: Partial<VertexLoginRuntime> = {}): VertexLoginRuntime {
	return {
		environment: {},
		readAdcProject: async () => undefined,
		readGcloudProject: async () => undefined,
		applicationDefaultAccessToken: async () => "adc-token",
		loginApplicationDefault: async () => {},
		validateModel: async () => {},
		...overrides,
	};
}

describe("corporate Vertex login flow", () => {
	it("uses explicit environment, ADC, then gcloud project precedence", async () => {
		await expect(
			detectVertexProject(
				runtime({ environment: { GOOGLE_CLOUD_PROJECT: "environment" }, readAdcProject: async () => "adc" }),
			),
		).resolves.toEqual({ id: "environment", source: "environment" });
		await expect(
			detectVertexProject(runtime({ readAdcProject: async () => "adc", readGcloudProject: async () => "gcloud" })),
		).resolves.toEqual({ id: "adc", source: "adc" });
		await expect(detectVertexProject(runtime({ readGcloudProject: async () => "gcloud" }))).resolves.toEqual({
			id: "gcloud",
			source: "gcloud",
		});
	});

	it("validates ADC and the Vertex model without any consumer credential fallback", async () => {
		const calls: string[] = [];
		await validateVertexLogin(
			runtime({
				applicationDefaultAccessToken: async () => "adc-token",
				validateModel: async (project, location, token) => {
					calls.push(`${project}/${location}/${token}`);
				},
			}),
			"corporate-project",
		);
		expect(calls).toEqual(["corporate-project/global/adc-token"]);
	});

	it("does not validate when ADC is missing and gives actionable remediation", async () => {
		let called = false;
		await expect(
			validateVertexLogin(
				runtime({
					applicationDefaultAccessToken: async () => undefined,
					validateModel: async () => {
						called = true;
					},
				}),
				"p",
			),
		).rejects.toThrow("Application Default Credentials");
		expect(called).toBe(false);
		expect(vertexFailureGuidance(new Error("403 API disabled"), "p")).toContain(
			"gcloud services enable aiplatform.googleapis.com --project p",
		);
	});

	it("detects Cloud Shell and display-less terminals as headless", () => {
		expect(isHeadlessTerminal({ CLOUD_SHELL: "true" })).toBe(true);
		expect(isHeadlessTerminal({ DISPLAY: ":0" })).toBe(false);
	});
});
