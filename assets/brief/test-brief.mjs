#!/usr/bin/env node
/** Deterministic tests for brief.mjs; no agent or workspace is created. */
import assert from "node:assert/strict";
import { buildBrief, extractBlocks } from "./brief.mjs";

const lead = buildBrief({
  role: "lead",
  stage: "init",
  persona: "Chu Du",
  owner: "FEAT-015",
  task: "coordinate settings work",
  workspaceId: "wks-test",
});
assert.match(lead, /Canonical fallback \(ambiguity only\): .*\/SKILL\.md/);
assert.match(lead, /Role: lead/);
assert.match(lead, /a Lead/);
assert.match(lead, /[Oo]wn FEAT-015/);
assert.match(lead, /Task: coordinate settings work/);
assert.match(lead, /PREPLAN:/);
assert.match(lead, /YOU MUST NEVER self-review/);
assert.doesNotMatch(lead, /You may implement directly/);
assert.doesNotMatch(lead, /PLAN ADDENDUM|REVIEW ADDENDUM/);
assert.doesNotMatch(lead, /Acceptance \+ evidence|Checks\/commands|PACKET/);
assert.doesNotMatch(lead, /Read and follow this skill/);
assert.match(lead, /CAP: PLAN_DRAFT\/PLAN_FINAL <=600 words/);
assert.ok(lead.length <= 1600, `lead prompt too large: ${lead.length} chars`);

const leadPlan = buildBrief({
  role: "lead", stage: "plan", persona: "Chu Du", owner: "FEAT-015",
  task: "coordinate settings work", workspaceId: "wks-test",
});
const leadReview = buildBrief({
  role: "lead", stage: "review", persona: "Chu Du", owner: "FEAT-015",
  task: "coordinate settings work", workspaceId: "wks-test",
});
assert.ok(leadPlan.length <= 1800, `lead plan prompt too large: ${leadPlan.length} chars`);
assert.ok(leadReview.length <= 1950, `lead review prompt too large: ${leadReview.length} chars`);

const worker = buildBrief({
  role: "worker",
  stage: "task",
  persona: "Triệu Vân",
  owner: "FEAT-015/settings",
  task: "implement settings toggle",
  workspaceId: "wks-test",
  parentAgentId: "lead-1",
  goal: "add the toggle",
  ownedFiles: "docs/prototype/screens/settings.html",
  nonGoals: "no navigation changes",
  acceptance: "toggle is visible and keyboard usable",
  checks: "node --check and focused UI check",
  handback: "files, candidate identity, results, deviations",
});
assert.match(worker, /Role: worker/);
assert.match(worker, /TASK_TEACH_BACK/);
assert.match(worker, /PROCEED immediately/);
assert.match(worker, /Owned files\/subtask: docs\/prototype\/screens\/settings\.html/);
assert.match(worker, /Acceptance \+ evidence: toggle is visible/);
assert.match(worker, /at most 8 lines/);
assert.ok(worker.length <= 1600, `worker prompt too large: ${worker.length} chars`);

const reviewer = buildBrief({
  role: "reviewer",
  stage: "review",
  owner: "FEAT-015",
  task: "review settings",
  workspaceId: "wks-test",
  parentAgentId: "lead-1",
  candidate: "diff-1",
  lensOwns: "correctness",
  lensExcludes: "architecture",
  lensEvidence: "diff and focused check output",
  acceptance: "toggle is visible and keyboard usable",
  checks: "focused UI check",
});
assert.match(reviewer, /Role: reviewer/);
assert.match(reviewer, /Own only this lens: correctness/);
assert.match(reviewer, /Candidate identity: diff-1/);
assert.match(reviewer, /VERDICT: CLEAR\|CHANGES_REQUIRED\|BLOCKED/);
assert.match(reviewer, /Do not receive the implementer's verdict/);
assert.ok(reviewer.length <= 1600, `reviewer prompt too large: ${reviewer.length} chars`);

const planningReviewer = buildBrief({
  role: "planning-reviewer",
  stage: "review",
  owner: "FEAT-015",
  task: "challenge settings plan",
  workspaceId: "wks-test",
  parentAgentId: "lead-1",
  persona: "Planning Reviewer",
});
assert.match(planningReviewer, /no more than three decision-changing CHALLENGE questions/);
assert.ok(planningReviewer.length <= 1100, `planning reviewer prompt too large: ${planningReviewer.length} chars`);

const channel = buildBrief({
  role: "lead",
  stage: "channel",
  persona: "Chu Du",
  owner: "FEAT-015",
  task: "coordinate settings work",
  workspaceId: "wks-test",
  channelId: "channel-1",
  channelDir: "/tmp/channel-1",
  agentId: "lead-1",
});
assert.match(channel, /channel channel-1/);
assert.match(channel, /\/tmp\/channel-1\/rules\.md/);
assert.doesNotMatch(channel, /\{\{[a-zA-Z0-9_-]+\}\}/);
assert.ok(channel.length <= 2700, `lead channel prompt too large: ${channel.length} chars`);
assert.throws(() => buildBrief({
  role: "lead",
  stage: "channel",
  persona: "Chu Du",
  owner: "FEAT-015",
  task: "coordinate settings work",
  workspaceId: "wks-test",
  agentId: "lead-1",
}), /channelId, channelDir/);

assert.throws(() => buildBrief({
  role: "reviewer",
  stage: "review",
  owner: "FEAT-015",
  task: "review settings",
  workspaceId: "wks-test",
  parentAgentId: "lead-1",
  candidate: "diff-1",
  lensOwns: "correctness",
  lensExcludes: "architecture",
  // lensEvidence, acceptance, and checks intentionally omitted.
}), /missing required fields/);

const blocks = extractBlocks("<!-- brief:test -->\n```text\nHello {{name}}\n```");
assert.equal(blocks.get("test"), "Hello {{name}}");

console.log("test-brief.mjs: passed");
