import indexGzipPath from "./.documentation-generated/terraform/terraform-documentation.sqlite.gz" with {
	type: "file",
};
import type { TerraformEmbeddedAssets } from "./terraform-documentation";
export const EMBEDDED_TERRAFORM_DOCUMENTATION = {
	indexGzipPath,
	pin: {
		assets: {
			"canonical-documentation.tar.gz": {
				sha256: "9b29e17ff1dada1cdbc826d78a54f0c86c6390f9df779862d0051145465f1cbd",
				size_bytes: 46322493,
			},
			"canonical-manifest.json": {
				sha256: "a1f2ac1e9e34efa79b418c34231c8c059bd35f25ce0cd10d6d19036ef5ae471c",
				size_bytes: 7565729,
			},
			"manifest.json": {
				sha256: "28b2791110b979399b0195d08c87377e9f76f404095197a6e4613bbb1093220c",
				size_bytes: 70478861,
			},
			"publication.json": {
				sha256: "fc4ac550765cb9b8846895d451616dc95bf0cb832da09290c712ef5d289d1ee0",
				size_bytes: 1382,
			},
			"registry-documentation.tar.gz": {
				sha256: "8dc572310e731147a28f860d75a9b1e04bf64c24087708ca5109434b83a11eda",
				size_bytes: 9982254,
			},
			"registry-manifest.json": {
				sha256: "df73411d34b886c0825f4a9e3f89794233c22a7b0fc6ab2fbfcf491046d682f4",
				size_bytes: 237499,
			},
			"registry-projection-manifest.json": {
				sha256: "581badafac5bcd5911c57a84d7516298850e5b7da4797adff0bd35405ce90d1d",
				size_bytes: 276722,
			},
			SHA256SUMS: { sha256: "54e587c5acd348fc3a44d70bb2b38501761f0d13919e16b70dd8685cb9762ea7", size_bytes: 723 },
			"terraform-docs.tar.gz": {
				sha256: "68e0b5510ad97f0a057caedf81dd9e54c36f8f115007d19ceb94b3c3a805d48c",
				size_bytes: 9857727,
			},
		},
		document_count: 16403,
		provider_schema_digest: "sha256:e62318985676da5dc8f5d2d35ccc26c58c5f11f463e5627995ce95f8658f6b43",
		provider_version: "v15.17.12",
		release_tag: "documentation-v15.17.12",
		retrieval_metadata_version: 1,
		schema_version: 2,
		source_commit: "f92bd112635a6adcbac5b746c8bf89490a58dd6d",
		source_repository: "f5-sales-demo/terraform-provider-xcsh",
		source_root: "documentation",
		spec_pin_digest: "sha256:b750ce4b9c0ad9c90dad992a893773bacfb3aeff7598bc37194f3037f353c949",
		receipt_sha256: "fc4ac550765cb9b8846895d451616dc95bf0cb832da09290c712ef5d289d1ee0",
		index: {
			sha256: "e50271b70aeca6a186e3ea7c4631455fbf2e860e5fb7ed19bfad2025867d0ae0",
			size_bytes: 668192768,
			gzip_sha256: "91016942739a8dbe69e33c20c2df522e5628f43b88b83faab9d4d28f9acb08dc",
			gzip_size_bytes: 63344968,
		},
	},
} satisfies TerraformEmbeddedAssets;
