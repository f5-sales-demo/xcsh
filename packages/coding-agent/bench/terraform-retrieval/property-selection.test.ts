import { expect, test } from "bun:test";
import { selectPropertyDestination } from "./property-selection";
const row = (schema_path: string, score: number, provider_type = "resources") => ({
	provider_type,
	provider_name: "fixture",
	schema_path,
	path: `documentation/${provider_type}/fixture/${schema_path}/index.md`,
	anchor: `schema-${schema_path.replaceAll(".", "--")}`,
	description: "Documented setting.",
	score,
	coverage: 0.8,
});
test("a large rank gap cannot decide an omitted repeated branch", () => {
	const rows = [row("inside.routes.address", 50), row("outside.routes.address", 10)];
	expect(selectPropertyDestination("set route address", rows).kind).toBe("choices");
	expect(selectPropertyDestination("set inside route address", rows).kind).toBe("leaf");
});
test("provider role collisions require role evidence even with separated ranks", () => {
	const rows = [row("tls.port", 50), row("tls.port", 10, "data-sources")];
	expect(selectPropertyDestination("TLS port", rows).kind).toBe("choices");
	expect(selectPropertyDestination("TLS port on managed resource", [rows[0]!]).kind).toBe("leaf");
});
test("unrelated high-ranking prose does not overcome absent field coverage", () => {
	expect(selectPropertyDestination("configure unseen option", [{ ...row("tls.port", 50), coverage: 0.1 }]).kind).toBe(
		"choices",
	);
});
test("close distinct fields remain choices and ties are deterministic", () => {
	const rows = [row("timeout", 30), row("idle_timeout", 29)];
	expect(selectPropertyDestination("adjust timeout", rows).kind).toBe("choices");
	expect(selectPropertyDestination("adjust timeout", rows)).toEqual(
		selectPropertyDestination("adjust timeout", rows.slice().reverse()),
	);
});
test("contradictory IP family and route side exclude alternatives", () => {
	const rows = [row("outside.ipv4.addr", 50), row("outside.ipv6.addr", 49), row("inside.ipv4.addr", 48)];
	expect(selectPropertyDestination("outside IPv4 address", rows).kind).toBe("leaf");
});

test("indexed collision alternatives protect against missing top-five branches", () => {
	const top = row("https_auto_cert.http_redirect", 50);
	const alternative = row("https.http_redirect", 1);
	expect(selectPropertyDestination("enable HTTP redirect to HTTPS", [top], [alternative]).kind).toBe("choices");
});

test("unrelated repeated field names do not require missing branch context", () => {
	const first = { ...row("listener.port", 50), description: "HTTPS listening port." };
	const other = { ...row("routing.port", 10), description: "BGP transport port." };
	expect(selectPropertyDestination("HTTPS listening port", [first], [other]).kind).toBe("leaf");
});

test("explicit dual-stack context excludes its otherwise identical single-stack destination", () => {
	const rows = [row("outside.dual_stack.ipv4.addr", 50), row("outside.ipv4.addr", 49)];
	expect(selectPropertyDestination("outside dual stack IPv4 address", rows).kind).toBe("leaf");
	expect(selectPropertyDestination("outside IPv4 address", rows).kind).toBe("choices");
});

test("unsupported explicit field identifiers cannot disappear from coverage", () => {
	expect(selectPropertyDestination("set invented_flag on TLS port", [row("tls.port", 50)]).kind).toBe("none");
	expect(selectPropertyDestination("set tls_port", [row("tls_port", 50)]).kind).toBe("leaf");
});

test("the enclosing block does not compete with a specifically requested direct field", () => {
	const field = row("tls.version", 40);
	const parent = { ...row("tls", 39), anchor: "section" };
	expect(selectPropertyDestination("TLS version field", [field, parent]).kind).toBe("leaf");
});
test("a complete multiword field name separates nearby sibling fields", () => {
	const total = row("limits.total_number", 40);
	const burst = row("limits.burst_multiplier", 39);
	expect(selectPropertyDestination("total maximum number of requests", [total, burst]).kind).toBe("leaf");
	expect(selectPropertyDestination("adjust request limits", [total, burst]).kind).toBe("choices");
});
