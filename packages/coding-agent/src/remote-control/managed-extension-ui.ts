import type { ExtensionUIContext, ExtensionUIDialogOptions } from "../extensibility/extensions/types";
import type { CreateAgentSessionResult } from "../sdk";
import type { AgentSession } from "../session/agent-session";
import type { UserInteractionSpec } from "../session/user-interactions";

/** Managed workers have a remote presenter, not a local terminal dialog. */
export function initializeManagedExtensionUI(
	session: AgentSession,
	setToolUIContext: CreateAgentSessionResult["setToolUIContext"],
): void {
	const runner = session.extensionRunner;
	if (!runner) return;
	const request = async (
		spec: UserInteractionSpec & { kind: "select" | "input" },
		options?: ExtensionUIDialogOptions,
	): Promise<string | undefined> => {
		const timeout = new AbortController();
		const signal = options?.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
		const timer =
			options?.timeout === undefined
				? undefined
				: setTimeout(() => {
						timeout.abort();
						options.onTimeout?.();
					}, options.timeout);
		try {
			// No local callback: lack of a terminal must not answer or dismiss the request.
			return await session.userInteractions.request(spec, undefined, signal);
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	};
	const ui: ExtensionUIContext = {
		...runner.getUIContext(),
		select: (title, options, dialog) => request({ kind: "select", title, options }, dialog),
		confirm: async (title, message, dialog) =>
			(await request({ kind: "select", title: `${title}\n${message}`, options: ["Yes", "No"] }, dialog)) === "Yes",
		input: (title, _placeholder, dialog) => request({ kind: "input", title }, dialog),
		editor: (title, _prefill, dialog) => request({ kind: "input", title }, dialog),
	};
	runner.initialize(
		{
			sendMessage: (message, options) => {
				void session.sendCustomMessage(message, options).catch(error =>
					runner.emitError({
						extensionPath: "managed-session",
						event: "extension_send",
						error: String(error),
					}),
				);
			},
			sendUserMessage: (content, options) => {
				void session.sendUserMessage(content, options).catch(error =>
					runner.emitError({
						extensionPath: "managed-session",
						event: "extension_send_user",
						error: String(error),
					}),
				);
			},
			appendEntry: (type, data) => {
				session.sessionManager.appendCustomEntry(type, data);
			},
			setLabel: (id, label) => {
				session.sessionManager.appendLabelChange(id, label);
			},
			getActiveTools: () => session.getActiveToolNames(),
			getAllTools: () => session.getAllToolNames(),
			setActiveTools: names => session.setActiveToolsByName(names),
			getCommands: () => [],
			setModel: async model => {
				if (!(await session.modelRegistry.getApiKey(model))) return false;
				await session.setModel(model);
				return true;
			},
			getThinkingLevel: () => session.thinkingLevel,
			setThinkingLevel: level => session.setThinkingLevel(level),
			getSessionName: () => session.sessionManager.getSessionName(),
			setSessionName: async name => {
				await session.sessionManager.setSessionName(name, "user");
			},
		},
		{
			getModel: () => session.model,
			isIdle: () => !session.isStreaming,
			abort: () => {
				void session.abort();
			},
			hasPendingMessages: () => session.queuedMessageCount > 0,
			shutdown: () => {
				void session.dispose();
			},
			getSystemPrompt: () => session.systemPrompt,
			getContextUsage: () => session.getContextUsage(),
			compact: async instructionsOrOptions => {
				const instructions = typeof instructionsOrOptions === "string" ? instructionsOrOptions : undefined;
				const options =
					instructionsOrOptions && typeof instructionsOrOptions === "object" ? instructionsOrOptions : undefined;
				await session.compact(instructions, options);
			},
		},
		undefined,
		ui,
	);
	setToolUIContext(ui, true);
}
