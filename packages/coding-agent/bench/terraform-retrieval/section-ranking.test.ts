import {expect,test} from "bun:test";
import {rankTerraformSections} from "./section-ranking";
test("section ranking keeps semantic path context and favors the requested direct property", () => {
	const rows = [
		{
			schema_path: "https.port",
			description: "Listen port for HTTPS connections.",
			path: "https",
			anchor: "schema-https--port",
		},
		{
			schema_path: "http.port",
			description: "Listen port for HTTP connections.",
			path: "http",
			anchor: "schema-http--port",
		},
		{ schema_path: "https", description: "Configure HTTPS certificates.", path: "https", anchor: "section" },
	];
	expect(rankTerraformSections("HTTPS listener port", rows)[0]?.schema_path).toBe("https.port");
	const cookies = [
		{
			schema_path: "cookies_none.cookie_operator",
			description: "Cookie operator rules.",
			path: "none",
			anchor: "section",
		},
		{
			schema_path: "cookies_and.cookie_operator",
			description: "Cookie operator rules.",
			path: "and",
			anchor: "section",
		},
	];
	const ranked = rankTerraformSections("cookie operator rules", cookies);
	expect(ranked[0]?.ranking).toBe(ranked[1]?.ranking);
});
