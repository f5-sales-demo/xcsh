import { $which } from "@f5-sales-demo/pi-utils";
import { type CliResult, runCli, splitFullName } from "./collectors";
import type { UserProfile, UserProfileObservation } from "./schema";
import type { ProfileCollection, ProfileCollector } from "./service";

type Runner = (argv: string[], signal?: AbortSignal) => Promise<CliResult>;
const string = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim() && value.length <= 4096 ? value.trim() : undefined;
const object = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
function observations(source: string, facts: UserProfile): ProfileCollection {
	return {
		facts: {},
		observations: Object.entries(facts).map(([field, value]) => ({
			field: field as keyof UserProfile,
			value,
			source,
			kind: "observed",
			observedAt: new Date().toISOString(),
		})) as UserProfileObservation[],
	};
}
/** Allowlisted account metadata only. Never read credential files or ask a CLI to emit tokens. */
export function createAccountCollectors(
	run: Runner = (argv, signal) => runCli(argv, undefined, signal),
	available: (command: string) => boolean = command => Boolean($which(command)),
): ProfileCollector[] {
	const json = async (argv: string[], signal?: AbortSignal): Promise<unknown> => {
		const result = await run(argv, signal);
		if (result.exitCode !== 0) throw new Error("Account discovery unavailable");
		try {
			return JSON.parse(result.stdout);
		} catch {
			throw new Error("Account discovery unavailable");
		}
	};
	return [
		{
			id: "github_emails",
			name: "GitHub associated email addresses",
			available: async () => available("gh"),
			async collect(signal) {
				const raw = await json(["gh", "api", "user/emails"], signal);
				if (!Array.isArray(raw)) throw new Error("Account discovery unavailable");
				const emails = [
					...new Set(
						raw.map(item => string(object(item).email)).filter((email): email is string => Boolean(email)),
					),
				].slice(0, 100);
				return observations("github_emails", emails.length ? { email: emails } : {});
			},
		},
		{
			id: "azure",
			name: "Azure account and directory",
			available: async () => available("az"),
			async collect(signal) {
				const raw = await json(["az", "account", "list", "--output", "json", "--only-show-errors"], signal);
				if (!Array.isArray(raw)) throw new Error("Account discovery unavailable");
				const accounts: NonNullable<UserProfile["accounts"]> = [];
				for (const item of raw.slice(0, 100)) {
					const account = object(item),
						user = object(account.user),
						identifier = string(user.name);
					if (!identifier) continue;
					accounts.push({
						provider: "azure",
						identifier,
						principalType:
							user.type === "user" ? "user" : user.type === "servicePrincipal" ? "service" : "unknown",
						...(string(account.id) ? { accountId: string(account.id) } : {}),
						...(string(account.tenantId) ? { tenantId: string(account.tenantId) } : {}),
					});
				}
				const facts: UserProfile = accounts.length ? { accounts } : {};
				// A directory /me response supplies a human candidate, never a confirmed user assertion.
				try {
					const user = object(
						await json(["az", "ad", "signed-in-user", "show", "--output", "json", "--only-show-errors"], signal),
					);
					for (const [field, key] of [
						["givenName", "givenName"],
						["familyName", "surname"],
						["email", "mail"],
						["jobTitle", "jobTitle"],
						["department", "department"],
						["telephone", "mobilePhone"],
					] as const) {
						const value = string(user[key]);
						if (value) facts[field] = value;
					}
				} catch {
					/* Account associations remain useful when directory access is unavailable. */
				}
				return observations("azure", facts);
			},
		},
		{
			id: "aws",
			name: "AWS account identities",
			available: async () => available("aws"),
			async collect(signal) {
				const listed = await run(["aws", "configure", "list-profiles"], signal);
				const profiles =
					listed.exitCode === 0
						? [
								...new Set(
									listed.stdout
										.split(/\r?\n/)
										.map(name => name.trim())
										.filter(name => /^[\w .@-]{1,128}$/.test(name) && !name.startsWith("-")),
								),
							].slice(0, 99)
						: [];
				const targets = [undefined, ...profiles];
				const accounts: NonNullable<UserProfile["accounts"]> = [];
				for (let offset = 0; offset < targets.length; offset += 4) {
					if (signal?.aborted) break;
					const batch = await Promise.all(
						targets.slice(offset, offset + 4).map(async profile => {
							try {
								const active = object(
									await json(
										[
											"aws",
											"sts",
											"get-caller-identity",
											"--output",
											"json",
											"--no-cli-pager",
											...(profile ? ["--profile", profile] : []),
										],
										signal,
									),
								);
								const identifier = string(active.Arn),
									accountId = string(active.Account);
								if (!identifier) return undefined;
								return {
									provider: "aws",
									identifier,
									principalType:
										identifier.includes(":assumed-role/") || identifier.includes(":role/")
											? ("role" as const)
											: identifier.includes(":user/")
												? ("user" as const)
												: ("unknown" as const),
									...(accountId ? { accountId } : {}),
								};
							} catch {
								return undefined;
							}
						}),
					);
					for (const account of batch)
						if (account && !accounts.some(existing => existing.identifier === account.identifier))
							accounts.push(account);
				}
				if (!accounts.length) throw new Error("Account discovery unavailable");
				return observations("aws", { accounts });
			},
		},
		{
			id: "google",
			name: "Google Cloud account identities",
			available: async () => available("gcloud"),
			async collect(signal) {
				const raw = await json(["gcloud", "auth", "list", "--format=json", "--quiet"], signal);
				if (!Array.isArray(raw)) throw new Error("Account discovery unavailable");
				const accounts: NonNullable<UserProfile["accounts"]> = [];
				for (const item of raw.slice(0, 100)) {
					const identifier = string(object(item).account);
					if (!identifier) continue;
					accounts.push({
						provider: "google",
						identifier,
						principalType: identifier.endsWith(".gserviceaccount.com") ? "service" : "unknown",
					});
				}
				return observations("google", accounts.length ? { accounts } : {});
			},
		},
		{
			id: "gitlab",
			name: "GitLab account identity",
			available: async () => available("glab"),
			async collect(signal) {
				const user = object(await json(["glab", "api", "user"], signal));
				const facts: UserProfile = {};
				const name = string(user.name);
				if (name) Object.assign(facts, splitFullName(name));
				const email = string(user.email);
				if (email) facts.email = email;
				const username = string(user.username);
				if (username)
					facts.accounts = [
						{
							provider: "gitlab",
							identifier: username,
							principalType: user.bot === true ? "service" : "unknown",
						},
					];
				const url = string(user.web_url);
				if (url) facts.sameAs = [url];
				return observations("gitlab", facts);
			},
		},
	];
}
