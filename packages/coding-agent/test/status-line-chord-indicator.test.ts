import { beforeAll, describe, expect, it } from "bun:test";
import * as os from "node:os";
import { _resetSettingsForTest, Settings } from "../src/config/settings";
import { StatusLineComponent } from "../src/modes/components/status-line";
import { initTheme } from "../src/modes/theme/theme";
import type { AgentSession } from "../src/session/agent-session";

beforeAll(async () => {
	_resetSettingsForTest();
	await Settings.init({ inMemory: true, cwd: os.tmpdir() });
	await initTheme();
});

// Minimal AgentSession fake — StatusLineComponent only consumes the properties
// accessed from #buildStatusLine (state, isStreaming, getAsyncJobSnapshot, ...).
function makeSession(): AgentSession {
	return {
		state: { messages: [], model: undefined },
		isFastModeEnabled: () => false,
		isStreaming: false,
		sessionManager: undefined,
		modelRegistry: { isUsingOAuth: () => false },
		settings: undefined,
		getAsyncJobSnapshot: () => ({ running: [], queued: [] }),
		extensionRunner: undefined,
	} as unknown as AgentSession;
}

// Render width wide enough that the right-aligned chord-pending segment is
// never truncated out by the sizing loop in #buildStatusLine.
const WIDTH = 200;

describe("StatusLineComponent — chord-pending indicator", () => {
	it("does not render the indicator when no chord is pending", () => {
		const component = new StatusLineComponent(makeSession());
		const { content } = component.getTopBorder(WIDTH);
		expect(content).not.toContain("Ctrl+X-");
	});

	it("renders 'Ctrl+X-' when chord leader 'ctrl+x' is pending", () => {
		const component = new StatusLineComponent(makeSession());
		component.setChordPending("ctrl+x");
		const { content } = component.getTopBorder(WIDTH);
		expect(content).toContain("Ctrl+X-");
	});

	it("clears the indicator when clearChordPending is called", () => {
		const component = new StatusLineComponent(makeSession());
		component.setChordPending("ctrl+x");
		component.clearChordPending();
		const { content } = component.getTopBorder(WIDTH);
		expect(content).not.toContain("Ctrl+X-");
	});

	it("fires onStatusChanged exactly once per state transition", () => {
		const component = new StatusLineComponent(makeSession());
		let changes = 0;
		component.onStatusChanged(() => {
			changes += 1;
		});

		component.setChordPending("ctrl+x");
		expect(changes).toBe(1);

		// Idempotent: setting the same leader again should not re-fire.
		component.setChordPending("ctrl+x");
		expect(changes).toBe(1);

		// Transitioning to a different leader fires again.
		component.setChordPending("ctrl+c");
		expect(changes).toBe(2);

		component.clearChordPending();
		expect(changes).toBe(3);

		// Idempotent: clearing when already clear should not re-fire.
		component.clearChordPending();
		expect(changes).toBe(3);
	});
});
