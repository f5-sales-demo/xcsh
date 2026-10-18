import { expect, test } from "bun:test";
import { EventController } from "../src/modes/controllers/event-controller";
import type { InteractiveModeContext } from "../src/modes/types";

test("controller teardown retires all pending tool animations", () => {
	let stops = 0;
	const controller = new EventController({
		pendingTools: new Map([
			[
				"fixture",
				{
					stopAnimation() {
						stops++;
					},
				},
			],
		]),
	} as unknown as InteractiveModeContext);
	controller.dispose();
	expect(stops).toBe(1);
});
