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
  assert.match(lead, /Delegation is the default/);
  assert.match(lead, /direct implementation is valid/);
  assert.match(lead, /Specialist Lead/);
  assert.match(lead, /Parent Lead: none/);
  assert.match(lead, /YOU MUST NEVER self-review/);
assert.doesNotMatch(lead, /You may implement directly/);
assert.doesNotMatch(lead, /PLAN ADDENDUM|REVIEW ADDENDUM/);
assert.doesNotMatch(lead, /Acceptance \+ evidence|Checks\/commands|PACKET/);
assert.doesNotMatch(lead, /Read and follow this skill/);
assert.match(lead, /CAP: PLAN_DRAFT\/PLAN_FINAL <=600 words/);
assert.match(lead, /ROLE ROUTING: General Lead owns the outcome and boundary and runs the Lead Delegation Gate/);
assert.match(lead, /Specialist Lead handles open plan\/architecture or multi-worker domain coordination/);
assert.match(lead, /Open planning -> one Planning Lead/);
assert.match(lead, />=2 domains\/streams/);
assert.match(lead, /Review a logical candidate, not each Worker by default/);
assert.match(lead, /LEAD DELEGATION: Run the gate before fan-out/);
assert.match(lead, /Normal Leads work\/delegate\/review in-slice but never create Leads/);
assert.match(lead, /One specified packet -> Worker/);
assert.match(lead, /otherwise General Lead direct/);
assert.match(lead, /PASEO PREREQUISITE:/);
assert.match(lead, /read the full `\/paseo` skill/);
assert.match(lead, /call `list_profiles`/);
assert.match(lead, /`provider\/model`/);
assert.ok(lead.length <= 2600, `lead prompt too large: ${lead.length} chars`);

const leadPlan = buildBrief({
  role: "lead", stage: "plan", persona: "Chu Du", owner: "FEAT-015",
  task: "coordinate settings work", workspaceId: "wks-test",
});
const leadReview = buildBrief({
  role: "lead", stage: "review", persona: "Chu Du", owner: "FEAT-015",
  task: "coordinate settings work", workspaceId: "wks-test",
});
  assert.ok(leadPlan.length <= 2400, `lead plan prompt too large: ${leadPlan.length} chars`);
  assert.ok(leadReview.length <= 2450, `lead review prompt too large: ${leadReview.length} chars`);

  const specialistLead = buildBrief({
    role: "lead", stage: "init", persona: "Gia Cat Luong", owner: "FEAT-015/settings",
    task: "own the bounded settings slice under General Lead lead-1",
    workspaceId: "wks-test", parentAgentId: "lead-1",
  });
  assert.match(specialistLead, /Specialist Lead/);
  assert.match(specialistLead, /Parent Lead: lead-1/);
  assert.match(specialistLead, /Normal Leads work\/delegate\/review in-slice but never create Leads/);
  assert.match(specialistLead, /no child creates a Lead/);
  assert.doesNotMatch(specialistLead, /Parent Lead: none/);

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
assert.match(worker, /Task: implement settings toggle/);
assert.match(worker, /TASK_TEACH_BACK/);
assert.match(worker, /PROCEED immediately/);
assert.match(worker, /Owned files\/subtask: docs\/prototype\/screens\/settings\.html/);
assert.match(worker, /Acceptance \+ evidence: toggle is visible/);
  assert.match(worker, /at most 4 lines/);
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
  assert.match(reviewer, /Never edit files or spawn agents/);
  assert.doesNotMatch(reviewer, /bounded edit/i);
assert.doesNotMatch(reviewer, /Supervisor Compliance|exactly two fresh, blind/i);
assert.ok(reviewer.length <= 1600, `reviewer prompt too large: ${reviewer.length} chars`);

const supervisorReviewer = buildBrief({
  role: "reviewer",
  stage: "supervisor",
  owner: "supervisor cv-1",
  task: "audit supervisor attention compliance",
  workspaceId: "wks-test",
  parentAgentId: "lead-1",
  candidate: "activity-sha256:abc",
  lensOwns: "supervisor compliance",
  lensExcludes: "technical correctness",
  lensEvidence: "frozen raw transcript, channel and watchdog records",
  acceptance: "two independent CLEAR verdicts",
  checks: "inspect exact activity identity",
});
assert.match(supervisorReviewer, /one of exactly two blind reviewers/);
assert.match(supervisorReviewer, /ROLE_BOUNDARY, EVENT_FIRST, ATTENTION_COVERAGE/);
assert.match(supervisorReviewer, /CLEAR\|VIOLATION\|INSUFFICIENT_EVIDENCE/);
assert.doesNotMatch(supervisorReviewer, /technical candidate|raw diff|raw artifacts|implementer's verdict/i);
assert.match(supervisorReviewer, /Frozen raw packet identity: activity-sha256:abc/);
assert.ok(supervisorReviewer.length <= 2350, `supervisor reviewer prompt too large: ${supervisorReviewer.length} chars`);

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
assert.match(planningReviewer, /Planning Reviewer for FEAT-015 in workspace wks-test/);
assert.match(planningReviewer, /Task: challenge settings plan/);
assert.match(planningReviewer, /Parent: lead-1\./);
assert.ok(planningReviewer.length <= 1100, `planning reviewer prompt too large: ${planningReviewer.length} chars`);

const peer = buildBrief({
  role: "peer",
  stage: "task",
  persona: "Decision Peer",
  owner: "FEAT-015 decision",
  task: "challenge the settings rollout",
  workspaceId: "wks-test",
  parentAgentId: "lead-1",
});
assert.match(peer, /Own only the frozen question FEAT-015 decision in workspace wks-test/);
assert.match(peer, /Task: challenge the settings rollout/);
assert.match(peer, /Parent: lead-1\./);
assert.ok(peer.length <= 900, `peer prompt too large: ${peer.length} chars`);

// Regression for the owner/task/workspace-id/parent-agent-id field drop: the fixed
// role/stage pairs must render their base fields, and every other pair must keep
// rendering with unchanged field semantics. reviewer/supervisor has no {{owner}}
// placeholder in its canonical block: pre-existing, outside this fix, encoded as a
// known gap (its fields list omits owner).
const BASE_MARKERS = {
  owner: /OWNER_MARKER/,
  task: /TASK_MARKER/,
  workspaceId: /WS_MARKER/,
  parentAgentId: /PARENT_MARKER/,
};
const fieldCases = [
  { role: "lead", stage: "init", fields: ["owner", "task", "workspaceId"] },
  { role: "lead", stage: "plan", fields: ["owner", "task", "workspaceId"] },
  { role: "lead", stage: "review", fields: ["owner", "task", "workspaceId"] },
  {
    role: "lead",
    stage: "channel",
    fields: ["owner", "task", "workspaceId"],
    extra: { channelId: "channel-1", channelDir: "/tmp/channel-1", agentId: "lead-1" },
  },
  {
    role: "worker",
    stage: "task",
    fields: ["owner", "task", "workspaceId"],
    extra: {
      parentAgentId: "parent-marker",
      goal: "goal",
      ownedFiles: "files",
      nonGoals: "non-goals",
      acceptance: "acceptance",
      checks: "checks",
      handback: "handback",
    },
  },
  {
    role: "reviewer",
    stage: "review",
    fields: ["owner", "task", "workspaceId"],
    extra: {
      parentAgentId: "parent-marker",
      candidate: "candidate",
      lensOwns: "lens",
      lensExcludes: "excluded",
      lensEvidence: "evidence",
      acceptance: "acceptance",
      checks: "checks",
    },
  },
  {
    role: "reviewer",
    stage: "supervisor",
    fields: ["task", "workspaceId"],
    extra: {
      parentAgentId: "parent-marker",
      candidate: "candidate",
      lensOwns: "lens",
      lensExcludes: "excluded",
      lensEvidence: "evidence",
      acceptance: "acceptance",
      checks: "checks",
    },
  },
  { role: "peer", stage: "task", fields: ["owner", "task", "workspaceId", "parentAgentId"], extra: { parentAgentId: "PARENT_MARKER" } },
  { role: "planning-reviewer", stage: "review", fields: ["owner", "task", "workspaceId", "parentAgentId"], extra: { parentAgentId: "PARENT_MARKER" } },
];
for (const { role, stage, extra = {}, fields } of fieldCases) {
  const prompt = buildBrief({
    role,
    stage,
    persona: "Marker Persona",
    owner: "OWNER_MARKER",
    task: "TASK_MARKER",
    workspaceId: "WS_MARKER",
    ...extra,
  });
  assert.doesNotMatch(prompt, /\{\{[a-zA-Z0-9_-]+\}\}/, `${role}/${stage} leaves an unresolved placeholder`);
  for (const field of fields) {
    const option = { workspaceId: "workspace-id", parentAgentId: "parent-agent-id" }[field] || field;
    assert.match(prompt, BASE_MARKERS[field], `${role}/${stage} drops --${option}`);
  }
}

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
assert.match(channel, /[Cc]hannel channel-1/);
assert.match(channel, /Read rules\.md once/);
assert.match(channel, /sync \/tmp\/channel-1 lead-1/);
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
