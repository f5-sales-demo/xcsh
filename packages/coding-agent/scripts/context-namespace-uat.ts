import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PtySession } from "@f5-sales-demo/pi-natives";
import { createCaptureTerminal, terminalViewportAnsi, writeTerminalCapture } from "./terminal-capture";
import { createTerminalUatProfile } from "./terminal-uat-profile";

// Synthetic terminal acceptance; loopback transport only, with no provider prompts.
const output = process.argv[2];
const executable = process.argv[3];
if (!output) throw new Error("Usage: bun scripts/context-namespace-uat.ts OUTPUT_DIRECTORY [INSTALLED_EXECUTABLE]");
await mkdir(output, { recursive: true });
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const tlsDirectory = await mkdtemp(join(tmpdir(), "xcsh-namespace-uat-tls-"));
const certificate = join(tlsDirectory, "certificate.pem");
const key = join(tlsDirectory, "key.pem");
const openssl = Bun.spawn(
	[
		"openssl",
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-days",
		"1",
		"-keyout",
		key,
		"-out",
		certificate,
		"-subj",
		"/CN=127.0.0.1",
		"-addext",
		"subjectAltName=IP:127.0.0.1",
	],
	{ stdout: "ignore", stderr: "pipe" },
);
if ((await openssl.exited) !== 0) throw new Error(await new Response(openssl.stderr).text());
const requests: Array<{ method: string; path: string; contextCredentialMatches?: boolean }> = [];
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	tls: { cert: Bun.file(certificate), key: Bun.file(key) },
	fetch(request) {
		const path = new URL(request.url).pathname;
		const contextCredentialMatches =
			path === "/api/web/namespaces"
				? request.headers.get("Authorization") === "APIToken synthetic-context-token"
				: undefined;
		requests.push({ method: request.method, path, contextCredentialMatches });
		if (path === "/api/web/namespaces")
			return contextCredentialMatches
				? Response.json({ items: [{ name: "default" }] })
				: new Response("Synthetic credential mismatch", { status: 401 });
		return new Response("Unexpected synthetic request", { status: 500 });
	},
});
try {
	for (const guided of [false, true]) {
		const profile = await createTerminalUatProfile();
		profile.env.HOME = profile.root;
		profile.env.PI_CONFIG_DIR = "config";
		let passed = false;
		const contexts = join(profile.env.XDG_CONFIG_HOME, "xcsh", "contexts");
		await mkdir(contexts, { recursive: true });
		const file = join(contexts, "namespace-uat.json");
		await Bun.write(
			file,
			JSON.stringify({
				name: "namespace-uat",
				apiUrl: server.url.origin,
				apiToken: "synthetic-context-token",
				defaultNamespace: "ns-old",
			}),
		);
		const pointer = join(contexts, "..", "active_context");
		await Bun.write(pointer, "namespace-uat");
		const before = await readFile(file, "utf8");
		Object.assign(profile.env, {
			ANTHROPIC_API_KEY: "synthetic-provider-key",
			NODE_EXTRA_CA_CERTS: certificate,
			XCSH_API_URL: "https://inherited.example.invalid",
			XCSH_API_TOKEN: "synthetic-inherited-token",
			XCSH_NAMESPACE: "ns-old",
			XCSH_USERNAME: "synthetic-inherited-login",
		});
		await Bun.write(
			join(profile.agentDir, "models.yml"),
			JSON.stringify({ providers: { anthropic: { baseUrl: server.url.origin, apiKey: "synthetic-provider-key" } } }),
		);
		profile.args.push("--provider", "anthropic", "--model", "claude-sonnet-4-5");
		if (executable) profile.args.splice(0, 2, executable);
		const terminal = createCaptureTerminal(80, 24);
		const pty = new PtySession();
		let writes = Promise.resolve();
		let stream = "";
		let ended = false;
		terminal.onData(data => {
			if (!ended) pty.write(data);
		});
		const command = [
			"env",
			"-i",
			...Object.entries(profile.env).map(([key, value]) => `${key}=${value}`),
			...profile.args,
		]
			.map(quote)
			.join(" ");
		const done = pty
			.start({ command, cwd: profile.cwd, cols: 80, rows: 24, timeoutMs: 60_000 }, (_error, chunk) => {
				stream += chunk;
				writes = writes.then(() => new Promise<void>(resolve => terminal.write(chunk, resolve)));
			})
			.then(result => {
				ended = true;
				return result;
			});
		const screen = () =>
			Array.from(
				{ length: terminal.rows },
				(_, row) =>
					terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true) ?? "",
			).join("\n");
		const wait = async (predicate: () => boolean, label: string) => {
			const deadline = performance.now() + 20_000;
			while (!predicate()) {
				if (ended || performance.now() > deadline) throw new Error(`Failed to reach ${label}: ${screen()}`);
				await Bun.sleep(25);
				await writes;
			}
		};
		const capture = async (name: string) => {
			await writes;
			await writeTerminalCapture(
				output,
				name,
				terminalViewportAnsi(terminal),
				{ columns: 80, rows: 24 },
				{ foreground: "#d8dee9", background: "#101522" },
				{ kind: "actual-terminal-viewport", path: guided ? "guided" : "explicit", synthetic: true },
			);
		};
		try {
			await wait(
				() => screen().includes("127:ns-old") && stream.includes("\x1b[?2004h"),
				"initial context border and input handler",
			);
			await Bun.sleep(150);
			await writes;
			await capture(guided ? "guided-before" : "explicit-before");
			pty.write(guided ? "/context namespace\r" : "/context namespace default\r");
			if (guided) {
				await wait(() => screen().includes("Session namespace"), "guided selector");
				await capture("guided-selector");
				pty.write("\r");
			}
			await wait(
				() => screen().includes("127:default") && screen().includes("Namespace default"),
				"updated context border and feedback",
			);
			await capture(guided ? "guided-after" : "explicit-after");
			pty.write(`! printf 'NS=%s LOGIN=%s' "$XCSH_NAMESPACE" "\${XCSH_USERNAME-unset}"\r`);
			await wait(() => screen().includes("NS=default LOGIN=unset"), "next shell namespace and absent login");
			await capture(guided ? "guided-shell" : "explicit-shell");
			if ((await readFile(file, "utf8")) !== before || (await readFile(pointer, "utf8")) !== "namespace-uat")
				throw new Error("Session namespace selection changed saved configuration");
			await Bun.write(
				join(output, `${guided ? "guided" : "explicit"}-receipt.json`),
				JSON.stringify(
					{
						result: "pass",
						path: guided ? "guided" : "explicit",
						before: "127:ns-old",
						after: "127:default",
						executionMode: executable ? "installed-release" : "source",
						savedProfileUnchanged: true,
						startupPointerUnchanged: true,
						shellNamespaceMatched: true,
						missingLoginAbsent: true,
						executableSha256: createHash("sha256")
							.update(await readFile(executable ?? process.execPath))
							.digest("hex"),
					},
					null,
					2,
				),
			);
			passed = true;
		} finally {
			if (!ended) pty.kill();
			await done;
			terminal.dispose();
			if (passed) await rm(profile.root, { recursive: true, force: true });
			else console.error("Preserved failed synthetic profile:", profile.root);
		}
	}
	await Bun.write(join(output, "transport-receipt.json"), JSON.stringify({ loopbackOnly: true, requests }, null, 2));
	if (requests.some(request => request.contextCredentialMatches === false))
		throw new Error("Synthetic F5 requests did not use the applied context credential");
	if (requests.some(request => !["GET", "HEAD"].includes(request.method)))
		throw new Error("Unexpected provider prompt or write request in synthetic namespace acceptance");
	console.log(
		"PASS: context credentials, explicit/guided namespace selection, future shell targeting, stored border and saved-file invariance",
	);
} finally {
	server.stop(true);
	await rm(tlsDirectory, { recursive: true, force: true });
}
