import { describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	type AntigravityProjectSources,
	readAntigravityCliProjectId,
	readGcloudProjectId,
	resolveAntigravityProjectId,
} from "../src/utils/oauth/google-antigravity";

const NO_PROJECT_SOURCES: AntigravityProjectSources = {
	environment: {},
	readAntigravityProjectId: async () => undefined,
	readGcloudProjectId: async () => undefined,
};

describe("Antigravity enterprise project resolution", () => {
	it("prefers GOOGLE_CLOUD_PROJECT before every external source", async () => {
		const readAntigravityProjectId = vi.fn(async () => "metadata-enterprise-project");
		const readGcloudProjectId = vi.fn(async () => "gcloud-enterprise-project");
		const onPrompt = vi.fn(async () => "interactive-enterprise-project");

		const projectId = await resolveAntigravityProjectId(
			{ onPrompt },
			{
				environment: {
					GOOGLE_CLOUD_PROJECT: "primary-enterprise-project",
					GOOGLE_CLOUD_PROJECT_ID: "fallback-enterprise-project",
				},
				readAntigravityProjectId,
				readGcloudProjectId,
			},
		);

		expect(projectId).toBe("primary-enterprise-project");
		expect(readAntigravityProjectId).not.toHaveBeenCalled();
		expect(readGcloudProjectId).not.toHaveBeenCalled();
		expect(onPrompt).not.toHaveBeenCalled();
	});

	it("uses GOOGLE_CLOUD_PROJECT_ID when the primary variable is absent", async () => {
		const projectId = await resolveAntigravityProjectId(
			{},
			{
				...NO_PROJECT_SOURCES,
				environment: { GOOGLE_CLOUD_PROJECT_ID: "fallback-enterprise-project" },
			},
		);

		expect(projectId).toBe("fallback-enterprise-project");
	});

	it("prefers Antigravity CLI metadata before gcloud configuration", async () => {
		const readGcloudProjectId = vi.fn(async () => "gcloud-enterprise-project");
		const projectId = await resolveAntigravityProjectId(
			{},
			{
				...NO_PROJECT_SOURCES,
				readAntigravityProjectId: async () => "metadata-enterprise-project",
				readGcloudProjectId,
			},
		);

		expect(projectId).toBe("metadata-enterprise-project");
		expect(readGcloudProjectId).not.toHaveBeenCalled();
	});

	it("falls back to the configured gcloud project", async () => {
		const projectId = await resolveAntigravityProjectId(
			{},
			{
				...NO_PROJECT_SOURCES,
				readGcloudProjectId: async () => "gcloud-enterprise-project",
			},
		);

		expect(projectId).toBe("gcloud-enterprise-project");
	});

	it("prompts interactively only after configured sources are exhausted", async () => {
		const onPrompt = vi.fn(async () => "interactive-enterprise-project");
		const projectId = await resolveAntigravityProjectId({ onPrompt }, NO_PROJECT_SOURCES);

		expect(projectId).toBe("interactive-enterprise-project");
		expect(onPrompt).toHaveBeenCalledWith(
			expect.objectContaining({
				allowEmpty: true,
				message: expect.stringContaining("Google Cloud project ID"),
			}),
		);
	});

	it("treats an explicit blank prompt as individual-tier discovery", async () => {
		const projectId = await resolveAntigravityProjectId({ onPrompt: async () => "   " }, NO_PROJECT_SOURCES);

		expect(projectId).toBeUndefined();
	});

	it("keeps noninteractive no-project login on individual-tier discovery", async () => {
		expect(await resolveAntigravityProjectId({}, NO_PROJECT_SOURCES)).toBeUndefined();
	});

	it("does not expose external-source errors while falling through", async () => {
		const credentialSentinel = "credential-sentinel-must-not-leak";
		const progress: string[] = [];
		const projectId = await resolveAntigravityProjectId(
			{
				onProgress: message => progress.push(message),
				onPrompt: async () => "",
			},
			{
				environment: {},
				readAntigravityProjectId: async () => {
					throw new Error(credentialSentinel);
				},
				readGcloudProjectId: async () => {
					throw new Error(credentialSentinel);
				},
			},
		);

		expect(projectId).toBeUndefined();
		expect(progress.join("\n")).not.toContain(credentialSentinel);
	});
});

describe("Antigravity project sources", () => {
	it("reads only a valid project_id from Antigravity CLI metadata", async () => {
		const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-antigravity-project-"));
		const metadataPath = path.join(tempDirectory, "antigravity-oauth-token");
		try {
			await fs.writeFile(
				metadataPath,
				JSON.stringify({
					auth_method: "oauth",
					project_id: "metadata-enterprise-project",
					region: "",
					token: "credential-sentinel-must-not-leak",
				}),
				{ mode: 0o600 },
			);

			expect(await readAntigravityCliProjectId(metadataPath)).toBe("metadata-enterprise-project");

			await fs.writeFile(metadataPath, '{"project_id": "invalid", "token": "credential-sentinel');
			expect(await readAntigravityCliProjectId(metadataPath)).toBeUndefined();
		} finally {
			await fs.rm(tempDirectory, { recursive: true, force: true });
		}
	});

	it("normalizes successful gcloud output and rejects unset or failed output", async () => {
		expect(await readGcloudProjectId(async () => ({ exitCode: 0, stdout: "gcloud-enterprise-project\n" }))).toBe(
			"gcloud-enterprise-project",
		);
		expect(await readGcloudProjectId(async () => ({ exitCode: 0, stdout: "(unset)\n" }))).toBeUndefined();
		expect(
			await readGcloudProjectId(async () => ({ exitCode: 1, stdout: "credential-sentinel-must-not-leak" })),
		).toBeUndefined();
	});
});
