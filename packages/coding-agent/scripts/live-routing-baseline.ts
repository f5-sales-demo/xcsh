/** Local-only preparation: no task admission, replay, runtime replacement or GitHub writes. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	type LiveRoutingBaseline,
	liveRoutingBaselineFailures,
	liveRoutingCases,
} from "../src/remote-control/live-routing-qualification";

const directory = process.argv[2];
if (!directory || process.argv.length !== 3)
	throw new Error("Use live-routing-baseline.ts /absolute/campaign-directory");
const campaignDirectory = resolve(directory);
const source = resolve(import.meta.dir, "../../..");
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
async function command(args: string[], cwd = source) {
	const child = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code) throw new Error(`${args[0]} failed (${code}): ${err.slice(0, 200)}`);
	return out;
}
const campaign = JSON.parse(await readFile(join(campaignDirectory, "campaign.json"), "utf8"));
const candidate = campaign.candidate;
if (!candidate || !/^[a-f0-9]{40}$/.test(candidate.commit) || !/^[a-f0-9]{64}$/.test(candidate.sha256))
	throw new Error("Invalid campaign candidate");
await command(["git", "merge-base", "--is-ancestor", candidate.commit, "HEAD"]);
const harnessCommit = (await command(["git", "rev-parse", "HEAD"])).trim();
if (hash(await readFile(candidate.executable)) !== candidate.sha256) throw new Error("Campaign artifact hash mismatch");
const names = [
	"remote-voice-live",
	"remote-voice-mode-start",
	"remote-voice-mode-end",
	"remote-voice-delegation",
	"remote-voice-capabilities",
	"remote-voice-runtime",
];
const policyTemplates = [];
for (const name of names) {
	const path = `packages/coding-agent/src/prompts/system/${name}.md`;
	const content = await readFile(join(source, path));
	if (hash(content) !== hash(await command(["git", "show", `${candidate.commit}:${path}`])))
		throw new Error(`Baseline policy changed: ${name}`);
	policyTemplates.push({ path, sha256: hash(content) });
}
const runtime = JSON.parse(
	await command([
		process.execPath,
		"packages/coding-agent/scripts/lifecycle-uat-controller.ts",
		"preflight",
		"--campaign-dir",
		campaignDirectory,
	]),
);
const status = JSON.parse(await command([candidate.executable, "remote-control", "status", "--json"]));
const clients = JSON.parse(await command([candidate.executable, "remote-control", "clients", "--json"])).data;
if (!Array.isArray(clients)) throw new Error("Invalid client inventory");
const baseline: LiveRoutingBaseline = {
	catalogFrozen: false,
	candidate: { commit: candidate.commit, sha256: candidate.sha256 },
	phoneBuild: "",
	policyTemplates,
	liveModel: { requested: "gpt-live-1-codex" },
	execution: {},
	captureVersions: await Promise.all(
		["trace.ts", "trace-collector.ts", "voice-diagnostics.ts", "lifecycle-uat-controller.ts"].map(async name => {
			const path = `packages/coding-agent/src/remote-control/${name}`;
			const content = await readFile(join(source, path));
			if (hash(content) !== hash(await command(["git", "show", `${candidate.commit}:${path}`])))
				throw new Error(`Baseline capture implementation changed: ${name}`);
			return { name, sha256: hash(content) };
		}),
	),
	fixtures: [],
	captures: [],
	observations: [],
};
const root = join(campaignDirectory, "live-routing-baseline");
await mkdir(root, { recursive: true, mode: 0o700 });
const attempt = join(root, `preparation-${Date.now()}`);
await mkdir(attempt, { mode: 0o700 });
const receipt = {
	schemaVersion: 1,
	campaignId: campaign.id,
	harnessCommit,
	candidate,
	baseline,
	runtime,
	phoneBuildProvenance: { immutableManifest: campaign.phoneBuild, observed: null },
	pairedClientCount: clients.length,
	activeVoiceSessions: status.activeVoiceSessions,
	caseCatalog: liveRoutingCases,
	missingGates: liveRoutingBaselineFailures(baseline),
	stage1Complete: false,
	mayAdvanceToStage2: false,
	fullLifecycleComplete: false,
	policyContentRetained: false,
	preparationOnly: true,
};
const text = `${JSON.stringify(receipt, null, 2)}\n`;
await writeFile(join(attempt, "preparation.json"), text, { flag: "wx", mode: 0o600 });
await writeFile(join(attempt, "preparation.sha256"), `${hash(text)}\n`, { flag: "wx", mode: 0o600 });
console.log(
	JSON.stringify({
		attempt,
		candidateCommit: candidate.commit,
		pairedClientCount: clients.length,
		missingGates: receipt.missingGates,
		stage1Complete: false,
	}),
);
