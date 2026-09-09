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
assert.match(lead, /Skill: .*\/SKILL\.md/);
assert.match(lead, /Role: lead/);
assert.match(lead, /a Lead/);
assert.match(lead, /Owner|own FEAT-015/);
  assert.match(lead, /Task: coordinate settings work/);
  assert.match(lead, /Pre-implementation plan gate/);
  assert.match(lead, /YOU MUST NEVER self-review/);
  assert.doesNotMatch(lead, /You may implement directly/);
  assert.doesNotMatch(lead, /PLAN ADDENDUM|REVIEW ADDENDUM/);
  assert.doesNotMatch(lead, /Acceptance \+ evidence|Checks\/commands|PACKET/);

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

  console.log("test-brief.mjs: 20 passed, 0 failed");
