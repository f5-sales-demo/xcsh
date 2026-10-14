import type {
	PluginPresentation,
	PluginPresentationOptions,
	PluginSection,
	PluginView,
} from "@f5-sales-demo/pi-agent-core";

type Fields = Extract<PluginSection, { kind: "fields" }>;
type Table = Extract<PluginSection, { kind: "table" }>;
type Code = Extract<PluginSection, { kind: "code" }>;
export interface PresentationColumn {
	key: string;
	label?: string;
	align?: "left" | "right";
	/** Display formatting only; never changes the execution result or combines units. */
	numberFormat?: Intl.NumberFormatOptions;
}
/** Domain declarations reuse one mapping implementation; no plugin imports renderer code. */
export interface PresentationProfile {
	command?: string;
	scopeKeys?: readonly string[];
	collections?: readonly string[];
	labels?: Readonly<Record<string, string>>;
	scopeNote?: string;
}
export interface PresentationResult {
	content: readonly { type: string; text?: string; mimeType?: string }[];
	details?: unknown;
	isError?: boolean;
}
function valueText(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}
function fields(values: Readonly<Record<string, unknown>>, title?: string): Fields {
	return { kind: "fields", ...(title ? { title } : {}), values };
}
function table(
	rows: readonly Readonly<Record<string, unknown>>[],
	columns?: readonly PresentationColumn[],
	title?: string,
): Table {
	const cols: readonly PresentationColumn[] =
		columns ?? [...new Set(rows.flatMap(row => Object.keys(row)))].map(key => ({ key }));
	return {
		kind: "table",
		...(title ? { title } : {}),
		columns: cols.map(({ numberFormat, ...column }) => ({
			...column,
			...(numberFormat && !column.align ? { align: "right" as const } : {}),
		})),
		rows: cols.some(column => column.numberFormat)
			? rows.map(row => ({
					...row,
					...Object.fromEntries(
						cols.map(column => [
							column.key,
							typeof row[column.key] === "number" && column.numberFormat
								? (row[column.key] as number).toLocaleString("en-US", column.numberFormat)
								: row[column.key],
						]),
					),
				}))
			: rows,
	};
}
function data(value: unknown, title?: string, ancestors = new Set<object>()): PluginSection[] {
	if (value === undefined) return [{ kind: "code", ...(title ? { title } : {}), text: "undefined" }];
	if (value && typeof value === "object") {
		if (ancestors.has(value)) return [fields({ value: "[Circular reference]" }, title)];
		if (value instanceof Date) return [{ kind: "code", ...(title ? { title } : {}), text: valueText(value) }];
		if (Array.isArray(value)) {
			if (!value.length) return [fields({ count: 0 }, title)];
			if (value.every(row => row && typeof row === "object" && !Array.isArray(row)))
				return [table(value, undefined, title)];
			return [{ kind: "code", ...(title ? { title } : {}), text: valueText(value) }];
		}
		const entries = Object.entries(value);
		if (!entries.length) return [{ kind: "code", ...(title ? { title } : {}), text: "{}" }];
		const next = new Set(ancestors).add(value);
		const values: Record<string, unknown> = {};
		const children: PluginSection[] = [];
		for (const [key, child] of entries) {
			if (child !== null && typeof child === "object")
				children.push(...data(child, title ? `${title}.${key}` : key, next));
			else values[key] = child;
		}
		return [...(Object.keys(values).length ? [fields(values, title)] : []), ...children];
	}
	return [fields({ value }, title)];
}
function command(argv: readonly string[], title?: string): Code {
	return {
		kind: "code",
		...(title ? { title } : {}),
		text: argv
			.map(arg => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`))
			.join(" "),
	};
}
/** Safe text/media fallback is also used by the central renderer. */
export function resultView(result: PresentationResult): PluginView {
	const sections = result.content
		.filter(block => block.type === "text" && block.text?.trim())
		.flatMap(block => {
			try {
				return data(JSON.parse(block.text!));
			} catch {
				return [{ kind: "markdown" as const, text: block.text! }];
			}
		});
	if (sections.length && result.isError && result.details !== undefined)
		sections.push(...data(result.details, "Diagnostics"));
	if (!sections.length) {
		const media = result.content.filter(block => block.type !== "text");
		if (media.length)
			sections.push({
				kind: "code",
				text: media.map(block => `${block.type} result${block.mimeType ? ` (${block.mimeType})` : ""}`).join("\n"),
			});
		else if (result.details !== undefined) sections.push(...data(result.details, "Details"));
		else sections.push({ kind: "markdown", text: "(no output)" });
	}
	return { sections };
}
function completenessWarnings(value: unknown, visited = new Set<object>()): string[] {
	if (!value || typeof value !== "object" || visited.has(value)) return [];
	visited.add(value);
	const record = value as Record<string, unknown>;
	const partial =
		record.done === false || record.hasMore === true || record.truncated === true || record.partial === true;
	return [
		...(partial ? ["Results are incomplete. Counts and conclusions apply only to returned data."] : []),
		...Object.values(record).flatMap(child => completenessWarnings(child, visited)),
	];
}
function defaultResult(result: PresentationResult): PluginView {
	if (result.isError || result.details === undefined) return resultView(result);
	const details = result.details;
	if (details && typeof details === "object" && "fullOutput" in details && typeof details.fullOutput === "string") {
		const { fullOutput, ...metadata } = details as Record<string, unknown> & { fullOutput: string };
		return {
			sections: [
				...(resultView({ content: [{ type: "text", text: fullOutput }] }).sections ?? []),
				...data(metadata, "Execution scope"),
			],
		};
	}
	if (details && typeof details === "object" && !Array.isArray(details)) {
		const entries = Object.entries(details).filter(([key]) => !["tool", "action", "errorType"].includes(key));
		if (!entries.length) return resultView(result);
		const values = Object.fromEntries(entries);
		const structured = entries.some(
			([key, value]) =>
				!["meta", "metadata", "scope", "execution"].includes(key) && value !== null && typeof value === "object",
		);
		return {
			sections: [
				...data(values),
				...(!structured && result.content.length ? (resultView(result).sections ?? []) : []),
			],
		};
	}
	return { sections: data(details) };
}
function profileDescriptor(
	profile: PresentationProfile,
	tool: { name: string; label?: string },
): PluginPresentation<unknown, PresentationResult> {
	return {
		call(args) {
			const params = (args ?? {}) as Record<string, unknown>;
			return {
				summary: tool.label ?? tool.name,
				sections:
					profile.command && Array.isArray(params.args)
						? [command([profile.command, ...params.args.map(String)])]
						: data(args),
			};
		},
		result(result, _options, args) {
			if (result.isError) return undefined;
			const params = (args ?? {}) as Record<string, unknown>;
			const details = result.details;
			const scope = Object.fromEntries(
				(profile.scopeKeys ?? [])
					.filter(key => params[key] !== undefined)
					.map(key => [profile.labels?.[key] ?? key, params[key]]),
			);
			const counts: string[] = [];
			const warnings: string[] = [];
			const visited = new Set<object>();
			const inspect = (value: unknown) => {
				if (!value || typeof value !== "object" || visited.has(value)) return;
				visited.add(value);
				for (const [key, child] of Object.entries(value)) {
					if (profile.collections?.includes(key) && Array.isArray(child))
						counts.push(`${child.length} ${key} returned`);
					if (["warnings", "unavailable", "anomalies"].includes(key) && Array.isArray(child))
						warnings.push(
							...child.map(item =>
								typeof item === "object" && item !== null && "message" in item
									? String(item.message)
									: typeof item === "object" && item !== null
										? valueText(item)
										: String(item),
							),
						);
					inspect(child);
				}
			};
			inspect(details);
			const sections =
				defaultResult(result).sections?.map(section =>
					section.kind === "table"
						? {
								...section,
								columns: section.columns.map(column => ({
									...column,
									label: profile.labels?.[column.key] ?? column.label ?? column.key,
								})),
							}
						: section,
				) ?? [];
			return {
				summary: [tool.label ?? tool.name, ...counts].join(" · "),
				warnings,
				sections: [
					fields({ ...scope, ...(profile.scopeNote ? { coverage: profile.scopeNote } : {}) }, "Scope"),
					...sections,
				],
			};
		},
	};
}
export interface BoundPresentation<TArgs, TResult> {
	call(args: TArgs, options: PluginPresentationOptions): PluginView;
	result(result: TResult, options: PluginPresentationOptions, args: TArgs): PluginView;
}
function withPresentation<
	T extends { name: string; label?: string },
	TArgs = unknown,
	TResult extends PresentationResult = PresentationResult,
>(
	tool: T,
	descriptor?: PluginPresentation<TArgs, TResult> | PresentationProfile,
): T & { presentation: BoundPresentation<TArgs, TResult> } {
	const existing = (tool as T & { presentation?: PluginPresentation<TArgs, TResult> }).presentation;
	const configured = descriptor ?? existing;
	const selected =
		configured && !("call" in configured) && !("result" in configured)
			? (profileDescriptor(configured as PresentationProfile, tool) as PluginPresentation<TArgs, TResult>)
			: (configured as PluginPresentation<TArgs, TResult> | undefined);
	const fallbackCall = (args: TArgs): PluginView => ({ summary: tool.label ?? tool.name, sections: data(args) });
	return {
		...tool,
		presentation: {
			call(args: TArgs, options: PluginPresentationOptions) {
				try {
					return selected?.call?.(args, options) ?? fallbackCall(args);
				} catch {
					return fallbackCall(args);
				}
			},
			result(result: TResult, options: PluginPresentationOptions, args: TArgs) {
				let view: PluginView | undefined;
				try {
					view = selected?.result?.(result, options, args);
				} catch {
					/* Retain execution evidence. */
				}
				const fallback = defaultResult(result);
				view = { ...fallback, ...view, sections: view?.sections?.length ? view.sections : fallback.sections };
				return {
					...view,
					warnings: [
						...new Set([
							...(view.warnings ?? []),
							...(options.isPartial ? ["Output is still streaming; results are not final."] : []),
							...completenessWarnings(result.details),
						]),
					],
				};
			},
		},
	};
}
/** One runtime-owned implementation, injected into every extension without renderer imports. */
export const presentation = Object.freeze({
	fields,
	table,
	data: (value: unknown, title?: string) => data(value, title),
	command,
	withPresentation,
});
export type PresentationAPI = typeof presentation;
