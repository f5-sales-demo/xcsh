import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	type GoogleVertexProjectRuntime,
	googleVertexRequestUrl,
	resolveGoogleVertexLocation,
	resolveGoogleVertexProject,
} from "../src/providers/google-vertex";

const PROJECT_ENV_NAMES = ["GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"] as const;

async function withoutProjectEnvironment(run: () => Promise<void>): Promise<void> {
	const originalValues = new Map<string, string | undefined>();
	for (const name of PROJECT_ENV_NAMES) {
		originalValues.set(name, Bun.env[name]);
		delete Bun.env[name];
	}

	try {
		await run();
	} finally {
		for (const [name, value] of originalValues) {
			if (value === undefined) delete Bun.env[name];
			else Bun.env[name] = value;
		}
	}
}

describe("Google Vertex runtime configuration", () => {
	it("resolves the project from ADC when project environment variables are absent", async () => {
		await withoutProjectEnvironment(async () => {
			const originalCredentialsPath = Bun.env.GOOGLE_APPLICATION_CREDENTIALS;
			const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ai-vertex-adc-"));
			const credentialsPath = path.join(tempDirectory, "application_default_credentials.json");

			try {
				await Bun.write(credentialsPath, JSON.stringify({ project_id: "123456789012" }));
				Bun.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;

				expect(await resolveGoogleVertexProject()).toBe("123456789012");
			} finally {
				if (originalCredentialsPath === undefined) delete Bun.env.GOOGLE_APPLICATION_CREDENTIALS;
				else Bun.env.GOOGLE_APPLICATION_CREDENTIALS = originalCredentialsPath;
				await fs.rm(tempDirectory, { recursive: true, force: true });
			}
		});
	});

	it("falls back to the active gcloud project when ADC has no project", async () => {
		await withoutProjectEnvironment(async () => {
			const requestedExecutables: string[] = [];
			const runtime: GoogleVertexProjectRuntime = {
				readAdcProject: async () => undefined,
				findGcloud: () => "/test/bin/gcloud",
				readConfiguredProject: async gcloud => {
					requestedExecutables.push(gcloud);
					return "gcloud-project";
				},
			};

			expect(await resolveGoogleVertexProject(undefined, runtime)).toBe("gcloud-project");
			expect(requestedExecutables).toEqual(["/test/bin/gcloud"]);
		});
	});

	it("defaults to the global Vertex location and global endpoint", async () => {
		const originalLocation = Bun.env.GOOGLE_CLOUD_LOCATION;
		try {
			delete Bun.env.GOOGLE_CLOUD_LOCATION;
			expect(resolveGoogleVertexLocation()).toBe("global");
			expect(googleVertexRequestUrl("gemini-3.6-flash", "test-project", "global")).toBe(
				"https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-3.6-flash:streamGenerateContent",
			);
		} finally {
			if (originalLocation === undefined) delete Bun.env.GOOGLE_CLOUD_LOCATION;
			else Bun.env.GOOGLE_CLOUD_LOCATION = originalLocation;
		}
	});
});
