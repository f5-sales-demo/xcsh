import indexGzipPath from "./.documentation-generated/terraform/terraform-documentation.sqlite.gz" with {
	type: "file",
};
import type { TerraformEmbeddedAssets } from "./terraform-documentation";
export const EMBEDDED_TERRAFORM_DOCUMENTATION = {
	indexGzipPath,
	pin: {
		schema_version: 2,
		retrieval_metadata_version: 1,
		source_root: "documentation",
		source_repository: "f5-sales-demo/terraform-provider-xcsh",
		release_tag: "documentation-v12.2.0",
		provider_version: "v12.2.0",
		source_commit: "b53aad4062cce8c72c387720a614043232d129b9",
		document_count: 18954,
		provider_schema_digest: "sha256:d20ce271369d414e9d5661659e153a5441a9bde0053a466518eae9b8b5ab32fd",
		spec_pin_digest: "sha256:442a6f7ed6e6f9010cd38e0a636e997c70358deccd3ce493d233d9ed86c49d27",
		receipt_sha256: "f735dbfcb84536210bd396ec0d54477e662e005ad0b37b9e35f962fce5e79693",
		assets: {
			"canonical-documentation.tar.gz": {
				sha256: "063143f67dfa7cdd3b85d04cb2f93807aa51d7fec01f3181b87c03bb0d6b7687",
				size_bytes: 58424809,
			},
			"canonical-manifest.json": {
				sha256: "b1907b7f5fa837e9f1a306883ee649948d9e28bf5b57674c5fbbc25886b5b219",
				size_bytes: 8782347,
			},
			"manifest.json": {
				sha256: "1b7dbf7d398a9665e1000a4e69d17904cb7ad436416f0ad0615ac0868f8a99c7",
				size_bytes: 82249062,
			},
			"publication.json": {
				sha256: "f735dbfcb84536210bd396ec0d54477e662e005ad0b37b9e35f962fce5e79693",
				size_bytes: 1380,
			},
			"registry-documentation.tar.gz": {
				sha256: "bff0d3d3b44f5583b2ebc149e7e333c5de168d47ed7a7141ea8a828a802d795c",
				size_bytes: 15079162,
			},
			"registry-manifest.json": {
				sha256: "45b2effaf71f40c5c22fd97e3e77fb68b12f5cda2068bd74de6b9a9715a946cb",
				size_bytes: 251371,
			},
			"registry-projection-manifest.json": {
				sha256: "60f2c21aca2588f303908b1e23530d72888da1b9b46c8e4c08ea4c1bdc0c5b25",
				size_bytes: 303237,
			},
			SHA256SUMS: { sha256: "a2d2adfb88590479a83081afd2cfbe143dda1c4bd611dd544dab419f85c63dc4", size_bytes: 723 },
			"terraform-docs.tar.gz": {
				sha256: "a368e629261f6e7ea2f704aad532a0e02b44d0edbe6d4f16142a25f436e986da",
				size_bytes: 11773509,
			},
		},
		index: {
			sha256: "067e04c33404d29a13318624bcc768947673a4732c504d4e43754f69baa11ade",
			size_bytes: 902631424,
			gzip_sha256: "01bf90ae7ab268f9ee0bc9506ad29ed9ccb9e35742f8859446f8539fc0575114",
			gzip_size_bytes: 78715974,
		},
	},
} satisfies TerraformEmbeddedAssets;
