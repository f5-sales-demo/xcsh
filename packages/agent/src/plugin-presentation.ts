/** Data-only presentation contract. Plugins do not import a renderer at runtime. */
export type PluginSection =
	| { kind: "fields"; title?: string; values: Readonly<Record<string, unknown>> }
	| {
			kind: "table";
			title?: string;
			columns: readonly { key: string; label?: string; align?: "left" | "right" }[];
			rows: readonly Readonly<Record<string, unknown>>[];
	  }
	| { kind: "markdown"; title?: string; text: string }
	| { kind: "code"; title?: string; text: string; language?: string };

export interface PluginView {
	summary?: string;
	warnings?: readonly string[];
	sections?: readonly PluginSection[];
}
export interface PluginPresentationOptions {
	expanded: boolean;
	isPartial: boolean;
}
export interface PluginPresentation<TArgs = unknown, TResult = unknown> {
	call?: (args: TArgs, options: PluginPresentationOptions) => PluginView | undefined;
	result?: (result: TResult, options: PluginPresentationOptions, args: TArgs) => PluginView | undefined;
}
