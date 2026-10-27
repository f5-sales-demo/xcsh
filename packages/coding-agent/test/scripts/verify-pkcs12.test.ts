import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../..");
const helper = join(root, "scripts/verify-pkcs12.sh");
const directories: string[] = [];
const password = "synthetic-test-password";
const env: Record<string, string | undefined> = { ...process.env, XCSH_TEST_P12_PASSWORD: password };
const run = (argv: string[], environment = env) => Bun.spawnSync(argv, { env: environment });
afterEach(async () => {
	await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function directory() {
	const path = await mkdtemp(join(tmpdir(), "xcsh-pkcs12-test-"));
	directories.push(path);
	return path;
}

describe("signing PKCS12 validation", () => {
	test("binds both certificate readers to the trusted workflow controller", async () => {
		const workflow = Bun.YAML.parse(await Bun.file(join(root, ".github/workflows/ci.yml")).text()) as {
			jobs: Record<string, { steps: { name?: string; run?: string; with?: Record<string, string> }[] }>;
		};
		const steps = workflow.jobs["build-sign-macos"]!.steps;
		expect(steps.find(step => step.name === "Checkout trusted signing controller")?.with).toMatchObject({
			// biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions evaluates this expression.
			ref: "${{ github.workflow_sha }}",
			path: ".controller",
		});
		const validation = steps.find(step => step.name === "Import Code Signing Certificate")?.run ?? "";
		expect(validation.match(/sh \.controller\/scripts\/verify-pkcs12\.sh/g)?.length).toBe(2);
		expect(validation).toContain("APPLE_CERTIFICATE_PASSWORD ||");
		expect(validation).toContain("APPLE_INSTALLER_CERTIFICATE_PASSWORD >/dev/null");
		expect(validation).not.toContain("openssl pkcs12");
	});
	test("validates a real legacy container while retaining password and integrity failures", async () => {
		const path = await directory();
		const key = join(path, "key.pem");
		const cert = join(path, "cert.pem");
		const p12 = join(path, "certificate.p12");
		expect(
			run([
				"openssl",
				"req",
				"-x509",
				"-newkey",
				"rsa:2048",
				"-nodes",
				"-keyout",
				key,
				"-out",
				cert,
				"-days",
				"1",
				"-subj",
				"/CN=example.invalid",
			]).exitCode,
		).toBe(0);
		expect(
			run([
				"openssl",
				"pkcs12",
				"-export",
				"-legacy",
				"-inkey",
				key,
				"-in",
				cert,
				"-out",
				p12,
				"-passout",
				"env:XCSH_TEST_P12_PASSWORD",
			]).exitCode,
		).toBe(0);
		const original = run([
			"openssl",
			"pkcs12",
			"-info",
			"-in",
			p12,
			"-noout",
			"-passin",
			"env:XCSH_TEST_P12_PASSWORD",
		]);
		expect(original.exitCode).not.toBe(0);
		expect(original.stderr.toString()).toContain("unsupported");
		expect(run(["sh", helper, p12, "XCSH_TEST_P12_PASSWORD"]).exitCode).toBe(0);
		expect(
			run(["sh", helper, p12, "XCSH_TEST_P12_PASSWORD"], { ...env, XCSH_TEST_P12_PASSWORD: "wrong" }).exitCode,
		).not.toBe(0);
		await writeFile(p12, "invalid container");
		expect(run(["sh", helper, p12, "XCSH_TEST_P12_PASSWORD"]).exitCode).not.toBe(0);
	}, 30_000);

	test.each([true, false])(
		"uses advertised legacy support=%s and transports only the password environment name",
		async legacy => {
			const path = await directory();
			const p12 = join(path, "certificate.p12");
			const argvPath = join(path, "arguments");
			const openssl = join(path, "openssl");
			await writeFile(p12, "synthetic");
			await writeFile(
				openssl,
				`#!/bin/sh\nif [ "$2" = "-help" ]; then\n  echo '${legacy ? "-legacy" : "LibreSSL usage"}'\n  exit 0\nfi\nprintf '%s\\n' "$@" > "$XCSH_TEST_ARGV"\n`,
			);
			await chmod(openssl, 0o755);
			const result = run(["sh", helper, p12, "XCSH_TEST_P12_PASSWORD"], {
				...env,
				PATH: `${path}:${env.PATH}`,
				XCSH_TEST_ARGV: argvPath,
			});
			expect(result.exitCode).toBe(0);
			const args = await Bun.file(argvPath).text();
			expect(args.includes("-legacy\n")).toBe(legacy);
			expect(args).toContain("env:XCSH_TEST_P12_PASSWORD");
			expect(args).not.toContain(password);
		},
	);
});
