import { describe, expect, test } from 'bun:test';

const CATEGORIZED_LLMS_TXT = `# F5 Distributed Cloud Sales Demos

> Demo guides for F5 Distributed Cloud sales engineering.

## Documentation Sets

- [Abridged documentation](https://example.com/llms-small.txt): compact version
- [Complete documentation](https://example.com/llms-full.txt): full docs

## Lab Infrastructure
Deployable Azure VM components for demo environments. Terraform-based, deterministic, pre-configured.

- [Origin Server](https://example.com/origin-server/llms.txt): Ubuntu 24.04 origin server with vulnerable web applications
- [Traffic Generator](https://example.com/traffic-generator/llms.txt): Azure VM with 50+ security tools and attack suites
- [CDN Simulator](https://example.com/cdn-simulator/llms.txt): NGINX-based CDN edge node simulator

## Product Features
F5 XC product capability documentation and demo guides.

- [WAF](https://example.com/waf/llms.txt): F5 XC web application firewall
- [API Security](https://example.com/api-protection/llms.txt): F5 XC API security

## Notes

- Content is auto-generated from official docs
`;

const FLAT_LLMS_TXT = `# F5 Distributed Cloud Sales Demos

## Federated Sites

- [Origin Server](https://example.com/origin-server/llms.txt): Ubuntu 24.04 origin server
- [WAF](https://example.com/waf/llms.txt): F5 XC web application firewall
`;

const EMPTY_LAB_LLMS_TXT = `# F5 Distributed Cloud Sales Demos

## Product Features

- [WAF](https://example.com/waf/llms.txt): F5 XC web application firewall
`;

interface SiteEntry {
	label: string;
	url: string;
	description: string;
}

function parseSection(llmsTxt: string, sectionHeading: string): SiteEntry[] {
	const escapedHeading = sectionHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const sectionRegex = new RegExp(
		`^## ${escapedHeading}\\n(?:[^\\n#][^\\n]*\\n)?\\n((?:- \\[.*\\n)*)`,
		'm'
	);
	const match = llmsTxt.match(sectionRegex);
	if (!match) return [];

	const entries: SiteEntry[] = [];
	const entryRegex = /- \[([^\]]+)\]\(([^)]+)\)(?:: (.+))?/g;
	let m: RegExpExecArray | null;
	while ((m = entryRegex.exec(match[1])) !== null) {
		entries.push({ label: m[1], url: m[2], description: m[3] || '' });
	}
	return entries;
}

function hasCategorizedFederation(llmsTxt: string): boolean {
	return !llmsTxt.includes('\n## Federated Sites\n');
}

function parseLabInfrastructure(llmsTxt: string): SiteEntry[] {
	return parseSection(llmsTxt, 'Lab Infrastructure');
}

describe('parseLabInfrastructure', () => {
	test('extracts all components from ## Lab Infrastructure', () => {
		const components = parseLabInfrastructure(CATEGORIZED_LLMS_TXT);
		expect(components).toHaveLength(3);
	});

	test('extracts correct labels', () => {
		const components = parseLabInfrastructure(CATEGORIZED_LLMS_TXT);
		expect(components[0].label).toBe('Origin Server');
		expect(components[1].label).toBe('Traffic Generator');
		expect(components[2].label).toBe('CDN Simulator');
	});

	test('extracts correct URLs', () => {
		const components = parseLabInfrastructure(CATEGORIZED_LLMS_TXT);
		expect(components[0].url).toBe('https://example.com/origin-server/llms.txt');
	});

	test('extracts descriptions', () => {
		const components = parseLabInfrastructure(CATEGORIZED_LLMS_TXT);
		expect(components[0].description).toContain('vulnerable web applications');
	});

	test('returns empty when no Lab Infrastructure section', () => {
		expect(parseLabInfrastructure(FLAT_LLMS_TXT)).toHaveLength(0);
	});

	test('returns empty when Lab Infrastructure section is absent', () => {
		expect(parseLabInfrastructure(EMPTY_LAB_LLMS_TXT)).toHaveLength(0);
	});
});

describe('parseSection', () => {
	test('extracts Product Features section', () => {
		const entries = parseSection(CATEGORIZED_LLMS_TXT, 'Product Features');
		expect(entries).toHaveLength(2);
		expect(entries[0].label).toBe('WAF');
		expect(entries[1].label).toBe('API Security');
	});

	test('returns empty for nonexistent section', () => {
		expect(parseSection(CATEGORIZED_LLMS_TXT, 'Nonexistent')).toHaveLength(0);
	});

	test('does not bleed into next section', () => {
		const labEntries = parseSection(CATEGORIZED_LLMS_TXT, 'Lab Infrastructure');
		const labels = labEntries.map((e) => e.label);
		expect(labels).not.toContain('WAF');
	});
});

describe('hasCategorizedFederation', () => {
	test('returns true for categorized llms.txt', () => {
		expect(hasCategorizedFederation(CATEGORIZED_LLMS_TXT)).toBe(true);
	});

	test('returns false for flat Federated Sites format', () => {
		expect(hasCategorizedFederation(FLAT_LLMS_TXT)).toBe(false);
	});
});
