/** Data-only presentation contract. Plugins do not import a renderer at runtime. */
export type PluginSection =
	| { kind: "fields"; title?: string; values: Readonly<Record<string, unknown>>; previewFields?: number | "all" }
	| {
			kind: "table";
			title?: string;
			columns: readonly {
				key: string;
				label?: string;
				align?: "left" | "right";
				minWidth?: number;
				maxWidth?: number;
			}[];
			rows: readonly Readonly<Record<string, unknown>>[];
			/** Complete rows in the collapsed preview; defaults to three. */
			previewRows?: number;
	  }
	| { kind: "markdown"; title?: string; text: string }
	| { kind: "code"; title?: string; text: string; language?: string; argv?: readonly string[] };

export interface PluginView {
	/** Append automatic expanded evidence by default; provided adapters include complete safe evidence. */
	expandedEvidence?: "append" | "provided";
	/** Automatic streaming/pagination warnings by default; provided adapters explain completion. */
	completeness?: "automatic" | "provided";
	summary?: string;
	warnings?: readonly string[];
	sections?: readonly PluginSection[];
}
export interface PluginPresentationOptions {
	readonly expanded: boolean;
	readonly isPartial: boolean;
	/** Available inner columns, resolved on every render. */
	readonly width?: number;
	readonly spinnerFrame?: number;
}
export interface PluginPresentation<TArgs = unknown, TResult = unknown> {
	call?: (args: TArgs, options: PluginPresentationOptions) => PluginView | undefined;
	result?: (result: TResult, options: PluginPresentationOptions, args: TArgs) => PluginView | undefined;
}
