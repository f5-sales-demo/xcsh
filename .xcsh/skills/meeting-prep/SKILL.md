---
name: meeting-prep
description: Customer meeting preparation workflow for SEs. Generates pre-call briefs with account intelligence, stakeholder mapping, discovery questions, and agenda templates. Use when the user mentions meeting prep, pre-call planning, customer calls, or discovery sessions.
---

# Customer Meeting Preparation

You are helping a sales engineer prepare for a customer meeting. The goal is
a structured pre-call brief that makes the SE more effective in the conversation.

## Pre-Call Brief Structure

Generate these sections in order. Pull data from available sources (Salesforce, account history, product docs) before asking the user to fill gaps.

### 1. Account Intelligence

Gather from Salesforce (`xcsh://salesforce`, `sf_query`):
- Account name, industry, annual revenue, account type
- Open pipeline: deal names, stages, amounts, close dates
- Recent activity: last touch dates, recent stage changes
- Account team: AE, SE, CSM, leadership sponsor
- Historical context: closed-won deals, lost deals, previous products

### 2. Stakeholder Mapping

For each known attendee:
- Name, title, role in the decision process
- MEDDPICC role: Economic Buyer, Champion, Technical Evaluator, Blocker
- Known priorities and pain points
- Previous interactions and positions taken
- Communication style notes (technical depth, business focus)

If attendee information is incomplete, list what is known and flag gaps.

### 3. Meeting Objectives

Help the SE define:
- **Primary objective**: The one thing that must happen for this meeting to succeed
- **Secondary objectives**: 2-3 additional outcomes to pursue if primary is achieved
- **Minimum acceptable outcome**: What makes the meeting not a waste of time
- **Risks**: What could go wrong, and how to handle it

### 4. Technical Discovery Questions

Tailor to the deal stage and product area. Organized by MEDDPICC element:

**Identifying Pain:**
- What business problem are you trying to solve?
- What is the cost of the current state? (quantify if possible)
- What has changed that makes this a priority now?
- Who else is affected by this problem?

**Metrics:**
- How will you measure success?
- What KPIs does your leadership track for this area?
- What would a 6-month post-deployment review look like?

**Decision Criteria:**
- What are the must-have requirements vs nice-to-haves?
- Are there technical standards or compliance requirements?
- What does your evaluation process look like?

**Decision Process:**
- Who needs to approve this purchase?
- What is the timeline for a decision?
- Are there budget cycles or fiscal deadlines?

**Competition:**
- Who else are you evaluating?
- What do you like about the alternatives?
- Have you worked with any of these vendors before?

### 5. Agenda Template

Adapt based on meeting type:

**Discovery Call (30-60 min):**
1. Introductions and meeting objectives (5 min)
2. Customer environment overview (10 min)
3. Pain point deep-dive (15 min)
4. F5 XC capability alignment (10 min)
5. Next steps and action items (5 min)

**Technical Deep Dive (60-90 min):**
1. Recap of previous discussions (5 min)
2. Architecture review (15 min)
3. Product demonstration (30 min)
4. Technical Q&A (15 min)
5. POC/POV planning (10 min)
6. Next steps (5 min)

**Executive Briefing (30 min):**
1. Business context and pain statement (5 min)
2. Solution value proposition (10 min)
3. Proof points and references (5 min)
4. Investment and timeline (5 min)
5. Next steps (5 min)

### 6. Competitive Preparation

If competitors are in the deal:
- Review competitive positioning using the `competitive` skill
- Prepare 2-3 differentiation talking points specific to this deal
- Anticipate competitor objections and prepare responses
- Identify where to NOT engage competitively (pick your battles)

### 7. Follow-Up Plan

Before the meeting ends, prepare:
- Action items with owners and dates
- Follow-up email template with meeting summary
- Next meeting agenda sketch
- Internal debrief notes template (what went well, what to improve)

## Data Sources

| Source | What to Pull | Tool |
|---|---|---|
| Salesforce | Account data, pipeline, contacts | `sf_query` |
| User profile | SE identity, territory | `xcsh://user` |
| Product docs | Current capabilities for positioning | llms.txt hierarchy |
| Competitive skill | Competitor positioning | `skill://competitive` |
| Account history | Past interactions, closed deals | `sf_query` with historical templates |
