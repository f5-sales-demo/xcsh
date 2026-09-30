import { describe, expect, it } from "bun:test";
import * as publisher from "../../../../scripts/ci-release-publish";

describe("canonical npm latest publication", () => {
	function harness(current = "22.4.10") {
		const events: string[] = [];
		let latest = current;
		return {
			events,
			deps: {
				waitForVisibility: async (name: string, version: string) => {
					events.push(`visible:${name}@${version}`);
				},
				readLatest: async () => latest,
				setLatest: async (version: string) => {
					events.push(`latest:${version}`);
					latest = version;
				},
				sleep: async () => {},
			},
		};
	}
	const packages = [{ name: "@f5-sales-demo/xcsh", version: "22.4.11" }];
	it("sets latest only after the exact published version is visible", async () => {
		const { deps, events } = harness();
		await publisher.finalizeNpmPublication(packages, undefined, deps);
		expect(events).toEqual(["visible:@f5-sales-demo/xcsh@22.4.11", "latest:22.4.11"]);
	});
	it("preserves a newer latest version", async () => {
		const { deps, events } = harness("22.5.0");
		await publisher.finalizeNpmPublication(packages, undefined, deps);
		expect(events).toEqual(["visible:@f5-sales-demo/xcsh@22.4.11"]);
	});
	it("keeps historical backfill from changing latest", async () => {
		const { deps, events } = harness();
		await publisher.finalizeNpmPublication(packages, "backfill", deps);
		expect(events).toEqual(["visible:@f5-sales-demo/xcsh@22.4.11"]);
	});
	it("does not move latest when exact visibility fails", async () => {
		const { deps, events } = harness();
		deps.waitForVisibility = async () => {
			throw new Error("not visible");
		};
		await expect(publisher.finalizeNpmPublication(packages, undefined, deps)).rejects.toThrow("not visible");
		expect(events).toEqual([]);
	});
	it("fails if the registry never exposes the reconciled latest tag", async () => {
		const { deps } = harness();
		deps.setLatest = async () => {};
		await expect(publisher.finalizeNpmPublication(packages, undefined, { ...deps, maxAttempts: 2 })).rejects.toThrow(
			"latest tag",
		);
	});
});
