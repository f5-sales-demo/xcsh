import { measureCompleteRetrieval } from "./complete-measurement";

export interface FrozenClarificationNode {
	request: string;
	children?: FrozenClarificationNode[];
	expected?: string;
}
export interface FrozenClarificationTree {
	max_depth: number;
	root: FrozenClarificationNode;
}

const exactDestination = (value: string) => {
	const uri = new URL(value);
	if (uri.protocol !== "xcsh:" || uri.host !== "terraform-documentation")
		throw new Error("Invalid frozen Terraform destination");
	uri.search = "";
	return uri.href;
};

export function validateClarificationTree(tree: FrozenClarificationTree): void {
	if (!Number.isInteger(tree.max_depth) || tree.max_depth < 1 || tree.max_depth > 40)
		throw new Error("Invalid frozen clarification depth");
	const requests = new Set<string>();
	const leaves = new Set<string>();
	const visit = (node: FrozenClarificationNode, parent: FrozenClarificationNode | undefined, depth: number) => {
		if (depth > tree.max_depth) throw new Error("Frozen clarification exceeds reviewed depth");
		const uri = new URL(node.request);
        const allowed = new Set(["search","node","provider_type","provider_name","role","category","capability","task","limit"]);
        for (const key of uri.searchParams.keys()) if(!allowed.has(key)) throw new Error("Unsupported frozen clarification parameter");
        for (const key of uri.searchParams.keys()) if(uri.searchParams.getAll(key).length!==1) throw new Error("Duplicate frozen clarification parameter");
		if (uri.protocol !== "xcsh:" || uri.host !== "terraform-documentation" || uri.pathname !== "/" || uri.hash)
			throw new Error("Invalid frozen clarification request");
		if (!uri.searchParams.get("search")) throw new Error("Frozen clarification requires query");
		if (requests.has(uri.href)) throw new Error("Frozen clarification loop or duplicate request");
		requests.add(uri.href);
		if (parent) {
			const previous = new URL(parent.request);
			for (const [key, value] of previous.searchParams) {
				if (key === "node") continue; // Source audit must verify strict descendant narrowing.
				if (uri.searchParams.get(key) !== value) throw new Error("Frozen clarification drops caller scope");
			}
			if (uri.href === previous.href) throw new Error("Frozen clarification does not narrow scope");
		}
		if (node.children) {
			if (node.expected || node.children.length < 2 || node.children.length > 5)
				throw new Error("Frozen clarification requires two to five exclusive branches");
			for (const child of node.children) visit(child, node, depth + 1);
		} else {
			if (!node.expected) throw new Error("Frozen clarification terminal destination missing");
			const leaf = exactDestination(node.expected);
			if (leaves.has(leaf)) throw new Error("Frozen clarification branches overlap");
			leaves.add(leaf);
		}
	};
	visit(tree.root, undefined, 0);
	if (leaves.size < 2) throw new Error("Frozen clarification is not ambiguous");
}

// The independent source audit must separately attest each node, descendant
// partition and omitted decision. Runtime evaluation cannot establish necessity.
export async function evaluateClarificationTree(
	read: (uri: string) => Promise<{ content: string }>,
	tree: FrozenClarificationTree,
	repetitions = 5,
) {
	validateClarificationTree(tree);
	const findings: string[] = [];
	const responses: Array<Awaited<ReturnType<typeof measureCompleteRetrieval>> & { request: string }> = [];
	const visit = async (node: FrozenClarificationNode) => {
		const measured = await measureCompleteRetrieval(read, node.request, repetitions);
		responses.push({ request: node.request, ...measured });
		const selected = measured.discovery.includes("Selected leaf;");
		const reads = [...measured.discovery.matchAll(/^Read: (\S+)/gm)].map(match => exactDestination(match[1]!));
		if (node.children) {
			if (selected) findings.push(`Premature leaf: ${node.request}`);
			if (reads.length) findings.push(`Off-tree leaf candidates: ${node.request}`);
			const actual = [...measured.discovery.matchAll(/^Refine: (\S+)/gm)].map(match => new URL(match[1]!).href);
			const expected = node.children.map(child => new URL(child.request).href);
			if (actual.length !== expected.length || new Set(actual).size !== actual.length ||
				actual.some(uri => !expected.includes(uri))) findings.push(`Missing or extra frozen branches: ${node.request}`);
			// Visit declared branches only; never probe unreviewed returned links.
			for (const child of node.children) await visit(child);
		} else if (!selected || reads[0] !== exactDestination(node.expected!) || !measured.context) {
			findings.push(`Incorrect terminal leaf or missing actual context read: ${node.request}`);
		}
	};
	await visit(tree.root);
	return { passed: findings.length === 0, findings, responses,
		tool_calls: responses.reduce((sum, row) => sum + row.toolCalls, 0),
		total_response_bytes: responses.reduce((sum, row) => sum + row.totalBytes, 0) };
}
