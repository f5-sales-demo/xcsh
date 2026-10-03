import { expect, test } from "bun:test";
import { evaluateClarificationTree, validateClarificationTree, type FrozenClarificationTree } from "./clarification-tree";

const root = "xcsh://terraform-documentation/?search=fixture";
const a = root + "&provider_type=resources";
const b = root + "&provider_type=data-sources";
const leafA = "xcsh://terraform-documentation/documentation/resources/fixture/index.md#schema-name";
const leafB = "xcsh://terraform-documentation/documentation/data-sources/fixture/index.md#schema-name";
const tree: FrozenClarificationTree = { max_depth: 1, root: { request: root, children: [
	{ request: a, expected: leafA }, { request: b, expected: leafB },
] } };
const reader = (initial = `Narrowing choices;\nRefine: ${a}\nRefine: ${b}`) => async (uri: string) => ({
	content: uri === root ? initial : uri === a ? `Selected leaf;\nRead: ${leafA}` :
		uri === b ? `Selected leaf;\nRead: ${leafB}` : "Complete source section.",
});

test("reviewed branches require exact terminal selection and actual context reads", async () => {
	const result = await evaluateClarificationTree(reader(), tree, 2);
	expect(result.passed).toBe(true);
	expect(result.responses).toHaveLength(3);
	expect(result.tool_calls).toBe(10);
	expect(result.responses.every(row => row.responseHash.length === 64)).toBe(true);
});
test("premature, missing, extra and duplicated choices cannot pass", async () => {
	for (const response of [`Selected leaf;\nRead: ${leafA}`, `Refine: ${a}`,
		`Refine: ${a}\nRefine: ${b}\nRefine: ${root}&node=unreviewed`, `Refine: ${a}\nRefine: ${a}`]) {
		expect((await evaluateClarificationTree(reader(response), tree, 1)).passed).toBe(false);
	}
});
test("frozen tree rejects scope drift, overlapping leaves and unbounded traversal", () => {
	expect(() => validateClarificationTree({ ...tree, max_depth: 0 })).toThrow("depth");
	expect(() => validateClarificationTree({ ...tree, root: { ...tree.root, children: [
		{ request: a.replace("fixture", "different"), expected: leafA }, { request: b, expected: leafB },
	] } })).toThrow("scope");
	expect(() => validateClarificationTree({ ...tree, root: { ...tree.root, children: [
		{ request: a, expected: leafA }, { request: b, expected: leafA },
	] } })).toThrow("overlap");
});
test("wrong terminal anchors and unstable responses fail evaluation", async () => {
	const wrong = async (uri: string) => ({ content: uri === root ? `Refine: ${a}\nRefine: ${b}` :
		uri === a || uri === b ? `Selected leaf;\nRead: ${leafA}` : "Source section." });
	expect((await evaluateClarificationTree(wrong, tree, 1)).passed).toBe(false);
	let counter = 0;
	await expect(evaluateClarificationTree(async () => ({ content: `No results ${counter++}` }), tree, 2)).rejects.toThrow("Non-deterministic");
});
