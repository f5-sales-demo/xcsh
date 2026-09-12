/** Codex realtime state port, copyright OpenAI, Apache-2.0; see ../remote-control/NOTICE.md. */
import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import { prompt } from "@f5-sales-demo/pi-utils";
import endTemplate from "../prompts/system/remote-voice-mode-end.md" with { type: "text" };
import startTemplate from "../prompts/system/remote-voice-mode-start.md" with { type: "text" };

export interface RealtimeModeInstructions {
	start?: string;
	end?: string;
}

export class RealtimeContext {
	#mode?: { sessionId: string; active: boolean; instructions: RealtimeModeInstructions };
	#turn?: { sessionId: string; active: boolean };
	update(sessionId: string, active: boolean, instructions: RealtimeModeInstructions): void {
		this.#mode = { sessionId, active, instructions: { ...instructions } };
	}
	beginTurn(sessionId: string): void {
		this.#turn = { sessionId, active: this.#mode?.sessionId === sessionId && this.#mode.active };
	}
	messages(sessionId: string, retained: readonly AgentMessage[]): AgentMessage[] {
		if (this.#turn?.sessionId !== sessionId) return [];
		// The native custom type is the persisted boolean snapshot. It also recognizes
		// earlier native instructions written without the pinned fragment wrapper.
		const previous = retained.findLast(
			message =>
				(message.role === "custom" || message.role === "hookMessage") &&
				(message.customType === "remote-voice-start" || message.customType === "remote-voice-end"),
		);
		const active = this.#turn.active;
		const previousActive =
			previous && "customType" in previous ? previous.customType === "remote-voice-start" : undefined;
		if (active === previousActive || (!active && previousActive === undefined)) return [];
		const phase = active ? "start" : "end";
		const instructions = this.#mode?.sessionId === sessionId ? this.#mode.instructions : {};
		const body = instructions[phase] ?? prompt.render(active ? startTemplate : endTemplate).trim();
		return [
			{
				role: "custom",
				customType: `remote-voice-${phase}`,
				content: `<realtime_conversation>\n${body}\n</realtime_conversation>`,
				display: false,
				attribution: "agent",
				timestamp: Date.now(),
			},
		];
	}
}
