import { test } from "bun:test";
import { execSync } from "node:child_process";
import * as path from "node:path";

test("repository does not contain hardcoded internal FQDNs", () => {
	const cwd = path.resolve(import.meta.dir, "..");
	// We want to verify that there are no internal/local FQDNs hardcoded in the src directory, excluding tests and examples.
	// Common internal domains: .internal, .corp, .local
	// We check specifically for URL forms (e.g. http:// or https://) containing these domains.
	try {
		// Use git grep to only search tracked files in src.
		// Look for https?://[a-zA-Z0-9.-]+\.(internal|corp|local)([:/]|$)
		const result = execSync(`git grep -I -E "https?://[a-zA-Z0-9.-]+\\.(internal|corp|local)([:/]|$)" -- src/`, {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "ignore"],
		});

		if (result.trim()) {
			throw new Error(`Found hardcoded internal FQDNs in src/:\n${result}`);
		}
	} catch (err: any) {
		// git grep returns 1 if no matches found, which is what we want
		if (err.status === 1) {
			return; // success
		}
		throw err;
	}
});
