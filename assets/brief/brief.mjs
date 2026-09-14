#!/usr/bin/env node
/**
 * Build a role-appropriate Paseo initial prompt from canonical contracts.
 *
 * This command composes prompts only. Provider/model/mode/features and the
 * actual create_agent call remain the orchestrator's responsibility.
 * Node built-ins only; tested on Node >= 18.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONTRACTS_FILE = path.join(ROOT, "references", "briefing-contracts.md");
const CHANNEL_FILE = path.join(ROOT, "references", "channel-operations.md");
const SKILL_FILE = path.join(ROOT, "SKILL.md");

const ROLE_ALIASES = new Map([
  ["lead", "lead"],
  ["worker", "worker"],
  ["linh", "worker"],
  ["reviewer", "reviewer"],
  ["peer", "peer"],
  ["decision-peer", "peer"],
  ["planning-reviewer", "planning-reviewer"],
]);

const OPTION_KEYS = new Map([
  ["workspace-id", "workspaceId"],
  ["parent-agent-id", "parentAgentId"],
  ["owned-files", "ownedFiles"],
  ["non-goals", "nonGoals"],
  ["lens-owns", "lensOwns"],
  ["lens-excludes", "lensExcludes"],
  ["lens-evidence", "lensEvidence"],
  ["channel-id", "channelId"],
  ["channel-dir", "channelDir"],
  ["agent-id", "agentId"],
  ["format", "format"],
]);

const ROLE_CONFIG = {
  lead: {
    core: "lead-core",
    stages: new Map([
      ["init", []],
      ["plan", ["lead-plan"]],
      ["review", ["lead-review"]],
      ["channel", ["channel"]],
    ]),
  },
  worker: { core: "worker-core", stages: new Map([["task", []]]) },
  reviewer: {
    core: "reviewer-core",
    stages: new Map([
      ["review", []],
      ["supervisor", ["supervisor-compliance"]],
    ]),
  },
  peer: { core: "peer-core", stages: new Map([["task", []]]) },
  "planning-reviewer": {
    core: "planning-reviewer-core",
    stages: new Map([["review", []]]),
  },
};

const REQUIRED = {
  base: ["role", "stage", "owner", "task", "workspaceId"],
  lead: ["persona"],
  worker: ["persona", "parentAgentId", "goal", "ownedFiles", "nonGoals", "acceptance", "checks", "handback"],
  reviewer: ["parentAgentId", "candidate", "lensOwns", "lensExcludes", "lensEvidence", "acceptance", "checks"],
  peer: ["parentAgentId", "persona"],
  "planning-reviewer": ["parentAgentId", "persona"],
};

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = { format: "text" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (!argument.startsWith("--")) fail(`unexpected argument: ${argument}`);
    const rawKey = argument.slice(2);
    const key = OPTION_KEYS.get(rawKey) || rawKey;
    if (key === "help") {
      options.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`missing value for --${rawKey}`);
    options[key] = value;
    index += 1;
  }
  return options;
}

function usage() {
  return `Usage:
  node assets/brief/brief.mjs --role lead --stage init --persona <persona> --owner <scope> --task <task> --workspace-id <workspaceId> [--parent-agent-id <generalLeadId>]
  node assets/brief/brief.mjs --role worker --stage task --persona <warrior> --owner <scope> --task <task> --workspace-id <workspaceId> --parent-agent-id <leadId> --goal <goal> --owned-files <files> --non-goals <non-goals> --acceptance <acceptance> --checks <checks> --handback <format>
  node assets/brief/brief.mjs --role reviewer --stage <review|supervisor> --persona <label> --owner <scope> --task <task> --workspace-id <workspaceId> --parent-agent-id <leadId> --candidate <identity> --lens-owns <question> --lens-excludes <out-of-scope> --lens-evidence <evidence> --acceptance <acceptance> --checks <checks>

  Roles: lead, worker/linh, reviewer, peer/decision-peer, planning-reviewer.
  Every brief includes the selected role and the paseo-team SKILL.md path.
  Stages: lead init|plan|review|channel; worker task; reviewer review|supervisor; peer task; planning-reviewer review.
Output is text by default; use --format json to return { role, stage, initialPrompt }.`;
}

function extractBlocks(markdown) {
  const blocks = new Map();
  const pattern = /<!--\s*brief:([a-z0-9-]+)\s*-->\s*\n\s*```(?:text)?\s*\n([\s\S]*?)\n\s*```/gi;
  for (const match of markdown.matchAll(pattern)) blocks.set(match[1].toLowerCase(), match[2].trim());
  return blocks;
}

function loadBlocks() {
  const blocks = extractBlocks(fs.readFileSync(CONTRACTS_FILE, "utf8"));
  const channelBlocks = extractBlocks(fs.readFileSync(CHANNEL_FILE, "utf8"));
  for (const [id, block] of channelBlocks) blocks.set(id, block);
  return blocks;
}

function normalizeRole(value) {
  const role = ROLE_ALIASES.get(String(value || "").toLowerCase());
  if (!role) fail(`unsupported --role: ${value || "(missing)"}`);
  return role;
}

function requireFields(options, role) {
  const missing = [...REQUIRED.base, ...(REQUIRED[role] || [])].filter((key) => !options[key]);
  if (missing.length) fail(`missing required fields: ${missing.join(", ")}`);
}

function replacePlaceholders(template, values) {
  const missing = new Set();
  const rendered = template.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (_match, key) => {
    if (!values[key]) {
      missing.add(key);
      return `{{${key}}}`;
    }
    return values[key];
  });
  if (missing.size) fail(`unresolved placeholders: ${[...missing].join(", ")}`);
  return rendered;
}

function packetText(options) {
  return [
    "PACKET",
    `Goal: ${options.goal}`,
    `Owned files/subtask: ${options.ownedFiles}`,
    `Non-goals: ${options.nonGoals}`,
    `Acceptance + evidence: ${options.acceptance}`,
    `Checks/commands: ${options.checks}`,
    `Handback: ${options.handback}`,
    `Parent: ${options.parentAgentId}`,
  ].join("\n");
}

function reviewPacketText(options) {
  return [
    "REVIEW PACKET",
    `Task: ${options.task}`,
    `Acceptance + evidence: ${options.acceptance}`,
    `Checks/artifacts: ${options.checks}`,
    `Candidate identity: ${options.candidate}`,
    `Parent: ${options.parentAgentId}`,
  ].join("\n");
}

function supervisorPacketText(options) {
  return [
    "SUPERVISOR AUDIT PACKET",
    `Audit: ${options.task}`,
    `Acceptance: ${options.acceptance}`,
    `Checks/artifacts: ${options.checks}`,
    `Frozen raw packet identity: ${options.candidate}`,
    `Parent: ${options.parentAgentId}`,
  ].join("\n");
}

function buildBrief(rawOptions) {
  const role = normalizeRole(rawOptions.role);
  const options = { format: "text", ...rawOptions, role };
  const config = ROLE_CONFIG[role];
  if (!config) fail(`no configuration for role: ${role}`);
  const stage = String(options.stage || "").toLowerCase();
  if (!config.stages.has(stage)) fail(`unsupported stage '${stage}' for role '${role}'`);
  options.stage = stage;
  if ((role === "reviewer" || role === "peer" || role === "planning-reviewer") && !options.persona) {
    options.persona = role === "reviewer" ? "Independent reviewer" : role === "peer" ? "Independent Decision Peer" : "Planning Reviewer";
  }
  requireFields(options, role);
  if (stage === "channel") {
    const missingChannel = ["channelId", "channelDir", "agentId"].filter((key) => !options[key]);
    if (missingChannel.length) fail(`missing required fields: ${missingChannel.join(", ")}`);
  }

  const blocks = loadBlocks();
    const ids = [
      "paseo-team-context",
      ...(role === "lead" && stage === "init" ? ["role-routing"] : []),
      role === "reviewer" && stage === "supervisor" ? "supervisor-reviewer-core" : config.core,
      ...config.stages.get(stage),
    ];
  const values = {
    persona: options.persona,
    owner: options.owner,
    task: options.task,
    workspaceId: options.workspaceId,
    parentAgentId: options.parentAgentId || "none",
    candidate: options.candidate || "not applicable",
    lensOwns: options.lensOwns || "not applicable",
    lensExcludes: options.lensExcludes || "not applicable",
    lensEvidence: options.lensEvidence || "not applicable",
      reviewOutput: role === "reviewer" && stage === "supervisor"
      ? "CAP <=350 words: `VERDICT: CLEAR|VIOLATION|INSUFFICIENT_EVIDENCE`; <=5 findings as `criterion | event/time | evidence | required action`; <=3 attention gaps. No recap."
      : "CAP <=500 words: `VERDICT: CLEAR|CHANGES_REQUIRED|BLOCKED`; <=6 findings ordered BLOCKER -> REQUIRED -> NIT -> FUTURE, each `severity | file:line | evidence | required action`; <=3 uncertainty bullets. Never omit BLOCKER/REQUIRED: group common root causes and drop NIT/FUTURE first. No recap.",
    packet: role === "worker" ? packetText(options) : "not applicable",
      reviewPacket: role === "reviewer"
        ? (stage === "supervisor" ? supervisorPacketText(options) : reviewPacketText(options))
        : "not applicable",
    channelId: options.channelId || "not applicable",
    channelDir: options.channelDir || "not applicable",
    agentId: options.agentId || "not applicable",
    role,
    skillPath: SKILL_FILE,
  };
  const missingBlocks = ids.filter((id) => !blocks.has(id));
  if (missingBlocks.length) fail(`canonical contract block(s) missing: ${missingBlocks.join(", ")}`);
  const initialPrompt = ids.map((id) => replacePlaceholders(blocks.get(id), values)).join("\n\n");
  const result = { role, stage, initialPrompt };
  if (options.format === "json") return JSON.stringify(result, null, 2);
  if (options.format !== "text") fail(`unsupported --format: ${options.format}`);
  return initialPrompt;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || process.argv.length === 2) {
    console.log(usage());
    return;
  }
  console.log(buildBrief(options));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(`brief: ${error.message}`);
    process.exitCode = 2;
  }
}

export { buildBrief, extractBlocks, parseArgs };
