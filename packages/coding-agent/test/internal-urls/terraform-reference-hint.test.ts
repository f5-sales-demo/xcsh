import { expect, test } from "bun:test";
import { referenceOwnershipHint } from "../../src/internal-urls/terraform-reference-evidence";

const reference = {
	version: 1,
	scope_path: ["backend"],
	member: "namespace",
	upstream_message: "ves.io.schema.ObjectRefType",
	source: "receipt-pinned-schema-identity",
};
test("ownership hint names the referenced scope and preserves advisory distinction", () => {
	const hint = referenceOwnershipHint(reference, ["backend", "namespace"]);
	expect(hint).toContain("backend.namespace");
	expect(hint).toContain("referenced object");
	expect(hint).toContain("receipt-pinned-schema-identity");
	expect(hint).not.toContain("requires");
});
test("absent metadata yields no invented ownership and malformed evidence rejects", () => {
	expect(referenceOwnershipHint(undefined, ["namespace"])).toBe("");
	expect(() => referenceOwnershipHint(reference, ["namespace"])).toThrow();
});

test("long ownership labels remain complete rather than silently clipped", () => {
	const segment = "a".repeat(500);
	const evidence = { ...reference, scope_path: [segment] };
	const hint = referenceOwnershipHint(evidence, [segment, "namespace"]);
	expect(hint).toContain(segment + ".namespace");
	expect(hint).toContain("receipt-pinned-schema-identity");
});
