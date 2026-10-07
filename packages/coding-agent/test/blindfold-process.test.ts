import { afterAll, describe, expect, test } from "bun:test";
import { createPrivateKey } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const dir = mkdtempSync(join(tmpdir(), "blindfold-process-"));
const fixtures = await Bun.file(join(root, "packages/natives/test/fixtures/blindfold-synthetic.json")).json();
const jwk = createPrivateKey(Buffer.from(fixtures["rsa-key.pem"], "base64")).export({ format: "jwk" });
writeFileSync(
	join(dir, "pub"),
	JSON.stringify({
		data: {
			tenant: "example-tenant",
			key_version: 1,
			modulus_base64: Buffer.from(jwk.n!, "base64url").toString("base64"),
			public_exponent_base64: Buffer.from(jwk.e!, "base64url").toString("base64"),
		},
	}),
);
writeFileSync(join(dir, "policy"), 'data:\n  tenant: example-tenant\n  policy_id: "101"\n');
const bytes = Buffer.from(Array.from({ length: 2048 }, (_, i) => i % 256));
writeFileSync(join(dir, "secret"), bytes);
// A small CLI harness exercises the exact shared adapter and native boundary while forbidding network.
writeFileSync(join(dir, ".vesconfig"), "malformed legacy config must be ignored");
const harness = join(dir, "cli.ts");
writeFileSync(
	harness,
	`import { runBlindfold } from ${JSON.stringify(join(root, "packages/coding-agent/src/commands/blindfold.ts"))};\nimport { CliUsageError } from ${JSON.stringify(join(root, "packages/utils/src/cli.ts"))};\nprocess.stderr.write("ready\\n");\nglobalThis.fetch=()=>{throw new Error("network forbidden")};\ntry {await runBlindfold(process.argv.slice(2),true)} catch(e) {process.stderr.write(String(e.message)+"\\n");process.exitCode=e instanceof CliUsageError ? 2:1}\n`,
);
const base = ["secrets", "encrypt", "--public-key", join(dir, "pub"), "--policy-document", join(dir, "policy")];
function start(args: string[], stdin: "pipe" | Uint8Array = "pipe") {
	return Bun.spawn([process.execPath, harness, ...args], {
		cwd: dir,
		env: {
			PATH: process.env.PATH!,
			HOME: dir,
			XDG_CONFIG_HOME: dir,
			VES_P12_PASSWORD: "legacy-unused",
			VES_SERVER_URL: "https://invalid.example",
		},
		stdin,
		stdout: "pipe",
		stderr: "pipe",
	});
}
async function result(child: ReturnType<typeof start>) {
	const [code, out, err] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { code, out, err: err.replace("ready\n", "") };
}
describe("Blindfold CLI native process boundary", () => {
	test("file, explicit stdin and implicit redirected stdin emit only an envelope", async () => {
		for (const input of [[join(dir, "secret")], ["-"], []]) {
			const child = start([...base, ...input], bytes);
			const r = await result(child);
			expect(r.code).toBe(0);
			expect(r.err).toBe("");
			expect(r.out).toMatch(/^string:\/\/\/[A-Za-z0-9+/]+=*\n$/);
			expect(r.out.trim().length).toBe(3506);
		}
	}, 60000);
	test("usage errors produce stderr and never wait for input", async () => {
		for (const args of [
			[...base, "a", "b"],
			[...base, "--wat"],
			[...base, "--json", "--output-file", "out"],
		]) {
			const child = start(args);
			const r = await result(child);
			expect(r.code).toBe(2);
			expect(r.out).toBe("");
			expect(r.err.length).toBeGreaterThan(0);
		}
	}, 60000);
	test("SIGINT cancels a waiting native stdin reader with exit 130", async () => {
		const child = start([...base, "-"]);
		const reader = child.stderr.getReader();
		const ready = await reader.read();
		expect(new TextDecoder().decode(ready.value)).toBe("ready\n");

		await Bun.sleep(150);
		child.kill("SIGINT");
		const errorChunks: Uint8Array[] = [];
		const rest = (async () => {
			for (;;) {
				const chunk = await reader.read();
				if (chunk.done) break;
				errorChunks.push(chunk.value);
			}
			return Buffer.concat(errorChunks).toString();
		})();
		const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), rest]);
		const r = { code, out, err };
		expect(r.code).toBe(130);
		expect(r.out).toBe("");
		expect(r.err).toContain("cancelled");
	}, 30000);
	test("oversized stdin is bounded and operational errors stay on stderr", async () => {
		const r = await result(start([...base, "-"], Buffer.alloc(2 * 1024 * 1024 + 1)));
		expect(r.code).toBe(1);
		expect(r.out).toBe("");
		expect(r.err).toContain("2 MiB");
	}, 30000);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
