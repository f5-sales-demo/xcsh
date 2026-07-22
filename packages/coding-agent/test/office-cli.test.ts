import { describe, expect, test } from "bun:test";
import { type OfficeServeDeps, startOfficeServe } from "../src/cli/office-cli";

function fakePaneServer() {
	const state = { stopped: false };
	return {
		state,
		server: {
			port: 8444,
			url: "https://127-0-0-1.local-ip.sh:8444",
			taskpaneUrl: "https://127-0-0-1.local-ip.sh:8444/taskpane.html",
			trusted: true,
			stop: () => {
				state.stopped = true;
			},
		},
	};
}

describe("startOfficeServe", () => {
	test("starts BOTH the pane server and the chat bridge; dispose tears down both", async () => {
		const pane = fakePaneServer();
		const chat = { disposed: false };
		const deps: OfficeServeDeps = {
			startOfficePaneServer: (async () => pane.server) as OfficeServeDeps["startOfficePaneServer"],
			startHeadlessChatBridge: (async () => ({
				bridge: { port: 19222, wssPort: 19322 },
				dispose: async () => {
					chat.disposed = true;
				},
			})) as unknown as OfficeServeDeps["startHeadlessChatBridge"],
		};

		const handle = await startOfficeServe(deps);
		expect(handle.server).toBe(pane.server);
		expect(handle.chat).not.toBeNull();

		await handle.dispose();
		expect(chat.disposed).toBe(true);
		expect(pane.state.stopped).toBe(true);
	});

	test("a bridge-start failure is NON-fatal: the pane still serves (chat=null), dispose still stops the pane", async () => {
		const pane = fakePaneServer();
		const deps: OfficeServeDeps = {
			startOfficePaneServer: (async () => pane.server) as OfficeServeDeps["startOfficePaneServer"],
			startHeadlessChatBridge: (async () => {
				throw new Error("bridge boom");
			}) as unknown as OfficeServeDeps["startHeadlessChatBridge"],
		};

		const handle = await startOfficeServe(deps);
		expect(handle.server).toBe(pane.server);
		expect(handle.chat).toBeNull();

		await handle.dispose();
		expect(pane.state.stopped).toBe(true);
	});
});
