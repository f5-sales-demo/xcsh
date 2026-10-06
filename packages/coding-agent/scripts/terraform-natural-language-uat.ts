#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { publicCitationForInternalUri } from "../src/internal-urls/public-citations";
import { TerraformDocumentationRepository } from "../src/internal-urls/terraform-documentation";
import { EMBEDDED_TERRAFORM_DOCUMENTATION } from "../src/internal-urls/terraform-documentation-assets.generated";

const scenarios = [
	{
		id: "login",
		prompt: "In Terraform, how do I tell Bot Defense that a login succeeded?",
		leaf: "transaction_result/success_conditions/index.md",
		expected: ["success_conditions", "regex_values", "status"],
	},
	{
		id: "tls",
		prompt: "Help me set up HTTPS on my Terraform load balancer using a certificate I already have.",
		leaf: "https/tls_cert_params/certificates/index.md",
		expected: ["certificate", "namespace"],
	},
	{ id: "control", prompt: "How do I tell Bot Defense that a login succeeded?", leaf: undefined, expected: [] },
] as const;

function argument(name: string): string | undefined {
	const position = process.argv.indexOf(name);
	return position < 0 ? undefined : process.argv[position + 1];
}

async function main(): Promise<void> {
	const output = argument("--trace-dir") ?? argument("--output-dir");
	if (!output) throw new Error("Provide --output-dir to run UAT or --trace-dir to verify captured runs");
	if (!EMBEDDED_TERRAFORM_DOCUMENTATION) throw new Error("Generate pinned Terraform assets before UAT");
	await mkdir(output, { recursive: true });
	const repository = new TerraformDocumentationRepository(
		EMBEDDED_TERRAFORM_DOCUMENTATION,
		path.join(output, "cache"),
	);
	try {
		for (const scenario of scenarios) {
			const tracePath = path.join(output, `${scenario.id}.jsonl`);
			if (!argument("--trace-dir")) {
				const binary = argument("--binary");
				const model = argument("--model");
				if (!binary || !model) throw new Error("UAT execution requires --binary and --model");
				const child = Bun.spawn(
					[
						binary,
						"--no-session",
						"--no-memories",
						"--no-extensions",
						"--no-skills",
						"--no-rules",
						"--no-lsp",
						"--no-title",
						"--tools",
						"read",
						"--model",
						model,
						"--thinking",
						"high",
						"--mode",
						"json",
						"-p",
						scenario.prompt,
					],
					{ cwd: output, stdout: Bun.file(tracePath), stderr: Bun.file(path.join(output, `${scenario.id}.err`)) },
				);
				if ((await child.exited) !== 0) throw new Error(`Model UAT failed: ${scenario.id}`);
			}
			const rows = (await readFile(tracePath, "utf8"))
				.split(/\r?\n/)
				.filter(Boolean)
				.map(line => JSON.parse(line));
			if (!rows.some(row => row.type === "agent_end")) throw new Error(`Incomplete model trace: ${scenario.id}`);
			const reads: string[] = rows
				.filter(row => row.type === "tool_execution_start" && row.toolName === "read")
				.map(row => row.args.path);
			const messages = rows
				.filter(row => row.type === "message_end" && row.message?.role === "assistant")
				.map(row =>
					row.message.content
						.filter((block: { type: string }) => block.type === "text")
						.map((block: { text: string }) => block.text)
						.join("\n"),
				)
				.filter(Boolean);
			const answer: string = messages.at(-1) ?? "";
			if (!answer) throw new Error(`Missing final answer: ${scenario.id}`);
			if (scenario.id === "control") {
				if (
					reads.some(uri => uri.startsWith("xcsh://terraform-documentation/")) ||
					/```(?:hcl|terraform)/.test(answer)
				)
					throw new Error("Non-Terraform question incorrectly activated Terraform");
			} else {
				if (!reads.some(uri => uri.startsWith("xcsh://terraform-documentation/?search=")))
					throw new Error(`Missing natural-language discovery: ${scenario.id}`);
				if (!reads.some(uri => uri.includes(scenario.leaf!)))
					throw new Error(`Missing exact leaf read: ${scenario.id}`);
				for (const field of scenario.expected)
					if (!answer.toLowerCase().includes(field)) throw new Error(`Missing documented field: ${field}`);
				if (!answer.includes(EMBEDDED_TERRAFORM_DOCUMENTATION.pin.provider_version.replace(/^v/, "")))
					throw new Error(`Missing bundled version: ${scenario.id}`);
				const visible = answer.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "").replace(/`[^`\n]*`/g, "");
				if (
					/xcsh:\/\/(?:documentation|terraform-documentation|terraform|api-spec|api-catalog|docs)(?:[/?#\s)]|$)/i.test(
						visible,
					)
				)
					throw new Error(`Internal documentation citation: ${scenario.id}`);
				const leafReads = reads.filter(
					uri => uri.startsWith("xcsh://terraform-documentation/") && uri.includes(scenario.leaf!),
				);
				const citations = [...visible.matchAll(/https:\/\/[^\s)<>]+/g)].map(match =>
					match[0].replace(/[.,;]+$/, ""),
				);
				const mapped = leafReads
					.map(publicCitationForInternalUri)
					.filter(result => result && "publicUrl" in result);
				if (!mapped.some(result => result && "publicUrl" in result && citations.includes(result.publicUrl)))
					throw new Error(`Missing verified public leaf citation: ${scenario.id}`);
				if (scenario.id === "tls" && !answer.includes("?"))
					throw new Error("Vague certificate location requires clarification");
			}
			await writeFile(path.join(output, `${scenario.id}.md`), answer);
			console.log(
				JSON.stringify({ scenario: scenario.id, passed: true, readCount: reads.length, prompt: scenario.prompt }),
			);
		}
	} finally {
		(await repository.database()).close();
	}
}

await main();
