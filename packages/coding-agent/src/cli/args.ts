/**
 * CLI argument parsing and help display
 */
import { type Effort, THINKING_EFFORTS } from "@f5-sales-demo/pi-ai";
import { APP_NAME, CONFIG_DIR_NAME, logger } from "@f5-sales-demo/pi-utils";
import chalk from "chalk";
import { parseEffort } from "../thinking";
import {
	flagNameForChar,
	flagSpec,
	LAUNCH_FLAGS,
	type LaunchFlagName,
	normalizeFlagTokens,
	takesValue,
	type UnrecognizedFlag,
} from "./flag-spec";

export type Mode = "text" | "json" | "rpc" | "acp";

export interface Args {
	cwd?: string;
	allowHome?: boolean;
	/** Disable the session filesystem discovery guard; OS-user permissions are unchanged. */
	noSandbox?: boolean;
	/** Extra directories whose entries the session may discover (repeatable). */
	allowPath?: string[];
	provider?: string;
	context?: string;
	model?: string;
	smol?: string;
	slow?: string;
	plan?: string;
	apiKey?: string;
	systemPrompt?: string;
	appendSystemPrompt?: string;
	thinking?: Effort;
	continue?: boolean;
	resume?: string | true;
	help?: boolean;
	version?: boolean;
	mode?: Mode;
	noSession?: boolean;
	noMemories?: boolean;
	sessionDir?: string;
	providerSessionId?: string;
	fork?: string;
	models?: string[];
	tools?: string[];
	noTools?: boolean;
	noMcp?: boolean;
	noLsp?: boolean;
	noPty?: boolean;
	hooks?: string[];
	extensions?: string[];
	noExtensions?: boolean;
	pluginDirs?: string[];
	print?: boolean;
	export?: string;
	noSkills?: boolean;
	skills?: string[];
	noRules?: boolean;
	listModels?: string | true;
	noTitle?: boolean;
	messages: string[];
	fileArgs: string[];
	/** Unknown flags (potentially extension flags) - map of flag name to value */
	unknownFlags: Map<string, boolean | string>;
	/**
	 * Flags matched by neither the spec nor a known extension flag.
	 *
	 * Collected rather than reported here: the extension flag registry does not exist yet during the
	 * first parse, so only `main.ts` can tell a genuine typo from a flag an extension will claim.
	 */
	unrecognizedFlags: UnrecognizedFlag[];
}

/**
 * Apply one parsed flag to the result, keeping each flag's own value coercion.
 *
 * Split from the scanning loop so arity, aliasing and the `=` form are handled once, in one place,
 * rather than repeated per flag as an `arg === "--x" && i + 1 < args.length` chain — which is how
 * `--x=value` came to match nothing at all and vanish silently (#2469).
 */
const APPLY: Record<LaunchFlagName, (result: Args, value: string | true) => void> = {
	model: (r, v) => {
		r.model = v as string;
	},
	smol: (r, v) => {
		r.smol = v as string;
	},
	slow: (r, v) => {
		r.slow = v as string;
	},
	plan: (r, v) => {
		r.plan = v as string;
	},
	provider: (r, v) => {
		r.provider = v as string;
	},
	context: (r, v) => {
		r.context = v as string;
	},
	"api-key": (r, v) => {
		r.apiKey = v as string;
	},
	"system-prompt": (r, v) => {
		r.systemPrompt = v as string;
	},
	"append-system-prompt": (r, v) => {
		r.appendSystemPrompt = v as string;
	},
	"allow-home": r => {
		r.allowHome = true;
	},
	"no-sandbox": r => {
		r.noSandbox = true;
	},
	"allow-path": (r, v) => {
		r.allowPath = [...(r.allowPath ?? []), v as string];
	},
	mode: (r, v) => {
		// Already validated against the spec's `options`.
		r.mode = v as Mode;
	},
	print: r => {
		r.print = true;
	},
	continue: r => {
		r.continue = true;
	},
	resume: (r, v) => {
		r.resume = v;
	},
	session: (r, v) => {
		r.resume = v;
	},
	fork: (r, v) => {
		r.fork = v as string;
	},
	"session-dir": (r, v) => {
		r.sessionDir = v as string;
	},
	"no-session": r => {
		r.noSession = true;
	},
	"no-memories": r => {
		r.noMemories = true;
	},
	"provider-session-id": (r, v) => {
		r.providerSessionId = v as string;
	},
	models: (r, v) => {
		r.models = (v as string).split(",").map(s => s.trim());
	},
	"no-tools": r => {
		r.noTools = true;
	},
	"no-mcp": r => {
		r.noMcp = true;
	},
	"no-lsp": r => {
		r.noLsp = true;
	},
	"no-pty": r => {
		r.noPty = true;
	},
	tools: (r, v) => {
		r.tools = (v as string)
			.split(",")
			.map(s => s.trim().toLowerCase())
			.filter(Boolean);
	},
	thinking: (r, v) => {
		const thinking = parseEffort(v as string);
		if (thinking !== undefined) {
			r.thinking = thinking;
		} else {
			logger.warn("Invalid thinking level passed to --thinking", {
				level: v,
				validThinkingLevels: THINKING_EFFORTS,
			});
		}
	},
	hook: (r, v) => {
		r.hooks = [...(r.hooks ?? []), v as string];
	},
	extension: (r, v) => {
		r.extensions = [...(r.extensions ?? []), v as string];
	},
	"plugin-dir": (r, v) => {
		r.pluginDirs = [...(r.pluginDirs ?? []), v as string];
	},
	"no-extensions": r => {
		r.noExtensions = true;
	},
	"no-skills": r => {
		r.noSkills = true;
	},
	skills: (r, v) => {
		r.skills = (v as string).split(",").map(s => s.trim());
	},
	"no-rules": r => {
		r.noRules = true;
	},
	export: (r, v) => {
		r.export = v as string;
	},
	"list-models": (r, v) => {
		r.listModels = v;
	},
	"no-title": r => {
		r.noTitle = true;
	},
	help: r => {
		r.help = true;
	},
	version: r => {
		r.version = true;
	},
};

/** True when the token could be an optional flag's value rather than the next flag or a file arg. */
function isValueToken(token: string | undefined): token is string {
	return token !== undefined && !token.startsWith("-") && !token.startsWith("@");
}

export function parseArgs(args: string[], extensionFlags?: Map<string, { type: "boolean" | "string" }>): Args {
	const result: Args = {
		messages: [],
		fileArgs: [],
		unknownFlags: new Map(),
		unrecognizedFlags: [],
	};

	const tokens = normalizeFlagTokens(args, extensionFlags);

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];

		// Everything after `--` is content, not flags. Needed because an unrecognized flag is now a
		// hard error, so there has to be a way to pass flag-looking text as a prompt.
		if (token === "--") {
			result.messages.push(...tokens.slice(i + 1));
			break;
		}

		if (token.startsWith("@")) {
			result.fileArgs.push(token.slice(1));
			continue;
		}

		if (!token.startsWith("-") || token === "-") {
			result.messages.push(token);
			continue;
		}

		// An unknown `--name=value` survives normalization intact, so strip the value to get a name
		// that can still be matched against the extension flag registry.
		const name = token.startsWith("--") ? token.slice(2).split("=")[0] : flagNameForChar(token.slice(1));
		const spec = name === undefined ? undefined : flagSpec(name);

		if (spec && name !== undefined) {
			if (!takesValue(spec)) {
				APPLY[name as LaunchFlagName](result, true);
				continue;
			}
			if (spec.arity === "optional-value") {
				APPLY[name as LaunchFlagName](result, isValueToken(tokens[i + 1]) ? tokens[++i] : true);
				continue;
			}
			const value = tokens[i + 1];
			if (value === undefined) {
				result.unrecognizedFlags.push({ token, name });
				continue;
			}
			i++;
			if (spec.options && !spec.options.includes(value)) {
				logger.warn("Invalid value passed to flag", { flag: token, value, validValues: spec.options });
				continue;
			}
			APPLY[name as LaunchFlagName](result, value);
			continue;
		}

		// Extension flags are only known on the second parse, once extensions have loaded.
		const extFlag = name === undefined ? undefined : extensionFlags?.get(name);
		if (extFlag && name !== undefined) {
			if (extFlag.type === "boolean") {
				result.unknownFlags.set(name, true);
			} else if (i + 1 < tokens.length) {
				result.unknownFlags.set(name, tokens[++i]);
			}
			continue;
		}

		// Record the flag, but do NOT consume the token after it. The bootstrap parse runs before
		// extensions load, so it cannot know whether an unrecognized flag takes a value: swallowing
		// the next token silently discards the user's prompt whenever the flag turns out to be
		// boolean (`xcsh -p --verbose "do work"`). Leaving it means a string extension flag's value
		// still reaches `messages`, which is the pre-existing behaviour and the lesser harm — the
		// real fix is to load extensions before the first parse, which is out of scope here.
		result.unrecognizedFlags.push({ token, name: name ?? token.replace(/^-+/, "") });
	}

	return result;
}

export function getExtraHelpText(): string {
	return `${chalk.bold("Environment Variables:")}
  ${chalk.dim("# Core Providers")}
  ANTHROPIC_API_KEY          - Anthropic Claude models
  ANTHROPIC_OAUTH_TOKEN      - Anthropic OAuth (takes precedence over API key)
  CLAUDE_CODE_USE_FOUNDRY    - Enable Anthropic Foundry mode (uses Foundry endpoint + mTLS)
  FOUNDRY_BASE_URL           - Anthropic Foundry base URL (e.g., https://<foundry-host>)
  ANTHROPIC_FOUNDRY_API_KEY  - Anthropic token used as Authorization: Bearer <token> in Foundry mode
  ANTHROPIC_CUSTOM_HEADERS   - Extra Foundry headers (e.g., "user-id: USERNAME")
  CLAUDE_CODE_CLIENT_CERT    - Client certificate (PEM path or inline PEM) for mTLS
  CLAUDE_CODE_CLIENT_KEY     - Client private key (PEM path or inline PEM) for mTLS
  NODE_EXTRA_CA_CERTS        - CA bundle path (or inline PEM) for server certificate validation
  OPENAI_API_KEY             - OpenAI GPT models
  GEMINI_API_KEY             - Google Gemini models
  GITHUB_TOKEN               - GitHub Copilot (or GH_TOKEN, COPILOT_GITHUB_TOKEN)

  ${chalk.dim("# Additional LLM Providers")}
  AZURE_OPENAI_API_KEY       - Azure OpenAI models
  GROQ_API_KEY               - Groq models
  CEREBRAS_API_KEY           - Cerebras models
  XAI_API_KEY                - xAI Grok models
  OPENROUTER_API_KEY         - OpenRouter aggregated models
  KILO_API_KEY               - Kilo Gateway models
  MISTRAL_API_KEY            - Mistral models
  ZAI_API_KEY                - z.ai models (ZhipuAI/GLM)
  MINIMAX_API_KEY            - MiniMax models
  OPENCODE_API_KEY           - OpenCode Zen/OpenCode Go models
  CURSOR_ACCESS_TOKEN        - Cursor AI models
  AI_GATEWAY_API_KEY         - Vercel AI Gateway

  ${chalk.dim("# Cloud Providers")}
  AWS_PROFILE                - AWS Bedrock (or AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY)
  GOOGLE_CLOUD_PROJECT       - Google Vertex AI (requires GOOGLE_CLOUD_LOCATION)
  GOOGLE_APPLICATION_CREDENTIALS - Service account for Vertex AI

  ${chalk.dim("# Search & Tools")}
  EXA_API_KEY                - Exa web search
  BRAVE_API_KEY              - Brave web search
  PERPLEXITY_API_KEY         - Perplexity web search (API)
  PERPLEXITY_COOKIES         - Perplexity web search (session cookie)
  TAVILY_API_KEY             - Tavily web search
  ANTHROPIC_SEARCH_API_KEY   - Anthropic search provider

  ${chalk.dim("# Configuration")}
  PI_CODING_AGENT_DIR        - Session storage directory (default: ~/${CONFIG_DIR_NAME}/agent)
  PI_PACKAGE_DIR             - Override package directory (for Nix/Guix store paths)
  PI_SMOL_MODEL              - Override smol/fast model (see --smol)
  PI_SLOW_MODEL              - Override slow/reasoning model (see --slow)
  PI_PLAN_MODEL              - Override planning model (see --plan)
  PI_NO_PTY                  - Disable PTY-based interactive bash execution

  For complete environment variable reference, see:
  ${chalk.dim("docs/environment-variables.md")}
${chalk.bold("Available Tools (default-enabled unless noted):")}
  read          - Read file contents
  bash          - Execute bash commands
  edit          - Edit files with find/replace
  write         - Write files (creates/overwrites)
  grep          - Search file contents
  find          - Find files by glob pattern
  lsp           - Language server protocol (code intelligence)
  python        - Execute Python code (requires: ${APP_NAME} setup python)
  notebook      - Edit Jupyter notebooks
  inspect_image - Analyze images with a vision model
  browser       - Browser automation (Puppeteer)
  task          - Launch sub-agents for parallel tasks
  todo_write    - Manage todo/task lists
  web_search    - Search the web
  ask           - Ask user questions (interactive mode only)

${chalk.bold("Sandbox Options:")}
  --no-sandbox               ${LAUNCH_FLAGS["no-sandbox"].description}
  --allow-path <path>        ${LAUNCH_FLAGS["allow-path"].description}

${chalk.bold("Plugin Options:")}
  --plugin-dir <path>        Load plugin from directory (repeatable)

${chalk.bold("Useful Commands:")}
  xcsh agents unpack           - Export bundled subagents to ~/.xcsh/agent/agents (default)
  xcsh agents unpack --project - Export bundled subagents to ./.xcsh/agents`;
}

export function printHelp(): void {
	process.stdout.write(
		`${chalk.bold(APP_NAME)} - AI coding assistant\n\n` +
			`Run ${APP_NAME} --help for full command and option details.\n` +
			`Run ${APP_NAME} <command> --help for command-specific help.\n\n` +
			`${getExtraHelpText()}\n`,
	);
}
