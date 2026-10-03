import { TerraformDocumentationRepository, terraformHash } from "../../../src/internal-urls/terraform-documentation";
import { EMBEDDED_TERRAFORM_DOCUMENTATION as assets } from "../../../src/internal-urls/terraform-documentation-assets.generated";
import type { InternalUrl } from "../../../src/internal-urls/types";
const repo = new TerraformDocumentationRepository(assets, process.argv[2] ?? "/tmp/4682-cache");
const read = (url: string) =>
	repo.resolve(Object.assign(new URL(url), { rawHost: "terraform-documentation" }) as InternalUrl);
const cases = [
	["Which resource field sets the maximum duration permitted for Namespace creation?", "create"],
	["Which field sets the maximum duration permitted for Resource destruction in xcsh_namespace?", "delete"],
	["Which resource field sets the timeout for Namespace refresh operation?", "read"],
	["Which resource field sets the timeout for Namespace read operation?", "read"],
	["Which resource field sets the timeout for Namespace modification?", "update"],
	["Which resource field controls Namespace creation and destruction timeout?", "choices"],
	["Which resource field controls Namespace timeout?", "choices"],
	["Read the documentation for the resource Namespace timeout field", "choices"],
	["Which resource field sets Namespace initial timeout?", "choices"],
	["Which resource field sets Namespace timeout not for creation?", "choices"],
	["Which resource field sets retry counts for Namespace creation timeout?", "choices"],
	["Which field sets Namespace creation timeout?", "choices"],
	["Which resource field controls creation timeout?", "choices"],
];
const results = [];
for (const [prompt, expected] of cases) {
	const response = await read("xcsh://terraform-documentation/?search=" + encodeURIComponent(prompt!));
	const destinations = [...response.content.matchAll(/^Read: (\S+)/gm)].map(m => m[1]!);
	const leaf = response.content.includes("Selected leaf;");
	const passed = expected === "choices" ? !leaf : leaf && destinations[0]?.endsWith(`#schema-timeouts--${expected}`);
	if (!passed) console.error(response.content);
	if (Buffer.byteLength(response.content) > 4096) throw Error("discovery budget");
	let context = "";
	if (leaf) {
		context = (await read(destinations[0]!)).content;
		if (Buffer.byteLength(context) > 16384) throw Error("context budget");
	}
	results.push({
		prompt,
		expected,
		passed,
		leaf,
		destinations,
		response_sha256: terraformHash(response.content + "\0" + context),
		bytes: response.size,
	});
}
console.log(
	JSON.stringify(
		{
			development_only: true,
			qualification_passed: false,
			source: assets.pin.source_commit,
			index: assets.pin.index,
			results,
		},
		null,
		2,
	),
);
(await repo.database()).close();
if (results.some(r => !r.passed)) process.exit(1);
