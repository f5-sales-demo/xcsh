import { expect, mock, test } from "bun:test";
import { NativeLifecycleLocalOperationError } from "../src/extensibility/extensions/bundled/native-lifecycle-control";
import { ExtensionRunner } from "../src/extensibility/extensions/runner";
import type { Extension, ExtensionContext } from "../src/extensibility/extensions/types";

function runnerWithFailure(error: Error) {
	const runner = Object.create(ExtensionRunner.prototype) as ExtensionRunner;
	Object.assign(runner, {
		extensions: [
			{
				path: "native-fixture",
				handlers: new Map([
					[
						"before_agent_start",
						[
							async () => {
								throw error;
							},
						],
					],
				]),
			},
		] as unknown as Extension[],
	});
	runner.createContext = () => ({}) as ExtensionContext;
	runner.emitError = mock(() => {});
	return runner;
}

test("specialized before-agent-start propagates an owned native failure", async () => {
	const error = new NativeLifecycleLocalOperationError(new Error("owned local read failed"));
	const runner = runnerWithFailure(error);
	await expect(runner.emitBeforeAgentStart("read fixture", undefined, "system")).rejects.toBe(error);
	expect(runner.emitError).not.toHaveBeenCalled();
});

test("ordinary before-agent-start extension errors remain isolated", async () => {
	const runner = runnerWithFailure(new Error("ordinary extension failure"));
	await expect(runner.emitBeforeAgentStart("read fixture", undefined, "system")).resolves.toBeUndefined();
	expect(runner.emitError).toHaveBeenCalledTimes(1);
});
