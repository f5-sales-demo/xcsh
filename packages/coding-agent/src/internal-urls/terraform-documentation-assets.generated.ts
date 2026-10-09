import indexGzipPath from "./.documentation-generated/terraform/terraform-documentation.sqlite.gz" with {
	type: "file",
};
import type { TerraformEmbeddedAssets } from "./terraform-documentation";
export const EMBEDDED_TERRAFORM_DOCUMENTATION = {
	indexGzipPath,
	pin: {
		assets: {
			"canonical-documentation.tar.gz": {
				sha256: "a587ffe7493a3ff798f04fffaf8c44e5bade4d4db7a87d37a057db76e520251e",
				size_bytes: 46290029,
			},
			"canonical-manifest.json": {
				sha256: "462e3709ad87ccd35b24861129b559cd89ca5d0820e358fcd0411ce4060d3397",
				size_bytes: 7563114,
			},
			"manifest.json": {
				sha256: "a23c135f064768a3c9b5607186a82bc55c90bf877dd44cb881ddc30031344040",
				size_bytes: 70455788,
			},
			"publication.json": {
				sha256: "06077d54964ba80224db9dd006d3787c858bb3874244dbc40cc42ed72bf5275d",
				size_bytes: 1378,
			},
			"registry-documentation.tar.gz": {
				sha256: "e417aedb7ec297bdabfd6d79a55fdf277ba8240b782742bbc16a46c83ec6cfd8",
				size_bytes: 9973451,
			},
			"registry-manifest.json": {
				sha256: "8686640f9467e9ef30a9c7fa14dc55540441d6b6ca99145d6d075aaab8833449",
				size_bytes: 236253,
			},
			"registry-projection-manifest.json": {
				sha256: "37a17468c18c89d6bd7866ef56a711fed2f159a5ba71189c2017c452b9ed98d3",
				size_bytes: 275841,
			},
			SHA256SUMS: { sha256: "4dd2b0b75eebe16ad37e12b4cb1b7f6d624e9117af273ef21d51774231fc0352", size_bytes: 723 },
			"terraform-docs.tar.gz": {
				sha256: "1ef05c0b53548862e70f9886845e6533deddd0b5823b4fe149aa919edf2f725f",
				size_bytes: 9851591,
			},
		},
		document_count: 16396,
		provider_schema_digest: "sha256:7e724befbd28dae1d544e2cc8bbc72d0e62fdd0382374fb6e98044bf0ff0e829",
		provider_version: "v15.6.0",
		release_tag: "documentation-v15.6.0",
		retrieval_metadata_version: 1,
		schema_version: 2,
		source_commit: "3cb69ea26efef3ed58124168d50589897b5b1800",
		source_repository: "f5-sales-demo/terraform-provider-xcsh",
		source_root: "documentation",
		spec_pin_digest: "sha256:e06a3ea9db6a533295efd5c7a477afc65990ba80c3a998885b97b47262cfe9f1",
		receipt_sha256: "06077d54964ba80224db9dd006d3787c858bb3874244dbc40cc42ed72bf5275d",
		index: {
			sha256: "4b34207c4729fdf07cafbc54b1f7896eedd38d7c823e3ece16a737cee06ad1c4",
			size_bytes: 667942912,
			gzip_sha256: "e39d5711ee2e6b9aac6ae622bb749bb89a7c9322aa4b1c542324e90395a1c804",
			gzip_size_bytes: 63443218,
		},
	},
} satisfies TerraformEmbeddedAssets;
