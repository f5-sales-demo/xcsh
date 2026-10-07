import { resolve } from "node:path";
import { Args, CliUsageError, Flags, parseCommandArgv } from "@f5-sales-demo/pi-utils/cli";
import type { BlindfoldArgs, BlindfoldOperation } from "../services/blindfold";

export const blindfoldFlags = {
	input: Flags.string({ description: "Secret filename or - for stdin" }),
	"public-key": Flags.string({ description: "Public key JSON/YAML file; requires --policy-document (offline)" }),
	"policy-document": Flags.string({ description: "Policy JSON/YAML file; requires --public-key (offline)" }),
	cert: Flags.string({ description: "PEM certificate chain" }),
	key: Flags.string({ description: "PEM private key" }),
	bundle: Flags.string({ description: "PKCS#12 bundle" }),
	name: Flags.string({ description: "Certificate name or secret policy name" }),
	namespace: Flags.string({ char: "n", description: "Certificate namespace or secret policy namespace" }),
	policy: Flags.string({ description: "Secret policy namespace/name (default shared/ves-io-allow-volterra)" }),
	"passphrase-env": Flags.string({ description: "Passphrase environment variable name" }),
	"context-name": Flags.string({ description: "Assert selected native context (online only)" }),
	output: Flags.string({ description: "Public material format", options: ["json", "yaml"] }),
	"output-file": Flags.string({ description: "New artifact file (0600)" }),
	"result-file": Flags.string({ description: "New public JSON report file (0600)" }),
	"dry-run": Flags.string({ description: "Validate without tenant writes", options: ["client"] }),
	json: Flags.boolean({ description: "Print public JSON report" }),
};
const aliases = { "get-public-key": "public-key", "get-policy-document": "policy", encrypt: "encrypt" } as const;
const supported = ["public-key", "policy", "encrypt", "certificate", "create", "replace"];
const common = ["context-name", "output-file", "result-file", "json"];
export function flagsForBlindfold(operation: string) {
	const names =
		operation === "public-key"
			? [...common, "output"]
			: operation === "policy"
				? [...common, "output", "policy", "namespace", "name"]
				: operation === "encrypt"
					? [...common, "input", "policy", "public-key", "policy-document"]
					: [...common, "cert", "key", "bundle", "name", "namespace", "policy", "passphrase-env", "dry-run"];
	return Object.fromEntries(names.map(name => [name, blindfoldFlags[name as keyof typeof blindfoldFlags]]));
}
export function parseBlindfoldCli(
	argv: readonly string[],
	compatibility: boolean,
	stdinIsTTY: boolean,
): BlindfoldArgs & { json?: boolean } {
	const parts = [...argv];
	if (compatibility && parts.shift() !== "secrets") throw new CliUsageError("Only request secrets is supported");
	const selected = parts.shift();
	const operation = compatibility ? aliases[selected as keyof typeof aliases] : selected;
	if (!operation || !supported.includes(operation)) throw new CliUsageError("Unknown Blindfold operation");
	for (const arg of parts.slice(0, parts.includes("--") ? parts.indexOf("--") : undefined)) {
		if (/^(--(?:config|server-urls|p12-bundle|cacert|cert|key|hw-key)(?:=|$)|-[acku])/.test(arg) && compatibility)
			throw new CliUsageError("Legacy authentication is unsupported; configure xcsh context with xcsh context");
	}
	const parsed = parseCommandArgv(parts, {
		flags: flagsForBlindfold(operation),
		args: operation === "encrypt" ? { file: Args.string() } : {},
	});
	if (parsed.argv.length > (operation === "encrypt" ? 1 : 0)) throw new CliUsageError("Surplus positional arguments");
	const f = parsed.flags;
	if (f.input !== undefined && parsed.args.file !== undefined)
		throw new CliUsageError("Select one secret input source");
	const args: BlindfoldArgs & { json?: boolean } = {
		operation: operation as BlindfoldOperation,
		input: (f.input ?? parsed.args.file) as string | undefined,
		publicKey: f["public-key"] as string | undefined,
		policyDocument: f["policy-document"] as string | undefined,
		cert: f.cert as string | undefined,
		key: f.key as string | undefined,
		bundle: f.bundle as string | undefined,
		name: f.name as string | undefined,
		namespace: f.namespace as string | undefined,
		policy: f.policy as string | undefined,
		passphraseEnv: f["passphrase-env"] as string | undefined,
		contextName: f["context-name"] as string | undefined,
		output: f.output as "json" | "yaml" | undefined,
		outputFile: f["output-file"] as string | undefined,
		resultFile: f["result-file"] as string | undefined,
		dryRun: f["dry-run"] as "client" | undefined,
		json: f.json as boolean | undefined,
	};
	if (Boolean(args.publicKey) !== Boolean(args.policyDocument))
		throw new CliUsageError("--public-key and --policy-document must be supplied together");
	if (args.publicKey && args.contextName)
		throw new CliUsageError("Offline encryption does not select a context; omit --context-name");
	if (args.json && (args.outputFile || args.output)) throw new CliUsageError("Conflicting output selections");
	if (operation === "policy" && args.policy && (args.namespace !== undefined || args.name !== undefined))
		throw new CliUsageError("Cannot combine --policy with --namespace or --name");

	const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
	if (args.policy && (args.policy.split("/").length !== 2 || args.policy.split("/").some(v => !label.test(v))))
		throw new CliUsageError("Policy must be namespace/name");
	if ([args.name, args.namespace].some(v => v !== undefined && !label.test(v)))
		throw new CliUsageError("Invalid resource namespace or name");
	if ([args.input, args.publicKey, args.policyDocument, args.outputFile, args.resultFile].some(v => v === ""))
		throw new CliUsageError("File paths must be nonempty");
	if (["certificate", "create", "replace"].includes(operation)) {
		if (!args.name || (args.bundle ? args.cert || args.key : !args.cert || !args.key))
			throw new CliUsageError("Use --name and either --bundle or --cert with --key");
	}
	if (args.outputFile && args.resultFile && resolve(args.outputFile) === resolve(args.resultFile))
		throw new CliUsageError("Artifact and report destinations must differ");
	if (operation === "encrypt" && args.input === undefined) {
		if (stdinIsTTY) throw new CliUsageError("Encrypt requires an input filename or redirected stdin");
		args.input = "-";
	}
	if (operation === "encrypt" && args.input === "-" && stdinIsTTY)
		throw new CliUsageError("Encrypt stdin must be redirected");
	return args;
}
