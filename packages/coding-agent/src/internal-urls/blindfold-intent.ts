import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import { prompt } from "@f5-sales-demo/pi-utils";
import template from "../prompts/system/blindfold-awareness.md" with { type: "text" };

/** Deterministic intent over admitted user task text, never retrieved/model content. */
export function classifyBlindfoldIntent(text: string, previous: boolean): boolean {
	const automaticCertificateProtocol = "ACME protocol";
	const task = text.toLowerCase().replace(/[–—_/-]/g, " ");
	if (
		/\b(?:new topic|unrelated|switch topics|instead talk|forget (?:that|this)|do not use blindfold|don't use blindfold)\b/.test(
			task,
		)
	)
		return false;
	if (
		!/\b(?:f5|xcsh|distributed cloud)\b/.test(task) &&
		/\b(?:aws|amazon|azure|google cloud|gcp|kubernetes|cert manager|nginx|apache|iis|cloudflare|vault)\b/.test(task)
	)
		return false;
	if (/\b(?:blindfold(?:ing)?|xcsh blindfold|blindfold secret info)\b/.test(task)) return true;
	const custom =
		/\b(?:custom|byoc|bring (?:your|my|our) own)\b/.test(task) && /\b(?:certificates?|certs?|byoc)\b/.test(task);
	const formatInput = /\b(?:protected|encrypted) pem\b|\bpkcs\s*#?\s*12\b/.test(task);
	const privateInput =
		/\b(?:protected|encrypted) pem\b|\bpkcs\s*#?\s*12\b|\bcertificate\s*(?:and\s*)?key pair\b|\bprivate keys?\b/.test(
			task,
		);
	const operation =
		/\b(?:import(?:ing)?|prepar(?:e|ing|ation)|encrypt(?:ing|ion)?|upload(?:ing)?|rotate|rotating|rotation)\b/.test(
			task,
		);
	const owned =
		/\b(?:my|our|your|owned|existing|own)\b/.test(task) &&
		/\b(?:certificates?|certs?|secrets?|keys?|inputs?)\b/.test(task);
	if (custom || formatInput || (privateInput && operation)) return true;
	if (
		task.split(/\W+/).includes(automaticCertificateProtocol.split(" ")[0].toLowerCase()) ||
		/\b(?:automatic|automated|managed|let'?s encrypt|public certificate|tls|ssl|handshake)\b/.test(task)
	)
		return false;
	if (owned && operation) return true;
	if (!previous) return false;
	return (
		/^(?:now |also |then |please )?(?:prepare|encrypt|import|upload|rotate|verify|validate|inspect|use|keep|continue|explain|how|what|can|yes|no)\b/.test(
			task,
		) && /\b(?:it|that|this|same|them|those|offline|key pair|passphrase|bundle)\b/.test(task)
	);
}

export function renderBlindfoldHint(active: boolean): string {
	const content = prompt.render(template, { active });
	if (Buffer.byteLength(content) > 1024) throw new Error("Blindfold awareness hint exceeds 1 KiB");
	return content;
}

/** Session-only intent. Resumed history has no admitted intent; tool selections persist separately. */
export class BlindfoldTaskIntent {
	#sessionId: string | undefined;
	#previous = false;
	#tasks = new WeakMap<AgentMessage, boolean>();

	admit(message: AgentMessage, text: string, sessionId: string): void {
		if (this.#sessionId !== sessionId) {
			this.#sessionId = sessionId;
			this.#previous = false;
			this.#tasks = new WeakMap();
		}
		if (message.role !== "user" || message.attribution === "agent" || this.#tasks.has(message)) return;
		this.#previous = classifyBlindfoldIntent(text, this.#previous);
		this.#tasks.set(message, this.#previous);
	}

	context(messages: AgentMessage[], sessionId: string, active: boolean, available: boolean): AgentMessage[] {
		if (!available || sessionId !== this.#sessionId) return messages;
		let index = messages.length - 1;
		while (index >= 0) {
			const message = messages[index];
			if (message.role === "developer" || (message.role === "custom" && message.attribution === "agent"))
				return messages;
			if (message.role === "user") {
				if (message.attribution === "agent") return messages;
				break;
			}
			index--;
		}
		if (index < 0 || !this.#tasks.get(messages[index])) return messages;
		const hint: AgentMessage = {
			role: "custom",
			customType: "blindfold-awareness",
			content: renderBlindfoldHint(active),
			display: false,
			attribution: "agent",
			timestamp: messages[index].timestamp,
		};
		return [...messages.slice(0, index), hint, ...messages.slice(index)];
	}
}
