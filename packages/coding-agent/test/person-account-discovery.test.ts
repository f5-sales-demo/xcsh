import { expect, test } from "bun:test";
import { createAccountCollectors } from "../src/person-profile/account-collectors";
import { validateObservation } from "../src/person-profile/schema";

test("Azure discovers multiple account associations and keeps service principals out of human facts", async () => {
	const collectors = createAccountCollectors(
		async argv => ({
			exitCode: 0,
			stdout: JSON.stringify(
				argv.includes("list")
					? [
							{
								id: "subscription-a",
								tenantId: "example-tenant-a",
								user: { name: "synthetic@example.com", type: "user" },
							},
							{
								id: "subscription-b",
								tenantId: "example-tenant-b",
								user: { name: "service-id", type: "servicePrincipal" },
							},
						]
					: {
							givenName: "Synthetic",
							surname: "Person",
							mail: "synthetic@example.com",
							accessToken: "never-store-sentinel",
						},
			),
		}),
		() => true,
	);
	const result = await collectors.find(c => c.id === "azure")!.collect();
	expect(result).toHaveProperty("facts", {});
	const observations = (result as { observations: unknown[] }).observations;
	for (const observation of observations) validateObservation(observation);
	expect(JSON.stringify(result)).toContain("subscription-b");
	expect(JSON.stringify(result)).not.toContain("never-store-sentinel");
	expect(JSON.stringify(result)).toContain('"kind":"observed"');
});

test("AWS role identity stays structured evidence and collector errors never expose command output", async () => {
	const collectors = createAccountCollectors(
		async () => ({
			exitCode: 0,
			stdout: JSON.stringify({
				Account: "123456789012",
				Arn: "arn:aws:sts::123456789012:assumed-role/Synthetic/session",
				Secret: "never-store-sentinel",
			}),
		}),
		() => true,
	);
	const result = await collectors.find(c => c.id === "aws")!.collect();
	expect(result).toHaveProperty("facts", {});
	expect(JSON.stringify(result)).toContain('"principalType":"role"');
	expect(JSON.stringify(result)).not.toContain("never-store-sentinel");
	const broken = createAccountCollectors(
		async () => ({ exitCode: 1, stdout: "private-sentinel" }),
		() => true,
	);
	await expect(broken.find(c => c.id === "aws")!.collect()).rejects.toThrow("Account discovery unavailable");
});

test("AWS gathers configured profiles even when the default account is unavailable", async () => {
	const collectors = createAccountCollectors(
		async argv => {
			if (argv.includes("list-profiles")) return { exitCode: 0, stdout: "example-account-a\nexample-account-b\n" };
			const profile = argv[argv.indexOf("--profile") + 1];
			if (!argv.includes("--profile")) return { exitCode: 1, stdout: "" };
			return {
				exitCode: 0,
				stdout: JSON.stringify({ Account: "123456789012", Arn: `arn:aws:iam::123456789012:user/${profile}` }),
			};
		},
		() => true,
	);
	const result = await collectors.find(c => c.id === "aws")!.collect();
	expect(JSON.stringify(result)).toContain("example-account-a");
	expect(JSON.stringify(result)).toContain("example-account-b");
});
