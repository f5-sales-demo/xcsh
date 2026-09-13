import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PtySession } from "@f5-sales-demo/pi-natives";
import { createCaptureTerminal } from "./terminal-capture";
import { createTerminalUatProfile } from "./terminal-uat-profile";

const BASELINE_COMMIT = "0c6d27e4afacc42b598478d1fba532ef1eab9204";
const PRE_FIX_COMMIT = "e68d757fa7ebf6f6e5b36d52138e99712c565065";
const root = resolve(import.meta.dir, "../../..");
const args = process.argv.slice(2);
const valueFor = (flag: string) => {
	const index = args.indexOf(flag);
	return index === -1 ? undefined : args[index + 1];
};
const baselineRoot = valueFor("--baseline-root");
const preFixRoot = valueFor("--pre-fix-root");
if (!baselineRoot || !preFixRoot)
	throw new Error(
		"Usage: bun capture-resource-review-differential.ts --baseline-root <v21.24.4 worktree> --pre-fix-root <e68d757 worktree>",
	);
const output = resolve(
	valueFor("--output") ??
		join(root, "packages/coding-agent/test/evidence/resource-review-differential-v1/receipt.json"),
);

interface MutationObservation {
	openedViewport: string;
	requestCountBeforeEscape: number;
	objectPresentBeforeEscape: boolean;
	requestCountAfterEscape: number;
	objectPresentAfterEscape: boolean;
	confirmed?: {
		requestCount: number;
		objectPresent: boolean;
		viewport: string;
	};
	startupError?: string;
	startupStream?: string;
}

interface FailureRetryObservation {
	failureRequestCount: number;
	objectPresentAfterFailure: boolean;
	failureViewport: string;
	retryRequestCount: number;
	objectPresentAfterRetry: boolean;
	retryViewport: string;
}

interface DryRunObservation {
	viewport: string;
	updateCount: number;
	objectPresent: boolean;
}

interface ReadObservation {
	viewport: string;
	requestCount: number;
	objectPresent: boolean;
}

interface ManifestObservation {
	openedViewport: string;
	requestCountBeforeEscape: number;
	fileExistsBeforeEscape: boolean;
	fileExistsAfterEscape: boolean;
	confirmed?: {
		fileExists: boolean;
		content: string;
		viewport: string;
	};
	unresolved?: {
		fileExists: boolean;
		viewport: string;
	};
}

interface CandidateReceipt {
	commit: string;
	create: MutationObservation;
	list: ReadObservation;
	get: ReadObservation;
	describe: ReadObservation;
	diff: ReadObservation;
	dryRun: DryRunObservation;
	apply: MutationObservation;
	manifest: ManifestObservation;
	delete: MutationObservation;
	deleteFailureRetry: FailureRetryObservation;
}

async function commit(directory: string): Promise<string> {
	const child = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: directory, stdout: "pipe", stderr: "pipe" });
	const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
	if (exitCode !== 0) throw new Error(`Cannot resolve commit for ${directory}`);
	return stdout.trim();
}

function quote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function sanitize(value: string): string {
	return value
		.replaceAll(/\/Users\/[^\n]*/g, "<user-path>")
		.replaceAll(/(?:\/private)?\/var\/folders\/[^\n]*/g, "<isolated-temp-path>")
		.replaceAll(/xcsh-terminal-uat-[A-Za-z0-9]+/g, "xcsh-terminal-uat-XXXXXX");
}

function viewport(terminal: ReturnType<typeof createCaptureTerminal>): string {
	return sanitize(
		Array.from(
			{ length: terminal.rows },
			(_, row) =>
				terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true) ?? "",
		).join("\n"),
	);
}

async function captureCandidate(
	directory: string,
	expectedCommit: string,
	providerUrl: string,
	mutations: {
		createCount: () => number;
		updateCount: () => number;
		deleteCount: () => number;
		readCount: () => number;
		objectPresent: () => boolean;
	},
): Promise<CandidateReceipt> {
	const actualCommit = await commit(directory);
	if (actualCommit !== expectedCommit)
		throw new Error(`Expected ${expectedCommit}, got ${actualCommit} in ${directory}`);
	const profile = await createTerminalUatProfile({ columns: 80, rows: 24, theme: "dark", symbols: "unicode" }, "none");
	const contexts = join(profile.env.XDG_CONFIG_HOME, "xcsh", "contexts");
	await mkdir(contexts, { recursive: true, mode: 0o700 });
	await Bun.write(
		join(contexts, "resource.json"),
		JSON.stringify(
			{
				name: "resource",
				apiUrl: providerUrl,
				apiToken: "xcsh-resource-review-token",
				defaultNamespace: "demo",
				version: 1,
			},
			null,
			2,
		),
	);
	await Bun.write(join(profile.env.XDG_CONFIG_HOME, "xcsh", "active_context"), "resource\n");
	const manifest = join(profile.cwd, "resource.yaml");
	await Bun.write(
		manifest,
		"kind: http_loadbalancer\nmetadata:\n  name: review-differential\n  namespace: demo\nspec:\n  domains:\n    - review.example.test\n  routes: []\n  origin_pools: []\n",
	);
	await Bun.write(
		join(profile.agentDir, "models.yml"),
		JSON.stringify({ providers: { anthropic: { baseUrl: providerUrl, apiKey: "synthetic-resource-review" } } }),
	);
	const terminal = createCaptureTerminal(80, 24);
	const pty = new PtySession();
	let stream = "";
	let ended = false;
	let error: Error | undefined;
	let writes = Promise.resolve();
	const done = pty
		.start(
			{
				command: [
					process.execPath,
					join(directory, "packages/coding-agent/src/cli.ts"),
					"--no-extensions",
					"--no-skills",
					"--no-rules",
					"--no-tools",
					"--no-mcp",
					"--no-lsp",
					"--no-title",
					"--no-memories",
					"--provider",
					"anthropic",
					"--model",
					"claude-sonnet-4-5",
					...(expectedCommit === BASELINE_COMMIT ? ["--context", "resource"] : []),
					"--session-dir",
					join(profile.root, "sessions"),
				]
					.map(quote)
					.join(" "),
				cwd: profile.cwd,
				env: profile.env,
				cols: 80,
				rows: 24,
				timeoutMs: 30_000,
			},
			(issue, chunk) => {
				if (issue) error = issue;
				stream += chunk ?? "";
				writes = writes.then(() => new Promise<void>(resolve => terminal.write(chunk ?? "", resolve)));
			},
		)
		.then(() => {
			ended = true;
		});
	const wait = async (predicate: () => boolean | Promise<boolean>, label: string, timeout = 10_000) => {
		const deadline = performance.now() + timeout;
		while (performance.now() < deadline) {
			await writes;
			if (error) throw error;
			if (await predicate()) return;
			if (ended) throw new Error(`candidate exited before ${label}`);
			await Bun.sleep(25);
		}
		throw new Error(`timed out waiting for ${label}`);
	};
	try {
		await wait(() => stream.includes("\x1b[?2004h") && stream.includes("xcsh v"), "interactive editor");
		// The first render advertises bracketed paste before its input controller is
		// ready. Keep a short settling window so the first command cannot be lost.
		await Bun.sleep(900);
		await writes;
		pty.write(`/create -f ${manifest}\r`);
		await wait(
			() =>
				mutations.objectPresent() ||
				viewport(terminal).includes("Review resource create") ||
				viewport(terminal).includes(" created") ||
				viewport(terminal).includes("Error:"),
			"resource create outcome",
		);
		const create: MutationObservation = {
			openedViewport: viewport(terminal),
			requestCountBeforeEscape: mutations.createCount(),
			objectPresentBeforeEscape: mutations.objectPresent(),
			requestCountAfterEscape: 0,
			objectPresentAfterEscape: false,
		};
		if (create.openedViewport.includes("Review resource create")) {
			pty.write("\x1b");
			await Bun.sleep(350);
			await writes;
		}
		create.requestCountAfterEscape = mutations.createCount();
		create.objectPresentAfterEscape = mutations.objectPresent();
		if (create.openedViewport.includes("Review resource create")) {
			pty.write(`/create -f ${manifest}\r`);
			await wait(() => viewport(terminal).includes("Review resource create"), "second resource create review");
			pty.write("\x1b[B\r");
			await Bun.sleep(1_100);
			await writes;
			create.confirmed = {
				requestCount: mutations.createCount(),
				objectPresent: mutations.objectPresent(),
				viewport: viewport(terminal),
			};
		}
		if (create.confirmed) {
			pty.write("\x1b");
			await Bun.sleep(200);
			await writes;
		}
		const closeReport = async () => {
			for (let attempt = 0; attempt < 3 && viewport(terminal).includes("Esc: close"); attempt += 1) {
				pty.write("\x1b");
				await Bun.sleep(500);
				await writes;
			}
		};
		const captureRead = async (command: string, label: string): Promise<ReadObservation> => {
			const readsBefore = mutations.readCount();
			pty.write(`${command}\r`);
			await wait(() => mutations.readCount() > readsBefore || viewport(terminal).includes("Error:"), label);
			await Bun.sleep(200);
			await writes;
			const observation = {
				viewport: viewport(terminal),
				requestCount: mutations.readCount() - readsBefore,
				objectPresent: mutations.objectPresent(),
			} satisfies ReadObservation;
			await closeReport();
			return observation;
		};
		const list = await captureRead("/get http_loadbalancer -n demo", "resource list");
		const get = await captureRead("/get http_loadbalancer review-differential -n demo", "resource get");
		const describe = await captureRead(
			"/describe http_loadbalancer review-differential -n demo",
			"resource describe",
		);
		const diff = await captureRead(`/diff -f ${manifest}`, "resource diff");
		await Bun.write(
			manifest,
			"kind: http_loadbalancer\nmetadata:\n  name: review-differential\n  namespace: demo\nspec:\n  domains:\n    - updated-review.example.test\n  routes: []\n  origin_pools: []\n",
		);
		const updatesBeforeDryRun = mutations.updateCount();
		pty.write(`/apply -f ${manifest} --dry-run=client\r`);
		await wait(
			() =>
				mutations.updateCount() !== updatesBeforeDryRun ||
				viewport(terminal).includes(" dry-run") ||
				viewport(terminal).includes("Review resource apply") ||
				viewport(terminal).includes("Error:"),
			"resource apply dry-run outcome",
		);
		const dryRun = {
			viewport: viewport(terminal),
			updateCount: mutations.updateCount() - updatesBeforeDryRun,
			objectPresent: mutations.objectPresent(),
		} satisfies DryRunObservation;
		await closeReport();
		const updatesBeforeOpen = mutations.updateCount();
		pty.write(`/apply -f ${manifest}\r`);
		await wait(
			() =>
				mutations.updateCount() !== updatesBeforeOpen ||
				viewport(terminal).includes("Review resource apply") ||
				viewport(terminal).includes(" updated") ||
				viewport(terminal).includes(" created") ||
				viewport(terminal).includes("Error:"),
			"resource apply outcome",
		);
		const apply: MutationObservation = {
			openedViewport: viewport(terminal),
			requestCountBeforeEscape: mutations.updateCount() - updatesBeforeOpen,
			objectPresentBeforeEscape: mutations.objectPresent(),
			requestCountAfterEscape: 0,
			objectPresentAfterEscape: false,
		};
		if (apply.openedViewport.includes("Review resource apply")) {
			pty.write("\x1b");
			await Bun.sleep(350);
			await writes;
		}
		apply.requestCountAfterEscape = mutations.updateCount() - updatesBeforeOpen;
		apply.objectPresentAfterEscape = mutations.objectPresent();
		if (apply.openedViewport.includes("Review resource apply")) {
			pty.write(`/apply -f ${manifest}\r`);
			await wait(() => viewport(terminal).includes("Review resource apply"), "second resource apply review");
			pty.write("\x1b[B\r");
			await Bun.sleep(1_100);
			await writes;
			apply.confirmed = {
				requestCount: mutations.updateCount() - updatesBeforeOpen,
				objectPresent: mutations.objectPresent(),
				viewport: viewport(terminal),
			};
			pty.write("\x1b");
			await Bun.sleep(200);
			await writes;
		}
		const manifestOutput = join(profile.cwd, "review-differential-export.yaml");
		const readsBeforeManifest = mutations.readCount();
		pty.write(`/manifest http_loadbalancer review-differential -n demo -o yaml -f ${manifestOutput}\r`);
		await wait(
			async () =>
				(await Bun.file(manifestOutput).exists()) ||
				viewport(terminal).includes("Review manifest file export") ||
				viewport(terminal).includes("Manifest export complete") ||
				viewport(terminal).includes("Error:"),
			"manifest export outcome",
		);
		const manifestExport: ManifestObservation = {
			openedViewport: viewport(terminal),
			requestCountBeforeEscape: mutations.readCount() - readsBeforeManifest,
			fileExistsBeforeEscape: await Bun.file(manifestOutput).exists(),
			fileExistsAfterEscape: false,
		};
		if (manifestExport.openedViewport.includes("Review manifest file export")) {
			pty.write("\x1b");
			await Bun.sleep(300);
			await writes;
		}
		manifestExport.fileExistsAfterEscape = await Bun.file(manifestOutput).exists();
		if (manifestExport.openedViewport.includes("Review manifest file export")) {
			pty.write(`/manifest http_loadbalancer review-differential -n demo -o yaml -f ${manifestOutput}\r`);
			await wait(() => viewport(terminal).includes("Review manifest file export"), "second manifest export review");
			pty.write("\x1b[B\r");
			await wait(
				async () =>
					(await Bun.file(manifestOutput).exists()) ||
					viewport(terminal).includes("Manifest export complete") ||
					viewport(terminal).includes("Unresolved manifest file export"),
				"confirmed manifest export outcome",
			);
			await writes;
			if (await Bun.file(manifestOutput).exists()) {
				manifestExport.confirmed = {
					fileExists: true,
					content: sanitize(await Bun.file(manifestOutput).text()),
					viewport: viewport(terminal),
				};
			} else {
				manifestExport.unresolved = {
					fileExists: false,
					viewport: viewport(terminal),
				};
			}
			await closeReport();
		}
		const deletesBeforeOpen = mutations.deleteCount();
		pty.write("/delete http_loadbalancer review-differential -n demo\r");
		await wait(
			() =>
				mutations.deleteCount() !== deletesBeforeOpen ||
				viewport(terminal).includes("Review resource delete") ||
				viewport(terminal).includes(" deleted") ||
				viewport(terminal).includes("Error:"),
			"resource delete outcome",
		);
		const deletion: MutationObservation = {
			openedViewport: viewport(terminal),
			requestCountBeforeEscape: mutations.deleteCount() - deletesBeforeOpen,
			objectPresentBeforeEscape: mutations.objectPresent(),
			requestCountAfterEscape: 0,
			objectPresentAfterEscape: false,
		};
		if (deletion.openedViewport.includes("Review resource delete")) {
			pty.write("\x1b");
			await Bun.sleep(350);
			await writes;
		}
		deletion.requestCountAfterEscape = mutations.deleteCount() - deletesBeforeOpen;
		deletion.objectPresentAfterEscape = mutations.objectPresent();
		if (deletion.openedViewport.includes("Review resource delete")) {
			pty.write("/delete http_loadbalancer review-differential -n demo\r");
			await wait(() => viewport(terminal).includes("Review resource delete"), "second resource delete review");
			pty.write("\x1b[B\r");
			await wait(
				() =>
					mutations.deleteCount() > deletesBeforeOpen || viewport(terminal).includes("Unresolved resource delete"),
				"injected resource delete failure",
			);
			await writes;
			deletion.confirmed = {
				requestCount: mutations.deleteCount() - deletesBeforeOpen,
				objectPresent: mutations.objectPresent(),
				viewport: viewport(terminal),
			};
		}
		const deleteFailureRetry: FailureRetryObservation = {
			failureRequestCount: mutations.deleteCount() - deletesBeforeOpen,
			objectPresentAfterFailure: mutations.objectPresent(),
			failureViewport: viewport(terminal),
			retryRequestCount: 0,
			objectPresentAfterRetry: true,
			retryViewport: "",
		};
		if (!deleteFailureRetry.objectPresentAfterFailure)
			throw new Error("Injected resource delete failure unexpectedly removed the remote object");
		const deletesBeforeRetry = mutations.deleteCount();
		if (viewport(terminal).includes("Unresolved resource delete")) {
			pty.write("\x1b[B\r");
			await wait(
				() =>
					mutations.deleteCount() > deletesBeforeRetry || viewport(terminal).includes("Resource delete complete"),
				"unresolved resource delete retry",
			);
		} else {
			// v21.24.4 has no reviewed-action retry surface. Its equivalent recovery
			// is a new, explicit command invocation after the failed direct delete.
			pty.write("/delete http_loadbalancer review-differential -n demo\r");
			await wait(
				() => mutations.deleteCount() > deletesBeforeRetry || !mutations.objectPresent(),
				"direct resource delete retry",
			);
		}
		await writes;
		deleteFailureRetry.retryRequestCount = mutations.deleteCount() - deletesBeforeRetry;
		deleteFailureRetry.objectPresentAfterRetry = mutations.objectPresent();
		deleteFailureRetry.retryViewport = viewport(terminal);
		if (deleteFailureRetry.objectPresentAfterRetry)
			throw new Error("Resource delete retry did not remove the remaining remote object");
		return {
			commit: actualCommit,
			create,
			list,
			get,
			describe,
			diff,
			dryRun,
			apply,
			manifest: manifestExport,
			delete: deletion,
			deleteFailureRetry,
		};
	} catch (caught) {
		return {
			commit: actualCommit,
			create: {
				openedViewport: viewport(terminal),
				requestCountBeforeEscape: 0,
				objectPresentBeforeEscape: false,
				requestCountAfterEscape: 0,
				objectPresentAfterEscape: false,
				startupError: caught instanceof Error ? caught.message : String(caught),
				startupStream: sanitize(stream),
			},
			dryRun: { viewport: viewport(terminal), updateCount: 0, objectPresent: false },
			list: { viewport: viewport(terminal), requestCount: 0, objectPresent: false },
			get: { viewport: viewport(terminal), requestCount: 0, objectPresent: false },
			describe: { viewport: viewport(terminal), requestCount: 0, objectPresent: false },
			diff: { viewport: viewport(terminal), requestCount: 0, objectPresent: false },
			manifest: {
				openedViewport: viewport(terminal),
				requestCountBeforeEscape: 0,
				fileExistsBeforeEscape: false,
				fileExistsAfterEscape: false,
			},
			apply: {
				openedViewport: viewport(terminal),
				requestCountBeforeEscape: 0,
				objectPresentBeforeEscape: false,
				requestCountAfterEscape: 0,
				objectPresentAfterEscape: false,
				startupError: caught instanceof Error ? caught.message : String(caught),
				startupStream: sanitize(stream),
			},
			delete: {
				openedViewport: viewport(terminal),
				requestCountBeforeEscape: 0,
				objectPresentBeforeEscape: false,
				requestCountAfterEscape: 0,
				objectPresentAfterEscape: false,
				startupError: caught instanceof Error ? caught.message : String(caught),
				startupStream: sanitize(stream),
			},
			deleteFailureRetry: {
				failureRequestCount: 0,
				objectPresentAfterFailure: false,
				failureViewport: viewport(terminal),
				retryRequestCount: 0,
				objectPresentAfterRetry: false,
				retryViewport: viewport(terminal),
			},
		};
	} finally {
		try {
			pty.kill();
		} catch {
			// Process may have exited.
		}
		await done.catch(() => {});
		terminal.dispose();
	}
}

// This covers reviewed create/delete paths, but is not a substitute for the
// full resource UAT sequence.
const requests: Array<{ method: string; path: string }> = [];
const resources = new Map<string, unknown>();
let injectedDeleteFailuresRemaining = 0;
const provider = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/v1/models") return Response.json({ data: [{ id: "claude-sonnet-4-5" }] });
		if (url.pathname === "/api/web/namespaces") return Response.json({ items: [{ name: "demo" }] });
		const match = url.pathname.match(/^\/api\/config\/namespaces\/demo\/http_loadbalancers(?:\/([^/]+))?$/);
		if (!match) return Response.json({ code: 5, message: "not found" }, { status: 404 });
		requests.push({ method: request.method, path: url.pathname });
		if (request.method === "GET" && !match[1]) return Response.json({ items: [...resources.values()] });
		if (request.method === "GET") {
			const resource = resources.get(decodeURIComponent(match[1] ?? ""));
			return resource ? Response.json(resource) : Response.json({ code: 5, message: "not found" }, { status: 404 });
		}
		if (request.method === "POST") {
			const body = (await request.json()) as { metadata?: { name?: string } };
			resources.set(body.metadata?.name ?? "unknown", body);
			return Response.json(body);
		}
		if (request.method === "PUT") {
			const body = await request.json();
			resources.set(decodeURIComponent(match[1] ?? ""), body);
			return Response.json(body);
		}
		if (request.method === "DELETE") {
			if (injectedDeleteFailuresRemaining > 0) {
				injectedDeleteFailuresRemaining--;
				return Response.json({ code: 13, message: "synthetic injected delete failure" }, { status: 500 });
			}
			resources.delete(decodeURIComponent(match[1] ?? ""));
			return Response.json({});
		}
		return Response.json({});
	},
});

try {
	const mutations = {
		createCount: () => requests.filter(request => request.method === "POST").length,
		updateCount: () => requests.filter(request => request.method === "PUT").length,
		deleteCount: () => requests.filter(request => request.method === "DELETE").length,
		readCount: () => requests.filter(request => request.method === "GET").length,
		objectPresent: () => resources.has("review-differential"),
	};
	injectedDeleteFailuresRemaining = 1;
	const baseline = await captureCandidate(resolve(baselineRoot), BASELINE_COMMIT, provider.url.toString(), mutations);
	requests.length = 0;
	resources.clear();
	injectedDeleteFailuresRemaining = 1;
	const preFix = await captureCandidate(resolve(preFixRoot), PRE_FIX_COMMIT, provider.url.toString(), mutations);
	await mkdir(resolve(output, ".."), { recursive: true });
	await Bun.write(
		output,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				kind: "interactive-resource-review-differential",
				baseline,
				preFix,
				limitation:
					"This captures real-PTY list/get/describe/diff reads; create/apply/delete cancellation and confirmation; client dry-run non-mutation; manifest cancellation and write outcomes; and an injected delete failure with the baseline direct-command recovery versus the reviewed unresolved-only retry. It does not yet cover every bulk-resource shape, interruption during an in-flight remote operation, or persistence/reopen after a partially failed multi-resource batch.",
			},
			null,
			2,
		)}\n`,
	);
} finally {
	await provider.stop(true);
}
