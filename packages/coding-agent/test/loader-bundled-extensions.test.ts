/**
 * `loadExtensions(..., bundledExtensionNames)` — the opt-in that lets a
 * discovery-disabled headless session still load a specific bundled extension
 * (the Office bridge uses this for `sandbox-guard`, its filesystem safety net).
 */
import { describe, expect, test } from "bun:test";
import { loadExtensions } from "../src/extensibility/extensions/loader";

const CWD = "/tmp";

describe("loadExtensions bundled opt-in", () => {
	test("loads no bundled extensions by default (lean headless)", async () => {
		const result = await loadExtensions([], CWD);
		expect(result.extensions).toHaveLength(0);
		expect(result.errors).toHaveLength(0);
	});

	test("loads ONLY the named bundled extension when opted in", async () => {
		const result = await loadExtensions([], CWD, undefined, ["sandbox-guard"]);
		expect(result.errors).toHaveLength(0);
		// sandbox-guard is loaded (identified by its bundled source path)…
		const paths = result.extensions.map(e => e.path);
		expect(paths).toContain("bundled:sandbox-guard");
		// …and it registers a tool_call hook (the pre-execution gate that confines file tools).
		const guard = result.extensions.find(e => e.path === "bundled:sandbox-guard");
		expect(guard?.handlers.has("tool_call")).toBe(true);
		// The OTHER bundled extension (herdr-reporter) is NOT pulled in.
		expect(paths).not.toContain("bundled:herdr-reporter");
	});

	test("registers the Herdr terminal tool and human command together", async () => {
		const result = await loadExtensions([], CWD, undefined, ["herdr-terminal"]);
		expect(result.errors).toHaveLength(0);
		const extension = result.extensions.find(item => item.path === "bundled:herdr-terminal");
		expect(extension).toBeDefined();
		expect(extension?.tools.has("herdr_terminal")).toBe(true);
		expect(extension?.commands.has("terminal")).toBe(true);
		expect(result.extensions).toHaveLength(1);

		const oldSocket = process.env.HERDR_SOCKET_PATH;
		delete process.env.HERDR_SOCKET_PATH;
		try {
			const tool = extension?.tools.get("herdr_terminal");
			const response = await tool?.definition.execute(
				"plain-xcsh",
				{ action: "list" } as never,
				undefined,
				undefined,
				{} as never,
			);
			expect(response).toMatchObject({
				isError: true,
				details: { error: "terminal management is unavailable outside Herdr" },
			});
		} finally {
			if (oldSocket === undefined) delete process.env.HERDR_SOCKET_PATH;
			else process.env.HERDR_SOCKET_PATH = oldSocket;
		}
	});
});
