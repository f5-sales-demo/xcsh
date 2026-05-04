import { describe, expect, it } from "bun:test";
import { formatIssueDetail, formatIssueTable } from "../../src/tools/glab/formatters";
import type { GlabIssue } from "../../src/tools/glab/types";

const makeIssue = (overrides: Partial<GlabIssue> = {}): GlabIssue => ({
	id: 1001,
	iid: 42,
	title: "Login fails on mobile Safari",
	description: "Steps to reproduce:\n1. Open Safari\n2. Click login",
	state: "opened",
	labels: ["xc::auth", "priority::high"],
	assignees: [{ username: "alice", name: "Alice Smith" }],
	author: { username: "bob", name: "Bob Jones" },
	milestone: { title: "Sprint 23", iid: 5 },
	created_at: "2024-12-01T10:00:00Z",
	updated_at: "2024-12-15T14:30:00Z",
	web_url: "https://gitlab.com/group/repo/-/issues/42",
	references: { full: "group/repo#42" },
	issue_type: "issue",
	notes: [],
	...overrides,
});

describe("formatIssueTable", () => {
	it("renders a markdown table header", () => {
		const result = formatIssueTable([makeIssue()]);
		expect(result).toContain("| IID |");
		expect(result).toContain("Title");
		expect(result).toContain("State");
		expect(result).toContain("Labels");
		expect(result).toContain("Assignee");
		expect(result).toContain("Updated");
	});

	it("renders issue data in table row", () => {
		const result = formatIssueTable([makeIssue()]);
		expect(result).toContain("42");
		expect(result).toContain("Login fails on mobile Safari");
		expect(result).toContain("opened");
		expect(result).toContain("@alice");
		expect(result).toContain("2024-12-15");
	});

	it("renders multiple issues as multiple rows", () => {
		const issues = [makeIssue({ iid: 1 }), makeIssue({ iid: 2 }), makeIssue({ iid: 3 })];
		const result = formatIssueTable(issues);
		const rows = result.split("\n").filter(l => l.startsWith("|") && !l.includes("---") && !l.includes("IID"));
		expect(rows).toHaveLength(3);
	});

	it("returns 'No issues found' message for empty array", () => {
		const result = formatIssueTable([]);
		expect(result).toContain("No issues found");
	});

	it("handles issues with no assignees", () => {
		const issue = makeIssue({ assignees: [] });
		const result = formatIssueTable([issue]);
		expect(result).toContain("unassigned");
	});
});

describe("formatIssueDetail", () => {
	it("includes issue title as H1", () => {
		const result = formatIssueDetail(makeIssue());
		expect(result).toContain("# Issue #42: Login fails on mobile Safari");
	});

	it("includes state, author, labels", () => {
		const result = formatIssueDetail(makeIssue());
		expect(result).toContain("opened");
		expect(result).toContain("@bob");
		expect(result).toContain("xc::auth");
		expect(result).toContain("priority::high");
	});

	it("includes description", () => {
		const result = formatIssueDetail(makeIssue());
		expect(result).toContain("Steps to reproduce");
	});

	it("shows 'No comments' when notes is empty", () => {
		const result = formatIssueDetail(makeIssue({ notes: [] }));
		expect(result).toContain("No comments");
	});

	it("renders comments when present", () => {
		const issue = makeIssue({
			notes: [
				{
					id: 1,
					body: "Confirmed on iOS 17.2",
					author: { username: "charlie", name: "Charlie" },
					created_at: "2024-12-02T09:00:00Z",
					updated_at: "2024-12-02T09:00:00Z",
					system: false,
				},
			],
		});
		const result = formatIssueDetail(issue);
		expect(result).toContain("@charlie");
		expect(result).toContain("Confirmed on iOS 17.2");
	});

	it("skips system notes", () => {
		const issue = makeIssue({
			notes: [
				{
					id: 1,
					body: "closed via MR !234",
					author: { username: "gitlab-bot", name: "GitLab Bot" },
					created_at: "2024-12-10T10:00:00Z",
					updated_at: "2024-12-10T10:00:00Z",
					system: true,
				},
			],
		});
		const result = formatIssueDetail(issue);
		expect(result).not.toContain("@gitlab-bot");
	});
});
