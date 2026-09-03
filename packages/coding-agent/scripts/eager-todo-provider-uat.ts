interface ProviderTarget {
	label: string;
	model: string;
	thinking: "medium";
}

const ROOT_DIR = new URL("../../..", import.meta.url).pathname;
const CONVERSATIONAL_PROMPT = "who are you and what can you do";
const SUBSTANTIVE_PROMPT =
	"Analyze how an eager todo flow should distinguish conversational questions from substantive development requests. Give three concrete acceptance checks, then finish with exactly EAGER_TODO_SUBSTANTIVE_READY.";
const TARGETS: ProviderTarget[] = [
	{ label: "Anthropic Sonnet", model: "anthropic/claude-sonnet-5", thinking: "medium" },
	{ label: "ChatGPT Codex", model: "openai-codex/gpt-5.6-sol", thinking: "medium" },
	{ label: "Google Vertex", model: "google-vertex/gemini-3.1-pro-preview", thinking: "medium" },
];

interface RunEvidence {
	todoCalls: number;
	turnEnded: boolean;
	completedSubstantivePrompt: boolean;
	hasTodoWarning: boolean;
}

interface OutputObservation {
	todoCallIds: Set<string>;
	turnEnded: boolean;
	completedSubstantivePrompt: boolean;
	hasTodoWarning: boolean;
}

function observeLine(line: string, observation: OutputObservation): void {
	if (!line) return;
	if (line.includes("EAGER_TODO_SUBSTANTIVE_READY")) observation.completedSubstantivePrompt = true;
	if (/todo_write failed|todo update failed|validation failed for tool "todo_write"/i.test(line)) {
		observation.hasTodoWarning = true;
	}
	try {
		const event = JSON.parse(line) as unknown;
		if (event && typeof event === "object") {
			const record = event as Record<string, unknown>;
			if (record.type === "turn_end") observation.turnEnded = true;
			if (
				record.type === "tool_execution_start" &&
				record.toolName === "todo_write" &&
				typeof record.toolCallId === "string"
			) {
				observation.todoCallIds.add(record.toolCallId);
			}
		}
	} catch {
		// Bun script diagnostics are not JSON events and carry no acceptance state.
	}
}

async function observeOutput(stream: ReadableStream<Uint8Array>): Promise<OutputObservation> {
	const observation: OutputObservation = {
		todoCallIds: new Set(),
		turnEnded: false,
		completedSubstantivePrompt: false,
		hasTodoWarning: false,
	};
	const decoder = new TextDecoder();
	let buffered = "";
	for await (const chunk of stream) {
		buffered += decoder.decode(chunk, { stream: true });
		let newline = buffered.indexOf("\n");
		while (newline >= 0) {
			observeLine(buffered.slice(0, newline), observation);
			buffered = buffered.slice(newline + 1);
			newline = buffered.indexOf("\n");
		}
	}
	buffered += decoder.decode();
	observeLine(buffered, observation);
	return observation;
}

async function runPrompt(target: ProviderTarget, prompt: string): Promise<RunEvidence> {
	const child = Bun.spawn(
		[
			"bun",
			"dev",
			"--",
			"--model",
			target.model,
			"--thinking",
			target.thinking,
			"--mode",
			"json",
			"--print",
			"--no-session",
			"--no-title",
			"--no-memories",
			"--no-mcp",
			"--no-lsp",
			"--no-skills",
			"--no-rules",
			"--no-extensions",
			"--tools=todo_write",
			prompt,
		],
		{
			cwd: ROOT_DIR,
			stdout: "pipe",
			stderr: "pipe",
			signal: AbortSignal.timeout(240_000),
		},
	);
	const [observation, stderr, exitCode] = await Promise.all([
		observeOutput(child.stdout),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(`${target.label} exited with ${exitCode}; stderr bytes=${Buffer.byteLength(stderr)}`);
	}

	return {
		todoCalls: observation.todoCallIds.size,
		turnEnded: observation.turnEnded,
		completedSubstantivePrompt: observation.completedSubstantivePrompt,
		hasTodoWarning: observation.hasTodoWarning,
	};
}

async function verifyTarget(target: ProviderTarget): Promise<void> {
	const conversational = await runPrompt(target, CONVERSATIONAL_PROMPT);
	if (!conversational.turnEnded) throw new Error(`${target.label} conversational turn did not finish`);
	if (conversational.todoCalls !== 0) {
		throw new Error(`${target.label} forced todo_write for the conversational prompt`);
	}
	if (conversational.hasTodoWarning) {
		throw new Error(`${target.label} emitted a todo validation warning for the conversational prompt`);
	}

	const substantive = await runPrompt(target, SUBSTANTIVE_PROMPT);
	if (!substantive.turnEnded) throw new Error(`${target.label} substantive turn did not finish`);
	if (substantive.todoCalls === 0) throw new Error(`${target.label} did not create the required eager todo`);
	if (substantive.hasTodoWarning) {
		throw new Error(`${target.label} failed to validate its eager todo payload`);
	}
	if (!substantive.completedSubstantivePrompt) {
		throw new Error(`${target.label} did not complete the substantive prompt`);
	}

	console.log(`PASS ${target.label}: direct conversational response; eager todo executed; substantive task completed`);
}

for (const target of TARGETS) await verifyTarget(target);
console.log(`PASS final eager-todo provider matrix: ${TARGETS.length}/${TARGETS.length}`);
