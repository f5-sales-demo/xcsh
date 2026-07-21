import { describe, expect, test } from "bun:test";
import type { InternalResource } from "../internal-urls/types";
import { expandInternalUrls } from "./bash-skill-urls";

describe("expandInternalUrls xcsh scheme", () => {
	const router = {
		canHandle: (input: string) => input.startsWith("xcsh://"),
		resolve: async (input: string): Promise<InternalResource> => ({
			url: input,
			content: "",
			contentType: "application/json",
			sourcePath: "/abs/plugin/engine/cli.ts",
		}),
	};

	test("expands an xcsh:// token to a shell-escaped absolute path", async () => {
		const out = await expandInternalUrls("bun xcsh://plugin/demo/file/engine/cli.ts score deal.json", {
			skills: [],
			internalRouter: router,
		});
		expect(out).toBe("bun '/abs/plugin/engine/cli.ts' score deal.json");
	});
});
