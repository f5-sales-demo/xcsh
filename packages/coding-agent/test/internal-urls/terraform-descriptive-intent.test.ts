import { expect, test } from "bun:test";
import { terraformProviderMention, terraformQueryIdentity } from "../../src/internal-urls/terraform-documentation";
import { interpretTerraformLifecycle } from "../../src/internal-urls/terraform-lifecycle";
import {
	propertyExplicitSchemaPaths,
	propertyNamedRootPath,
	propertyQueryTerms,
	propertyRequestedBlockText,
	propertyRequestedText,
	propertyRequestsBlock,
	propertySchemaIdentifiers,
} from "../../src/internal-urls/terraform-property-ranking";
import { type RankedProperty, selectPropertyDestination } from "../../src/internal-urls/terraform-property-selection";

test("explicit terminal leaf and setting requests survive earlier branch verbs", () => {
	const requests = [
		["Within detection settings, identify the default-enabled flag.", "the default-enabled flag"],
		[
			"I selected the policy. Point me to the leaf used to choose the comparison operation.",
			"choose the comparison operation",
		],
		[
			"The service uses HTTPS. Find the setting for the lower supported TLS version.",
			"the lower supported TLS version",
		],
		[
			"Which leaf inside returned items records when the session began?",
			"inside returned items records when the session began?",
		],
	];
	for (const [query, target] of requests) {
		expect(propertyRequestsBlock(query!)).toBe(false);
		expect(propertyRequestedText(query!)).toBe(target);
	}
	expect(propertyRequestsBlock("Which block should I choose for the comparison?")).toBe(true);
});

test("version bounds and session beginnings use the documented field vocabulary", () => {
	expect(propertyQueryTerms("lower supported TLS version")).toContain("min");
	expect(propertyQueryTerms("upper supported TLS version")).toContain("max");
	expect(propertyQueryTerms("when the session began")).toContain("start");
	expect(propertyQueryTerms("the lower subnet")).not.toContain("min");
});

test("provider ownership excludes incidentally named target objects", () => {
	const names = ["subnet", "token", "authorization_server", "authentication", "app_setting"];
	expect(
		terraformProviderMention(
			"A managed resource allocating interface addresses uses an assigned subnet. Locate the offset.",
			names,
		),
	).toBeUndefined();
	expect(
		terraformProviderMention("For Terraform managed application settings, find the malicious user threshold.", names),
	).toBe("app_setting");
	expect(
		terraformProviderMention(
			"Managed OIDC authentication configuration uses explicit endpoints. Find the token URL at the authorization server.",
			names,
		),
	).toBe("authentication");
	expect(
		terraformProviderMention("Compare authentication resource and authorization server resource.", names),
	).toBeUndefined();
	expect(terraformProviderMention("The subnet resource uses a token.", names)).toBe("subnet");
});

test("an earlier capability verb cannot erase a terminal value lookup", () => {
	expect(propertyRequestsBlock("AWS parameters enable disk encryption. Locate the KMS key identifier.")).toBe(false);
	expect(propertyRequestedText("AWS parameters enable disk encryption. Locate the KMS key identifier.")).toBe(
		"the KMS key identifier",
	);
});

test("managed and read-only Terraform ownership retain the provider role", () => {
	expect(terraformQueryIdentity("In Terraform managed application settings, locate a threshold.").providerType).toBe(
		"resources",
	);
	expect(terraformQueryIdentity("For Terraform read-only xcsh_fixture, locate authentication.").providerType).toBe(
		"data-sources",
	);
	expect(terraformQueryIdentity("Compare Terraform managed and read-only xcsh_fixture.").providerType).toBeUndefined();
	expect(
		terraformQueryIdentity(
			"For Terraform xcsh_authentication, which field names the decryption provider for the F5XC-managed secret?",
		).providerType,
	).toBeUndefined();
	expect(
		terraformProviderMention("In Terraform managed alert routing, match an alert name using a regular expression.", [
			"route",
			"alert_policy",
		]),
	).toBeUndefined();
});

test("a described scalar count is not an undecided capability block", () => {
	const row = (path: string, anchor: string, description: string, score: number): RankedProperty => ({
		provider_type: "resources",
		provider_name: "fixture",
		schema_path: path,
		path: `documentation/resources/fixture/${path}/index.md`,
		anchor,
		description,
		score,
		coverage: 0.8,
	});
	const rows = [
		row(
			"enable_detection.failures.threshold",
			"schema-threshold",
			"Count above which the user is considered malicious.",
			50,
		),
		row("enable_detection", "section", "Enable detection.", 30),
		row("disable_detection", "section", "Disable detection.", 20),
	];
	expect(
		selectPropertyDestination(
			"Find the count above which the user is considered malicious in the detection settings.",
			rows,
			[],
			{ identityResolved: true },
		).destinations[0]?.anchor,
	).toBe("schema-threshold");
	expect(
		selectPropertyDestination("Which detection block should I use?", rows.slice(1), [], { identityResolved: true })
			.kind,
	).toBe("choices");
});

test("affirmative endpoint and exact block vocabulary retain their meanings", () => {
	expect(
		propertyQueryTerms("Locate the authorization endpoint URL, rather than the token or logout endpoint."),
	).not.toContain("token");
	expect(propertyQueryTerms("Compare the authorization endpoint URL and the token endpoint URL.")).toContain("token");
	expect(propertyRequestsBlock("Locate basic authentication inside the webhook HTTP configuration.")).toBe(true);
	expect(propertyRequestedBlockText("Locate basic authentication inside the webhook HTTP configuration.")).toBe(
		"basic authentication",
	);
	expect(propertyRequestsBlock("Locate the user name inside basic authentication.")).toBe(false);
	expect(
		propertyNamedRootPath("Use the root notification parameters rather than a route override. Locate the interval."),
	).toBe("notification_parameters");
	expect(propertyNamedRootPath("Compare root notification parameters and route overrides.")).toBeUndefined();
	expect(propertyNamedRootPath("Use the root property reference. Explain a field.")).toBeUndefined();
});

test("lifecycle operation intent survives an unrelated rejected transport timeout", () => {
	for (const operation of ["read", "update", "delete"]) {
		expect(
			interpretTerraformLifecycle(
				`Locate the lifecycle timeout leaf for ${operation} operations. I want the duration control, not an API timeout inside a nested protocol setting.`,
			)?.operations,
		).toEqual([operation]);
	}
	expect(interpretTerraformLifecycle("Locate read timeout, not update timeout.")?.operations).toEqual([]);
	expect(interpretTerraformLifecycle("Locate a timeout for read or update operations.")?.operations).toEqual([
		"read",
		"update",
	]);
});

test("attributed field descriptions cannot introduce schema scope or Terraform roles", () => {
	const query =
		"In Terraform resource xcsh_workload, follow `stateful_service` → `mount`. Find the field described as follows: VOLUME_MOUNT_READ_ONLY means read-only mount.";
	expect(propertySchemaIdentifiers(query, "workload")).not.toContain("volume_mount_read_only");
	expect(terraformQueryIdentity(query).providerType).toBe("resources");
	expect(propertySchemaIdentifiers("Find the field `qmd_unknown_field` in the reference.")).toContain(
		"qmd_unknown_field",
	);
});

test("per-attempt retry limits stay separate from resource lifecycle durations", () => {
	expect(
		interpretTerraformLifecycle(
			"Find the field described as follows: Specifies a non-zero timeout per retry attempt. In milliseconds.",
		),
	).toBeUndefined();
	expect(interpretTerraformLifecycle("Find a resource update timeout.")?.operations).toEqual(["update"]);
});

test("source-attributed lookup extracts the requested field meaning", () => {
	expect(propertyRequestedText("Follow `memory`. Find the field described as follows: RAM size in MB.")).toBe(
		"RAM size in MB.",
	);
	expect(propertyRequestedText("Locate the leaf with this documented meaning: duration in seconds.")).toBe(
		"duration in seconds.",
	);
	expect(propertyRequestedText("Which field describes the namespace?")).toBe("the namespace?");
});

test("literal single-parent and multi-parent trails remain affirmative caller scope", () => {
	expect(
		propertyExplicitSchemaPaths("Follow `headers`. Find the field described as follows: Invert the match result."),
	).toEqual(["headers"]);
	expect(
		propertyExplicitSchemaPaths(
			"Follow `cloudflare` → `js_insertion_rules`. Find the field described as follows: Insert before the first tag.",
		),
	).toEqual(["cloudflare.js_insertion_rules"]);
	expect(
		terraformQueryIdentity(
			"For Terraform xcsh_secret_management_access, explain `role_id`. I have not chosen the Terraform declaration or lookup role.",
		).providerType,
	).toBeUndefined();
});
