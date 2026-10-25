import { expect, test } from "bun:test";
import { CoreRedactor } from "../src/util";

test("overlapping short secrets are replaced once and restore exactly", () => {
	const codec = new CoreRedactor();
	codec.add("b");
	codec.add("ab");
	const redacted = codec.redact("ab b");
	expect(codec.restore(redacted)).toBe("ab b");
});
