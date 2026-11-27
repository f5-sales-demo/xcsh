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
				sha256: "70b659f94cab51d9d352dd038f7d1cb642bf34b04a000f3274b962a0ef3311d4",
				size_bytes: 7565729,
			},
			"manifest.json": {
				sha256: "7f04cf696b86ebfd7561bd704babd17e009cde096b81f5b7031e49195afcdac2",
				size_bytes: 70478861,
			},
			"publication.json": {
				sha256: "94033baad1688e9178a4ee986a51c1b91beeb69aa1a925384ec7c7251461723f",
				size_bytes: 1382,
			},
			"registry-documentation.tar.gz": {
				sha256: "8dc572310e731147a28f860d75a9b1e04bf64c24087708ca5109434b83a11eda",
				size_bytes: 9982254,
			},
			"registry-manifest.json": {
				sha256: "b9720a7395b94e88eac5f0dd3349dbe9d546a2a0ed49cf911101727132997c7b",
				size_bytes: 237499,
			},
			"registry-projection-manifest.json": {
				sha256: "581badafac5bcd5911c57a84d7516298850e5b7da4797adff0bd35405ce90d1d",
				size_bytes: 276722,
			},
			SHA256SUMS: { sha256: "3d58c6f9290664ce69b16e739b554af687da31e6d81b4cbf3810e09715e1b737", size_bytes: 723 },
			"terraform-docs.tar.gz": {
				sha256: "68e0b5510ad97f0a057caedf81dd9e54c36f8f115007d19ceb94b3c3a805d48c",
				size_bytes: 9857727,
			},
		},
		document_count: 16403,
		provider_schema_digest: "sha256:e62318985676da5dc8f5d2d35ccc26c58c5f11f463e5627995ce95f8658f6b43",
		provider_version: "v15.17.11",
		release_tag: "documentation-v15.17.11",
		retrieval_metadata_version: 1,
		schema_version: 2,
		source_commit: "31da070d5a2d6ad7a0ebdbdfe0c1125def8afa50",
		source_repository: "f5-sales-demo/terraform-provider-xcsh",
		source_root: "documentation",
		spec_pin_digest: "sha256:b750ce4b9c0ad9c90dad992a893773bacfb3aeff7598bc37194f3037f353c949",
		receipt_sha256: "94033baad1688e9178a4ee986a51c1b91beeb69aa1a925384ec7c7251461723f",
		index: {
			sha256: "45e25908a7558e456fe33b634ac7fc16bc822db259d2bec8921087edebcc5aff",
			size_bytes: 668192768,
			gzip_sha256: "b16c6aebfcbc25a108e6e6b7e6ca0c89d6a2fc02792878a6d7e596a84ef757be",
			gzip_size_bytes: 63344980,
		},
	},
} satisfies TerraformEmbeddedAssets;
