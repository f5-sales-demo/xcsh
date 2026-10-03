import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { populateGlobalWeights, readGlobalWeights } from "./global-property-weights";

test("global term weights use one corpus denominator and reject source drift", () => {
	const db = new Database(":memory:");
	populateGlobalWeights(db, [["port", "tls"], ["port", "timeout"], ["asn"]], "source");
	const weights = readGlobalWeights(db, ["port", "asn", "unknown"], "source");
	expect(weights.get("asn")).toBeGreaterThan(weights.get("port")!);
	expect(weights.has("unknown")).toBe(false);
	expect(() => readGlobalWeights(db, ["port"], "changed")).toThrow("source");
	db.close();
});
test("repeated words within a destination count once", () => {
	const a = new Database(":memory:"),
		b = new Database(":memory:");
	populateGlobalWeights(a, [["port", "port"], ["tls"]], "source");
	populateGlobalWeights(b, [["port"], ["tls"]], "source");
	expect([...readGlobalWeights(a, ["port", "tls"], "source")]).toEqual([
		...readGlobalWeights(b, ["port", "tls"], "source"),
	]);
	a.close();
	b.close();
});
