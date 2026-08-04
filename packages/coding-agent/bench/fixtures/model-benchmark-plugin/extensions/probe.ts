import type { ExtensionAPI } from "../../../../src/extensibility/extensions";

export default function modelBenchmarkPlugin(pi: ExtensionAPI): void {
	const { Type } = pi.typebox;
	pi.registerTool({
		name: "xcsh_plugin_echo",
		label: "xcsh Plugin Echo",
		description: "Return a deterministic xcsh plugin token with the supplied correlation value",
		parameters: Type.Object({
			value: Type.String({ description: "Benchmark correlation value" }),
		}),
		async execute(_toolCallId, params) {
			return {
				content: [{ type: "text", text: `XCSH_PLUGIN_ECHO_OK_C91D:${params.value}` }],
				details: { value: params.value },
			};
		},
	});
}
