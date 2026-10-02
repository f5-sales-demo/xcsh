import {expect,test} from "bun:test";
import {rankTerraformSections,terraformSectionTerms} from "./section-ranking";
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

test("schema and ordinary prose share semantic terms without dropping success", () => {
 expect(terraformSectionTerms("https_auto_cert")).toEqual(expect.arrayContaining(["https","auto","certificate"]));
 expect(terraformSectionTerms("automatically manage TLS certificates")).toEqual(expect.arrayContaining(["auto","certificate"]));
 expect(terraformSectionTerms("login succeeded")).toContain("success");
 expect(terraformSectionTerms("timeouts.create")).toEqual(expect.arrayContaining(["timeout","create"]));
 expect(terraformSectionTerms("initial creation")).toEqual(expect.arrayContaining(["create"]));
});
test("automatic certificate ownership and response success keep opposite branches separate", () => {
 const certs=[
 {schema_path:"https",description:"Choice for HTTP proxy with bring your own certificates.",path:"manual",anchor:"section"},
 {schema_path:"https_auto_cert",description:"Choice for HTTP proxy with bring your own certificates.",path:"auto",anchor:"section"},
 ];
 expect(rankTerraformSections("automatically provision TLS certificates",certs)[0]?.path).toBe("auto");
 const status=[
 {schema_path:"login.transaction_result.failure_conditions.status",description:"HTTP status.",path:"failure",anchor:"schema-status"},
 {schema_path:"login.transaction_result.success_conditions.status",description:"HTTP status.",path:"success",anchor:"schema-status"},
 ];
 expect(rankTerraformSections("login transaction succeeded HTTP status",status)[0]?.path).toBe("success");
});

test("explicit field request ranks a direct field above its enclosing object", () => {
 const rows=[
 {schema_path:"origin_servers.public_ip",description:"Public IP address.",path:"parent",anchor:"section"},
 {schema_path:"origin_servers.public_ip.ip",description:"IP address.",path:"parent",anchor:"schema-ip"},
 ];
 expect(rankTerraformSections("public IP address",rows)[0]?.anchor).toBe("schema-ip");
});
