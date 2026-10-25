import { describe, expect, it } from "bun:test";
import { Settings } from "../src/config/settings";
import {
	adoptActivatedContextExecution,
	captureContextExecution,
	captureNextContextExecution,
	currentContextExecution,
	runWithContextExecution,
} from "../src/services/context-execution";

describe("context execution admission", () => {
	it("keeps delayed tools, retries and descendants on A while new admissions use B", async () => {
		const settings = Settings.isolated({
			"bash.environment": {
				XCSH_API_URL: "https://a.example.test",
				XCSH_API_TOKEN: "synthetic-a",
				XCSH_NAMESPACE: "team-a",
				XCSH_CONTEXT_NAME: "a",
			},
		});
		const admitted = captureContextExecution(settings);
		let release!: () => void;
		const delayed = new Promise<void>(resolve => {
			release = resolve;
		});
		const work = runWithContextExecution(admitted, async () => {
			await delayed;
			return Promise.all(
				[0, 1, 2].map(async () => {
					await Promise.resolve();
					const descendant = captureContextExecution(settings);
					return runWithContextExecution(descendant, () => settings.get("bash.environment"));
				}),
			);
		});
		settings.override("bash.environment", {
			XCSH_API_URL: "https://b.example.test",
			XCSH_API_TOKEN: "synthetic-b",
			XCSH_NAMESPACE: "team-b",
			XCSH_CONTEXT_NAME: "b",
		});
		const next = captureContextExecution(settings);
		expect(runWithContextExecution(next, () => settings.get("bash.environment").XCSH_CONTEXT_NAME)).toBe("b");
		release();
		for (const env of await work) {
			expect(env.XCSH_API_URL).toBe("https://a.example.test");
			expect(env.XCSH_API_TOKEN).toBe("synthetic-a");
			expect(env.XCSH_NAMESPACE).toBe("team-a");
		}
		expect(Object.isFrozen(admitted.environment)).toBe(true);
	});
});

it("verified activation advances its caller while an admitted descendant retains the original tenant", async () => {
	const settings = Settings.isolated({
		"bash.environment": { XCSH_CONTEXT_NAME: "a", XCSH_API_TOKEN: "synthetic-a" },
	});
	const original = captureContextExecution(settings);
	await runWithContextExecution(original, async () => {
		const release = Promise.withResolvers<void>();
		const descendant = runWithContextExecution(captureContextExecution(settings), async () => {
			await release.promise;
			return currentContextExecution();
		});
		settings.override("bash.environment", { XCSH_CONTEXT_NAME: "b", XCSH_API_TOKEN: "synthetic-b" });
		expect(currentContextExecution()).toBe(original);
		const next = captureNextContextExecution(settings);
		adoptActivatedContextExecution(next);
		expect(currentContextExecution()).toBe(next);
		expect(settings.get("bash.environment").XCSH_CONTEXT_NAME).toBe("b");
		release.resolve();
		expect(await descendant).toBe(original);
		expect(original.environment.XCSH_API_TOKEN).toBe("synthetic-a");
	});
});
