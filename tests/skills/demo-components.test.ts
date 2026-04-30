import { describe, expect, test } from 'bun:test';

const DEMO_RESOURCES_LLMS_TXT = `# Demo Resources

> Catalog of pre-configured Azure VM components for F5 Distributed
> Cloud demo environments.

## Documentation Sets

- [Component Catalog](https://example.com/demo-resources/_llms-txt/component-catalog.txt): Architecture profiles for all deployable demo components
- [Full Documentation](https://example.com/demo-resources/llms-full.txt): the full documentation for Demo Resources

## Sections

- [Overview](https://example.com/demo-resources/01-overview/): What demo resources are, how to select components
- [Origin Server](https://example.com/demo-resources/origin-server/): Ubuntu 24.04 VM with nginx and 9 vulnerable apps
- [Traffic Generator](https://example.com/demo-resources/traffic-generator/): Azure VM with 50+ security tools
- [CDN Simulator](https://example.com/demo-resources/cdn-simulator/): NGINX-based CDN edge node simulator

## Federated Sites

- [Origin Server](https://example.com/origin-server/llms.txt): Ubuntu 24.04 origin server with vulnerable web applications
- [Traffic Generator](https://example.com/traffic-generator/llms.txt): Azure VM with 50+ security tools and attack suites
- [CDN Simulator](https://example.com/cdn-simulator/llms.txt): NGINX-based CDN edge node simulator

## Notes

- Content is auto-generated from official docs
`;

const PORTAL_LLMS_TXT = `# F5 Distributed Cloud Sales Demos

## Lab Infrastructure
Deployable Azure VM components for demo environments.

- [Demo Resources](https://example.com/demo-resources/llms.txt): Catalog of pre-configured Azure VM components
- [Origin Server](https://example.com/origin-server/llms.txt): Ubuntu 24.04 origin server
- [Traffic Generator](https://example.com/traffic-generator/llms.txt): Azure VM with 50+ security tools
- [CDN Simulator](https://example.com/cdn-simulator/llms.txt): NGINX-based CDN edge node simulator

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

function parseFederatedSites(llmsTxt: string): SiteEntry[] {
	return parseSection(llmsTxt, 'Federated Sites');
}

function parseSections(llmsTxt: string): SiteEntry[] {
	return parseSection(llmsTxt, 'Sections');
}

describe('demo-resources llms.txt parsing', () => {
	test('extracts federated sites from demo-resources', () => {
		const sites = parseFederatedSites(DEMO_RESOURCES_LLMS_TXT);
		expect(sites).toHaveLength(3);
		expect(sites[0].label).toBe('Origin Server');
		expect(sites[1].label).toBe('Traffic Generator');
		expect(sites[2].label).toBe('CDN Simulator');
	});

	test('extracts section entries from demo-resources', () => {
		const sections = parseSections(DEMO_RESOURCES_LLMS_TXT);
		expect(sections).toHaveLength(4);
		expect(sections[0].label).toBe('Overview');
		expect(sections[1].label).toBe('Origin Server');
	});

	test('extracts federated site URLs for Layer 3 fetching', () => {
		const sites = parseFederatedSites(DEMO_RESOURCES_LLMS_TXT);
		expect(sites[0].url).toBe('https://example.com/origin-server/llms.txt');
		expect(sites[1].url).toBe('https://example.com/traffic-generator/llms.txt');
	});

	test('extracts descriptions from federated sites', () => {
		const sites = parseFederatedSites(DEMO_RESOURCES_LLMS_TXT);
		expect(sites[0].description).toContain('vulnerable web applications');
	});
});

describe('portal llms.txt with demo-resources entry', () => {
	test('finds demo-resources in Lab Infrastructure', () => {
		const entries = parseSection(PORTAL_LLMS_TXT, 'Lab Infrastructure');
		expect(entries).toHaveLength(4);
		expect(entries[0].label).toBe('Demo Resources');
	});

	test('demo-resources URL is correct', () => {
		const entries = parseSection(PORTAL_LLMS_TXT, 'Lab Infrastructure');
		const dr = entries.find((e) => e.label === 'Demo Resources');
		expect(dr).toBeDefined();
		expect(dr?.url).toBe('https://example.com/demo-resources/llms.txt');
	});

	test('Lab Infrastructure does not contain Product Features', () => {
		const lab = parseSection(PORTAL_LLMS_TXT, 'Lab Infrastructure');
		const prod = parseSection(PORTAL_LLMS_TXT, 'Product Features');
		expect(lab.map((e) => e.label)).not.toContain('WAF');
		expect(prod.map((e) => e.label)).not.toContain('Origin Server');
	});
});

describe('parseSection edge cases', () => {
	test('returns empty for nonexistent section', () => {
		expect(parseSection(DEMO_RESOURCES_LLMS_TXT, 'Nonexistent')).toHaveLength(0);
	});
});
