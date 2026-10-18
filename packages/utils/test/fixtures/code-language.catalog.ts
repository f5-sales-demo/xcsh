/** Synthetic examples; syntax checks never execute scripts or provision resources. */
export const codeLanguageCatalog = [
	{
		id: "json-compact",
		language: "json",
		valid: true,
		source:
			'{"metadata":{"name":"f5-demo","namespace":"demo"},"spec":{"domains":["app.example.com"],"enabled":true,"count":2}}',
	},
	{
		id: "json-lossless",
		language: "json",
		valid: true,
		source: '{"count":9007199254740993,"count":-0,"exponent":1.2300e+400,"escaped":"\\u0061\\/"}',
	},
	{
		id: "json-formatted",
		language: "json",
		valid: true,
		source: '{\n  "domain": "example.com",\n  "pageURL": "https://checkout.example.com/"\n}',
	},
	{
		id: "yaml-compact",
		language: "yaml",
		valid: true,
		source: "metadata: {name: f5-demo, namespace: demo}\nspec: {domains: [app.example.com], enabled: true, count: 2}",
	},
	{
		id: "yaml-anchors",
		language: "yml",
		valid: true,
		source:
			'# Synthetic configuration\nmetadata: &meta {name: f5-demo, namespace: demo} # retained\ncopy: *meta\nstring: !!str 123\nscalar: "true"\nscript: |\n  printf "%s" "hello"\n\n  printf "%s" "again"\n',
	},
	{
		id: "yaml-documents",
		language: "yaml",
		valid: true,
		source: '---\nmetadata:\n  name: f5-demo\n...\n---\ncount: 9007199254740993\nstring: "null"\n',
	},
	{
		id: "hcl",
		language: "terraform",
		valid: true,
		source: `# Synthetic Terraform configuration
variable "domains" {
  type = list(string)
  default = ["app.example.com"]
}
locals {
  enabled = true
  count = 2
  names = [for domain in var.domains : "https://\${domain}" if domain != ""]
  script = <<-EOT
    printf "%s" "example"
  EOT
}
`,
	},
	{
		id: "bash",
		language: "sh",
		valid: true,
		source: `# Read-only request example
namespace="demo"
curl --request POST \\
  --header 'Content-Type: application/json' \\
  --data '{"domain":"example.com","pageURL":"https://checkout.example.com/"}' \\
  "https://tenant.example.com/api/shape/csd/namespaces/\${namespace}/testjs"

cat <<'EOF'
Literal "$HOME" and \`backticks\`
EOF
`,
	},
	{
		id: "python",
		language: "py",
		valid: true,
		source:
			'# Offline manifest construction\nimport json\n\ndef manifest(domain: str) -> dict:\n    if not domain:\n        raise ValueError("domain is required")\n    return {"metadata": {"name": "f5-demo"}, "spec": {"domains": [domain], "count": 2}}\n\npayload = json.dumps(manifest("app.example.com"))\n',
	},
	{
		id: "python-tabs",
		language: "python",
		valid: true,
		source: 'def payload():\n\treturn {"domain": "example.com", "pageURL": "https://checkout.example.com/"}\n',
	},
	{
		id: "http-api-call",
		language: "http",
		valid: true,
		source:
			'POST /api/shape/csd/namespaces/{namespace}/testjs\nContent-Type: application/json\n\n{\n  "domain": "example.com",\n  "pageURL": "https://checkout.example.com/"\n}',
	},
	{
		id: "http-status",
		language: "http",
		valid: true,
		source: "HTTP/1.1 200 OK\nContent-Type: application/yaml\n\nmetadata:\n  name: f5-demo\ncount: 2\n",
	},
	{
		id: "http-untyped",
		language: "http",
		valid: true,
		source: 'GET /api/config/namespaces/demo HTTP/1.1\nAccept: application/json\n\n{"incomplete":',
	},
	{
		id: "unknown",
		language: "f5-example",
		valid: false,
		source: 'opaque <script>alert("literal")</script> & value\n\tkeep layout\n',
	},
	{ id: "unspecified", language: "", valid: false, source: '{"looks":"like json","count":2}' },
	{ id: "json-incomplete", language: "json", valid: false, source: '{"metadata":{"name":' },
	{ id: "yaml-incomplete", language: "yaml", valid: false, source: "metadata: [name, namespace" },
	{
		id: "hcl-incomplete",
		language: "hcl",
		valid: false,
		source: 'resource "xcsh_http_loadbalancer" "demo" {\n  domains = ["app.example.com"',
	},
	{
		id: "long-literal",
		language: "bash",
		valid: true,
		source: `printf '%s\\n' '${"literal-with spaces ".repeat(30)}'\n`,
	},
] as const;

export function codeCatalogMarkdown(): string {
	return codeLanguageCatalog
		.map(item => `### ${item.id}\n\n\`\`\`${item.language}\n${item.source}\n\`\`\``)
		.join("\n\n");
}
