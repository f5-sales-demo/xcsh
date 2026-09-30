import { describe, expect, it } from "bun:test";
import * as path from "node:path";

describe("non-executing curl output validation", () => {
	const validator = path.resolve(import.meta.dir, "../../../scripts/validate_curl_example.py");
	const command =
		'curl -X POST "$XCSH_API_URL/api/config/namespaces/default/http_loadbalancers" -H "Authorization: APIToken $XCSH_API_TOKEN" -H "Content-Type: application/json" -d \'{"metadata":{"name":"curl-example","namespace":"default"},"spec":{"domains":["curl-example.example.com"],"http":{"port":80}}}\'';
	async function validate(body: string): Promise<number> {
		const child = Bun.spawn(["python3", validator, "POST"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
		child.stdin.write(`\`\`\`bash\n${body}\n\`\`\``);
		child.stdin.end();
		return child.exited;
	}
	it("parses quoted environment variables and valid JSON without execution", async () => {
		expect(await validate(command)).toBe(0);
		expect(await validate("# Set the required environment variables first\n" + command)).toBe(0);
	});
	it("rejects wrong targets, methods, token headers and invalid JSON", async () => {
		for (const invalid of [
			command.replace("/default/", "/other/"),
			command.replace("POST", "DELETE"),
			command.replace("APIToken", "Bearer"),
			command.replace('"port":80', '"port":'),
		]) {
			expect(await validate(invalid)).not.toBe(0);
		}
	});
});
