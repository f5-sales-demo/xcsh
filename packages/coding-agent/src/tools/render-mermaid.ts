import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@f5-sales-demo/pi-agent-core";
import {
	type MermaidAsciiRenderOptions,
	mermaidSourceExceedsLimit,
	prompt,
	renderMermaidAsciiSafe,
} from "@f5-sales-demo/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import renderMermaidDescription from "../prompts/tools/render-mermaid.md" with { type: "text" };
import type { ToolSession } from "./index";

const renderMermaidSchema = Type.Object({
	mermaid: Type.String({ description: "Mermaid graph source text" }),
	config: Type.Optional(
		Type.Object({
			useAscii: Type.Optional(Type.Boolean()),
			paddingX: Type.Optional(Type.Number()),
			paddingY: Type.Optional(Type.Number()),
			boxBorderPadding: Type.Optional(Type.Number()),
		}),
	),
});

type RenderMermaidParams = Static<typeof renderMermaidSchema>;

function sanitizeRenderConfig(config: MermaidAsciiRenderOptions | undefined): MermaidAsciiRenderOptions | undefined {
	if (!config) return undefined;
	return {
		useAscii: config.useAscii,
		boxBorderPadding:
			config.boxBorderPadding === undefined ? undefined : Math.max(0, Math.floor(config.boxBorderPadding)),
		paddingX: config.paddingX === undefined ? undefined : Math.max(0, Math.floor(config.paddingX)),
		paddingY: config.paddingY === undefined ? undefined : Math.max(0, Math.floor(config.paddingY)),
	};
}
export interface RenderMermaidToolDetails {
	artifactId?: string;
}

export class RenderMermaidTool implements AgentTool<typeof renderMermaidSchema, RenderMermaidToolDetails> {
	readonly name = "render_mermaid";
	readonly label = "RenderMermaid";
	readonly description: string;
	readonly parameters = renderMermaidSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(renderMermaidDescription);
	}

	async execute(
		_toolCallId: string,
		params: RenderMermaidParams,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<RenderMermaidToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<RenderMermaidToolDetails>> {
		// Reject oversized graphs up front: beautiful-mermaid's pathfinder can hang
		// for tens of seconds and then throw `RangeError: Out of memory` on them.
		// Throwing here (fast) surfaces a clean tool error the agent can recover from.
		if (mermaidSourceExceedsLimit(params.mermaid)) {
			throw new Error(
				"Mermaid diagram is too large to render safely. Reduce the number of nodes/edges and try again.",
			);
		}

		// Safe variant: a parse failure or memory blow-up becomes null rather than a
		// raw RangeError, so we can throw a clear, actionable message instead.
		const ascii = renderMermaidAsciiSafe(params.mermaid, sanitizeRenderConfig(params.config));
		if (ascii == null || ascii.trim() === "") {
			throw new Error(
				"Failed to render the Mermaid diagram — the syntax may be unsupported or too complex. Use newline-separated statements (no ';') and try a simpler diagram.",
			);
		}

		const { path: artifactPath, id: artifactId } =
			(await this.session.allocateOutputArtifact?.("render_mermaid")) ?? {};
		if (artifactPath) {
			await Bun.write(artifactPath, ascii);
		}

		const artifactLine = artifactId ? `\n\nSaved artifact: artifact://${artifactId}` : "";
		return {
			content: [{ type: "text", text: `${ascii}${artifactLine}` }],
			details: { artifactId },
		};
	}
}
