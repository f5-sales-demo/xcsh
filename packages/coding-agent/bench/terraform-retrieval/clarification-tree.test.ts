import { expect, test } from "bun:test";
import {
	evaluateClarificationTree,
	normalizeClarificationTree,
	validateClarificationTree,
	type FrozenClarificationTree,
} from "./clarification-tree";

const root = "xcsh://terraform-documentation/?search=fixture";
const a = root + "&provider_type=resources";
const b = root + "&provider_type=data-sources";
const leafA = "xcsh://terraform-documentation/documentation/resources/fixture/index.md#schema-name";
const leafB = "xcsh://terraform-documentation/documentation/data-sources/fixture/index.md#schema-name";
const tree: FrozenClarificationTree = {
	max_depth: 1,
	root: {
		request: root,
		children: [
			{ request: a, expected: leafA },
			{ request: b, expected: leafB },
		],
	},
};
const reader =
	(initial = `Narrowing choices;\nRefine: ${a}\nRefine: ${b}`) =>
	async (uri: string) => ({
		content:
			uri === root
				? initial
				: uri === a
					? `Selected leaf;\nRead: ${leafA}`
					: uri === b
						? `Selected leaf;\nRead: ${leafB}`
						: "Complete source section.",
	});

test("reviewed branches require exact terminal selection and actual context reads", async () => {
	const result = await evaluateClarificationTree(reader(), tree, 2);
	expect(result.passed).toBe(true);
	expect(result.responses).toHaveLength(3);
	expect(result.tool_calls).toBe(10);
	expect(result.responses.every(row => row.responseHash.length === 64)).toBe(true);
});
test("premature, missing, extra and duplicated choices cannot pass", async () => {
	for (const response of [
		`Selected leaf;\nRead: ${leafA}`,
		`Refine: ${a}`,
		`Refine: ${a}\nRefine: ${b}\nRefine: ${root}&node=unreviewed`,
		`Refine: ${a}\nRefine: ${a}`,
	]) {
		expect((await evaluateClarificationTree(reader(response), tree, 1)).passed).toBe(false);
	}
});
test("frozen tree rejects scope drift, overlapping leaves and unbounded traversal", () => {
	expect(() => validateClarificationTree({ ...tree, max_depth: 0 })).toThrow("depth");
	expect(() =>
		validateClarificationTree({
			...tree,
			root: {
				...tree.root,
				children: [
					{ request: a.replace("fixture", "different"), expected: leafA },
					{ request: b, expected: leafB },
				],
			},
		}),
	).toThrow("scope");
	expect(() =>
		validateClarificationTree({
			...tree,
			root: {
				...tree.root,
				children: [
					{ request: a, expected: leafA },
					{ request: b, expected: leafA },
				],
			},
		}),
	).toThrow("overlap");
});
test("wrong terminal anchors and unstable responses fail evaluation", async () => {
	const wrong = async (uri: string) => ({
		content:
			uri === root
				? `Refine: ${a}\nRefine: ${b}`
				: uri === a || uri === b
					? `Selected leaf;\nRead: ${leafA}`
					: "Source section.",
	});
	expect((await evaluateClarificationTree(wrong, tree, 1)).passed).toBe(false);
	let counter = 0;
	await expect(
		evaluateClarificationTree(async () => ({ content: `No results ${counter++}` }), tree, 2),
	).rejects.toThrow("Non-deterministic");
});

test("frozen requests reject duplicate parameters and non-discovery destinations", () => {
	expect(() =>
		validateClarificationTree({ ...tree, root: { ...tree.root, request: root + "&search=fixture" } }),
	).toThrow("Duplicate");
	expect(() => validateClarificationTree({ ...tree, root: { ...tree.root, request: root + "&cursor=page" } })).toThrow(
		"Unsupported",
	);
	expect(() => validateClarificationTree({ ...tree, root: { ...tree.root, request: leafA } })).toThrow("request");
});

test("authored descriptive requests adapt without changing decisions or targets", () => {
	const adapted = normalizeClarificationTree({
		max_depth: 1,
		root_request: { query: "fixture", caller_filters: {} },
		branches: [
			{
				child_request: { query: "fixture", caller_filters: { provider_type: "resources" } },
				terminal_expected: leafA,
			},
			{
				child_request: { query: "fixture", caller_filters: { provider_type: "data-sources" } },
				terminal_expected: leafB,
			},
		],
	});
	expect(adapted).toEqual(tree);
	validateClarificationTree(adapted);
});

test("equivalent refinement parameter order does not change the frozen branch", async () => {
	const scopedRoot = root + "&category=security";
	const scopedTree = {
		max_depth: 1,
		root: {
			request: scopedRoot,
			children: [
				{ request: scopedRoot + "&provider_type=resources", expected: leafA },
				{ request: scopedRoot + "&provider_type=data-sources", expected: leafB },
			],
		},
	};
	const read = async (uri: string) => ({
		content:
			uri === scopedRoot
				? `Narrowing choices;\nRefine: xcsh://terraform-documentation/?provider_type=resources&category=security&search=fixture\nRefine: xcsh://terraform-documentation/?category=security&search=fixture&provider_type=data-sources`
				: uri === scopedTree.root.children[0]!.request
					? `Selected leaf;\nRead: ${leafA}`
					: uri === scopedTree.root.children[1]!.request
						? `Selected leaf;\nRead: ${leafB}`
						: "Source section.",
	});
	expect((await evaluateClarificationTree(read, scopedTree, 1)).passed).toBe(true);
});

test("bounded same-scope choice pagination covers frozen alternatives without loops", async () => {
	const page = root + "&choice_after=1";
	const read = async (uri: string) => ({
		content:
			uri === root
				? `Narrowing choices;\nRefine: ${a}\nContinue: ${page}`
				: uri === page
					? `Narrowing choices;\nRefine: ${b}`
					: uri === a
						? `Selected leaf;\nRead: ${leafA}`
						: uri === b
							? `Selected leaf;\nRead: ${leafB}`
							: "Source section.",
	});
	expect((await evaluateClarificationTree(read, tree, 1)).passed).toBe(true);
	const unsafe = async (uri: string) =>
		uri === root ? { content: `Refine: ${a}\nContinue: ${root}&provider_type=resources&choice_after=1` } : read(uri);
	expect((await evaluateClarificationTree(unsafe, tree, 1)).passed).toBe(false);
});
