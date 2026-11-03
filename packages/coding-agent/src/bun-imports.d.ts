/**
 * Type declarations for Bun's import attributes.
 * These allow importing non-JS files as text at build time.
 */

// Markdown files imported as text
declare module "*.md" {
	const content: string;
	export default content;
}

// Text files imported as text
declare module "*.txt" {
	const content: string;
	export default content;
}

// Python files imported as text
declare module "*.py" {
	const content: string;
	export default content;
}

// Bun file imports expose the emitted asset path.
declare module "*.sqlite.gz" {
	const path: string;
	export default path;
}

declare module "*.wasm" {
	const path: string;
	export default path;
}
