import type { Locator } from "./selector";

export interface AxNode {
	role: string;
	name?: string;
	children?: AxNode[];
	[k: string]: unknown;
}

export class NotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NotFoundError";
	}
}

export class AmbiguousError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AmbiguousError";
	}
}

function norm(s: string): string {
	return s.trim().replace(/\s+/g, " ");
}

function collect(node: AxNode, results: AxNode[]): void {
	results.push(node);
	for (const child of node.children ?? []) {
		collect(child, results);
	}
}

export function matchNode(tree: AxNode, loc: Locator): AxNode {
	if (loc.kind === "css") {
		throw new Error("css locators cannot be resolved against an AX tree — resolve live via CDP");
	}

	const all: AxNode[] = [];
	collect(tree, all);

	let matches: AxNode[];

	if (loc.kind === "roleName") {
		const wantRole = loc.role;
		const wantName = norm(loc.name);
		matches = all.filter(n => {
			if (n.role !== wantRole) return false;
			const nodeName = norm(n.name ?? "");
			// roleName from role:text('X') pattern — text match (includes)
			// roleName from role[name='X'] pattern — exact match
			// We always use exact match for roleName kind (the parser normalises both patterns to roleName)
			return nodeName === wantName;
		});
	} else if (loc.kind === "role") {
		matches = all.filter(n => n.role === loc.role);
	} else {
		// kind === "text"
		const want = norm(loc.text);
		matches = all.filter(n => {
			const nodeName = norm(n.name ?? "");
			return nodeName === want || nodeName.includes(want);
		});
	}

	if (matches.length === 0) {
		// Collect same-role candidates for helpful error message
		const sameRole =
			loc.kind === "roleName" ? all.filter(n => n.role === loc.role && n.name).map(n => JSON.stringify(n.name)) : [];
		const hint = sameRole.length > 0 ? ` (same-role candidates: ${sameRole.slice(0, 5).join(", ")})` : "";
		throw new NotFoundError(`No AX node found for ${JSON.stringify(loc)}${hint}`);
	}

	if (matches.length > 1) {
		const names = matches.map(n => JSON.stringify(n.name ?? n.role));
		throw new AmbiguousError(
			`${matches.length} AX nodes match ${JSON.stringify(loc)}: ${names.slice(0, 5).join(", ")}`,
		);
	}

	return matches[0]!;
}
