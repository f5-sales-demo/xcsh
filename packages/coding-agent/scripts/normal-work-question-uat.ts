#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import path from "node:path";

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index < 0 ? undefined : process.argv[index + 1];
}

const output = argument("--output-dir");
const binary = argument("--binary");
const model = argument("--model");
if (!output || !binary || !model) throw new Error("Use --binary PATH --model PROVIDER/MODEL --output-dir PATH");
await mkdir(output, { recursive: true, mode: 0o700 });

const scenarios = [
	{
		id: "terraform-required-sequential",
		prompt:
			"I need a placeholder-only Terraform example for example.com on F5 Distributed Cloud. I have not decided between a standard HTTP/HTTPS load balancer and CDN. That decision is required: ask me before choosing either. If I choose the standard load balancer, I also need to choose plain HTTP or HTTPS with automatic certificates before you produce the example. You may inspect documentation while I decide. No tenant-specific values and no deployment.",
		answers: ["standard", "https"],
		idle: false,
	},
	{
		id: "required-free-text-idle",
		prompt:
			"Draft a two-sentence rollout announcement. The release name is required and I have not provided it; ask me for it before drafting. Wait for my submitted reply and do not invent a name. You may prepare the announcement structure while waiting.",
		answers: ["Release Maple"],
		idle: true,
	},
	{
		id: "fully-specified-control",
		prompt:
			"Write exactly two sentences announcing Release Maple: it adds structured questions during ordinary work, and users can select an option or type an answer. The audience is engineers. All choices are specified; deliver the announcement now.",
		answers: [],
		idle: false,
	},
];

interface Request {
	id: string;
	delivery: string;
	title: string;
	options?: string[];
	identity: unknown;
}

const reports: unknown[] = [];
let failed = false;
for (const scenario of scenarios.filter(value => !argument("--scenario") || value.id === argument("--scenario"))) {
	const child = Bun.spawn(
		[
			binary,
			"--mode",
			"rpc",
			"--no-session",
			"--no-memories",
			"--no-extensions",
			"--no-skills",
			"--no-rules",
			"--no-lsp",
			"--no-title",
			"--model",
			model,
			"--thinking",
			"medium",
		],
		{ cwd: output, stdin: "pipe", stdout: "pipe", stderr: "ignore" },
	);
	const send = (command: unknown) => {
		child.stdin.write(`${JSON.stringify(command)}\n`);
		child.stdin.flush();
	};
	const pending = new Map<string, Request>();
	const questions: { title: string; options?: string[] }[] = [];
	const answers: string[] = [];
	const receipts: boolean[] = [];
	const modelReplies: string[] = [];
	const finals: string[] = [];
	const tools: string[] = [];
	let premature = false;
	let completed = false;
	let problem: string | undefined;
	const submit = (request: Request) => {
		const wanted = scenario.answers[answers.length];
		const answer =
			wanted === "standard"
				? request.options?.find(value => /http|standard/i.test(value) && !/cdn/i.test(value))
				: wanted === "https"
					? request.options?.find(value => /https/i.test(value) && /auto|managed/i.test(value))
					: wanted;
		if (!answer) throw new Error("Missing expected option or unexpected additional question");
		send({
			type: "interaction_respond",
			requestId: request.id,
			responseId: `uat-${answers.length}`,
			identity: request.identity,
			value: answer,
		});
		answers.push(answer);
		pending.delete(request.id);
	};
	const timer = setTimeout(() => {
		problem = "Timed out";
		child.kill();
	}, 240_000);
	try {
		send({ type: "prompt", message: scenario.prompt });
		const decoder = new TextDecoder();
		let buffer = "";
		for await (const chunk of child.stdout) {
			buffer += decoder.decode(chunk, { stream: true });
			while (buffer.includes("\n")) {
				const end = buffer.indexOf("\n");
				const line = buffer.slice(0, end);
				buffer = buffer.slice(end + 1);
				if (!line.trim()) continue;
				const event = JSON.parse(line);
				if (event.type === "interaction" && event.event?.type === "opened") {
					const request = event.event.interaction as Request;
					if (request.delivery === "async" && !pending.has(request.id)) {
						questions.push({ title: request.title, options: request.options });
						pending.set(request.id, request);
						if (!scenario.idle) submit(request);
					}
				}
				if (event.type === "tool_execution_start") tools.push(event.toolName);
				if (event.type === "response" && event.command === "interaction_respond")
					receipts.push(event.data?.accepted === true);
				if (event.type === "message_end" && event.message?.role === "user") {
					for (const block of event.message.content ?? []) {
						if (block.type !== "text") continue;
						try {
							const reply = JSON.parse(block.text);
							if (reply.type === "user_input_reply") modelReplies.push(reply.answer);
						} catch {
							/* Ordinary user prompt. */
						}
					}
				}
				if (event.type === "message_end" && event.message?.role === "assistant") {
					if (event.message.stopReason === "error")
						throw new Error(event.message.errorMessage ?? "Provider failed");
					const text = (event.message.content ?? [])
						.filter(
							(block: { type: string; phase?: string }) =>
								block.type === "text" && block.phase === "final_answer",
						)
						.map((block: { text: string }) => block.text)
						.join("\n");
					if (text) {
						finals.push(text);
						if (answers.length < scenario.answers.length && /```|Release Maple/.test(text)) premature = true;
					}
				}
				if (event.type === "agent_end") {
					if (scenario.idle && pending.size) {
						for (const request of [...pending.values()]) submit(request);
					} else if (
						modelReplies.length === scenario.answers.length &&
						finals.length &&
						(scenario.id !== "terraform-required-sequential" ||
							finals.some(text => /```(?:hcl|terraform)/.test(text)))
					)
						completed = true;
				}
			}
			if (completed) break;
		}
	} catch (error) {
		problem = error instanceof Error ? error.message : String(error);
	} finally {
		clearTimeout(timer);
		child.kill();
		await child.exited;
	}
	const passed =
		completed &&
		!problem &&
		!premature &&
		questions.length === scenario.answers.length &&
		receipts.length === scenario.answers.length &&
		receipts.every(Boolean) &&
		modelReplies.length === scenario.answers.length;
	failed ||= !passed;
	const report = {
		id: scenario.id,
		passed,
		binary,
		model,
		prompt: scenario.prompt,
		questions,
		submitted: answers,
		receipts,
		modelReplies,
		tools,
		final: finals.at(-1),
		premature,
		problem,
	};
	reports.push(report);
	console.log(JSON.stringify(report));
}
await Bun.write(path.join(output, "normal-work-question-uat.json"), `${JSON.stringify(reports, null, 2)}\n`);
process.exitCode = failed ? 1 : 0;
