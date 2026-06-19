export interface TerraformProvider {
	readonly source: string;
	readonly registry: string;
	readonly required_block: string;
	readonly config_block: string;
	readonly auth_methods: readonly string[];
	readonly syntax_rules: readonly string[];
}

export interface TerraformOneOfGroup {
	readonly parent?: string;
	readonly fields: readonly string[];
}

export interface TerraformDependencies {
	readonly requires: readonly string[];
	readonly used_by?: readonly string[];
}

export interface TerraformResource {
	readonly category: string;
	readonly description: string;
	readonly required: readonly string[];
	readonly oneof_groups?: readonly TerraformOneOfGroup[];
	readonly server_defaults?: readonly string[];
	readonly minimal_config?: string;
	readonly dependencies: TerraformDependencies;
	readonly import_syntax: string;
}

export interface TerraformCategory {
	readonly name: string;
	readonly slug: string;
	readonly description: string;
	readonly resource_count: number;
	readonly resources: readonly string[];
	readonly dependency_chain?: string;
}

export interface TerraformIndex {
	readonly version: string;
	readonly provider: TerraformProvider;
	readonly categories: readonly TerraformCategory[];
	readonly resources: Readonly<Record<string, TerraformResource>>;
}
