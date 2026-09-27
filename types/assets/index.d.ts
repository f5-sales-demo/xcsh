declare module "*.md" {
	const content: string;
	export default content;
}

declare module "*.txt" {
	const content: string;
	export default content;
}

declare module "*.py" {
	const content: string;
	export default content;
}

// Binary files imported as paths for Bun compiled executables.
declare module "*.tar.gz" {
	const filePath: string;
	export default filePath;
}

declare module "*.sqlite" {
	const filePath: string;
	export default filePath;
}

declare module "*.sqlite.gz" {
	const filePath: string;
	export default filePath;
}

declare module "*.wasm" {
	const filePath: string;
	export default filePath;
}

// turndown-plugin-gfm has no published types
declare module "turndown-plugin-gfm" {
	import type TurndownService from "turndown";
	export const gfm: TurndownService.Plugin;
	export const tables: TurndownService.Plugin;
	export const strikethrough: TurndownService.Plugin;
	export const taskListItems: TurndownService.Plugin;
}
