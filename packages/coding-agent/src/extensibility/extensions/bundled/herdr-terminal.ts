import type { ExtensionAPI, ExtensionContext } from "@f5-sales-demo/xcsh";
import { HerdrController } from "../../../herdr/controller";

type Action = "list" | "create" | "run" | "send" | "read" | "wait" | "status" | "focus" | "close";
interface TerminalParams {
	action: Action;
	target?: string;
	name?: string;
	cwd?: string;
	command?: string;
	text?: string;
	match?: string;
	lines?: number;
	timeoutMs?: number;
	enter?: boolean;
	force?: boolean;
}

export function createRetryingLazy<T>(factory: () => Promise<T>): () => Promise<T> {
	let pending: Promise<T> | undefined;
	return () => {
		pending ??= factory().catch(error => {
			pending = undefined;
			throw error;
		});
		return pending;
	};
}

function sessionRef(ctx: ExtensionContext): string | undefined {
	return ctx.sessionManager.getSessionFile?.() ?? ctx.sessionManager.getSessionId?.();
}

async function dispatch(controller: HerdrController, params: TerminalParams): Promise<unknown> {
	switch (params.action) {
		case "list":
			return controller.list();
		case "create":
			return controller.create(params.name ?? "", params.cwd);
		case "run":
			await controller.run(params.target ?? "", params.command ?? "");
			return { ok: true };
		case "send":
			await controller.send(params.target ?? "", params.text ?? "", params.enter);
			return { ok: true };
		case "read":
			return controller.read(params.target ?? "", params.lines);
		case "wait":
			return controller.wait(params.target ?? "", params.match ?? "", params.timeoutMs);
		case "status":
			return controller.status(params.target ?? "");
		case "focus":
			await controller.focus(params.target ?? "");
			return { ok: true };
		case "close":
			await controller.close(params.target ?? "", params.force);
			return { ok: true };
	}
}

export default function herdrTerminal(pi: ExtensionAPI): void {
	const { Type } = pi.typebox;
	const controller = createRetryingLazy(() => HerdrController.connect());

	pi.registerTool({
		name: "herdr_terminal",
		label: "Herdr Terminal",
		description:
			"Manage support terminals owned by the current xcsh conversation. Actions: list, create, run, send, read, wait, status, focus, close. Focus and forced close must be explicit.",
		parameters: Type.Object({
			action: Type.Union(
				["list", "create", "run", "send", "read", "wait", "status", "focus", "close"].map(value =>
					Type.Literal(value),
				),
			),
			target: Type.Optional(Type.String({ description: "Terminal name or owned pane ID" })),
			name: Type.Optional(Type.String({ description: "Name for a newly created terminal" })),
			cwd: Type.Optional(Type.String({ description: "Working directory for a newly created terminal" })),
			command: Type.Optional(Type.String({ description: "Command for run" })),
			text: Type.Optional(Type.String({ description: "Text for send" })),
			match: Type.Optional(Type.String({ description: "Literal output awaited by wait" })),
			lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
			timeoutMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 300000 })),
			enter: Type.Optional(Type.Boolean()),
			force: Type.Optional(Type.Boolean({ description: "Required on the second close call for a busy pane" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const active = await controller();
				await active.updateSessionRef(sessionRef(ctx));
				const result = await dispatch(active, params as TerminalParams);
				return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { content: [{ type: "text", text: message }], details: { error: message }, isError: true };
			}
		},
	});

	pi.registerCommand("terminal", {
		description: "Manage Herdr terminals: /terminal <list|create|run|send|read|wait|status|focus|close>",
		handler: async (args, ctx) => {
			const [action = "list", target, ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const params: TerminalParams = { action: action as Action, target };
			if (action === "create") params.name = target;
			if (action === "run") params.command = rest.join(" ");
			if (action === "send") params.text = rest.join(" ");
			if (action === "wait") params.match = rest.join(" ");
			if (action === "read" && rest[0]) params.lines = Number(rest[0]);
			if (action === "close") params.force = rest.includes("--force");
			try {
				const active = await controller();
				await active.updateSessionRef(sessionRef(ctx));
				ctx.ui.notify(JSON.stringify(await dispatch(active, params), null, 2), "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	const update = async (_event: unknown, ctx: ExtensionContext): Promise<void> => {
		if (!process.env.HERDR_SOCKET_PATH) return;
		try {
			await (await controller()).updateSessionRef(sessionRef(ctx));
		} catch (error) {
			pi.logger.debug("Herdr terminal binding update failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};
	pi.on("session_start", update);
	pi.on("session_switch", update);
	pi.on("session_branch", update);
	pi.on("session_tree", update);
}
