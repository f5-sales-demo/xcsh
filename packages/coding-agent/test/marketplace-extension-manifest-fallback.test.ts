import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { clearXcshPluginRootsCache } from "../src/discovery/helpers";
import { discoverAndLoadExtensions } from "../src/extensibility/extensions/loader";

describe("marketplace extension manifest fallback", () => {
	let tempHome = "";
	let tempProject = "";

	afterEach(async () => {
		clearXcshPluginRootsCache({ rewarm: false });
		if (tempHome) await fs.rm(tempHome, { recursive: true, force: true });
		if (tempProject) await fs.rm(tempProject, { recursive: true, force: true });
	});

	async function createPlugin(options: { canonicalExtensions?: string[]; packageExtensions?: string[] }) {
		tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-marketplace-manifest-home-"));
		tempProject = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-marketplace-manifest-project-"));
		const root = path.join(tempHome, "plugin-cache", "salesforce");
		await fs.mkdir(path.join(root, ".xcsh-plugin"), { recursive: true });
		await fs.mkdir(path.join(root, "extensions"), { recursive: true });
		await fs.mkdir(path.join(tempHome, ".xcsh", "plugins"), { recursive: true });
		await fs.writeFile(path.join(root, "extensions", "fallback.ts"), "export default () => {};");
		await fs.writeFile(path.join(root, "extensions", "canonical.ts"), "export default () => {};");
		await fs.writeFile(
			path.join(root, "package.json"),
			JSON.stringify({ name: "salesforce", xcsh: { extensions: options.packageExtensions ?? [] } }),
		);
		await fs.writeFile(
			path.join(root, ".xcsh-plugin", "plugin.json"),
			JSON.stringify({
				name: "salesforce",
				...(options.canonicalExtensions === undefined ? {} : { extensions: options.canonicalExtensions }),
				lifecycle: { integrations: ["salesforce"] },
			}),
		);
		await fs.writeFile(
			path.join(tempHome, ".xcsh", "plugins", "installed_plugins.json"),
			JSON.stringify({
				version: 2,
				plugins: {
					"salesforce@test-marketplace": [{ scope: "user", installPath: root, version: "1.5.0" }],
				},
			}),
		);
		return root;
	}

	test("canonical extension declarations take precedence over package metadata", async () => {
		await createPlugin({
			canonicalExtensions: ["extensions/canonical.ts"],
			packageExtensions: ["extensions/fallback.ts"],
		});
		const result = await discoverAndLoadExtensions([], tempProject, undefined, [], tempHome);
		expect(
			result.extensions.some(extension => extension.path.endsWith(path.join("extensions", "canonical.ts"))),
		).toBe(true);
		expect(result.extensions.some(extension => extension.path.endsWith(path.join("extensions", "fallback.ts")))).toBe(
			false,
		);
	});

	test.each(["/tmp/escape.ts", "../escape.ts", "extensions/escape-link.ts"])(
		"rejects an unsafe marketplace extension path: %s",
		async entry => {
			const root = await createPlugin({ packageExtensions: [entry] });
			if (entry.endsWith("escape-link.ts"))
				await fs.symlink("/tmp", path.join(root, "extensions", "escape-link.ts"));
			const result = await discoverAndLoadExtensions([], tempProject, undefined, [], tempHome);
			expect(result.extensions.some(extension => extension.path.includes("fallback.ts"))).toBe(false);
			expect(result.errors).toContainEqual({
				path: root,
				error: expect.stringContaining(
					"declares lifecycle integrations but no extension entrypoint could be loaded",
				),
			});
		},
	);
});
