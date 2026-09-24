import { describe, expect, test } from "bun:test";
import { MCPRuntimeController } from "../src/mcp/runtime-controller";

type Runtime = { id: number };

describe("MCPRuntimeController", () => {
	test("coalesces duplicate enable requests", async () => {
		const calls: string[] = [];
		const controller = new MCPRuntimeController<Runtime>({
			start: async () => {
				calls.push("start");
				return { id: 1 };
			},
			activate: async runtime => calls.push(`activate:${runtime.id}`),
			deactivate: async runtime => calls.push(`deactivate:${runtime.id}`),
			stop: async runtime => calls.push(`stop:${runtime.id}`),
		});

		await Promise.all([controller.setEnabled(true), controller.setEnabled(true)]);

		expect(controller.enabled).toBe(true);
		expect(controller.current).toEqual({ id: 1 });
		expect(calls).toEqual(["start", "activate:1"]);
	});

	test("serializes conflicting requests with the latest state winning", async () => {
		const calls: string[] = [];
		const gate = Promise.withResolvers<void>();
		const controller = new MCPRuntimeController<Runtime>({
			start: async () => {
				calls.push("start");
				await gate.promise;
				return { id: 1 };
			},
			activate: async runtime => calls.push(`activate:${runtime.id}`),
			deactivate: async runtime => calls.push(`deactivate:${runtime.id}`),
			stop: async runtime => calls.push(`stop:${runtime.id}`),
		});

		const enabling = controller.setEnabled(true);
		const disabling = controller.setEnabled(false);
		gate.resolve();
		await Promise.all([enabling, disabling]);

		expect(controller.enabled).toBe(false);
		expect(controller.current).toBeUndefined();
		expect(calls).toEqual(["start", "activate:1", "deactivate:1", "stop:1"]);
	});

	test("dispose is idempotent and prevents later activation", async () => {
		let stops = 0;
		const controller = new MCPRuntimeController<Runtime>({
			start: async () => ({ id: 1 }),
			activate: async () => {},
			deactivate: async () => {},
			stop: async () => {
				stops += 1;
			},
		});
		await controller.setEnabled(true);
		await Promise.all([controller.dispose(), controller.dispose()]);

		expect(stops).toBe(1);
		expect(controller.enabled).toBe(false);
		await expect(controller.setEnabled(true)).rejects.toThrow("disposed");
	});
});
