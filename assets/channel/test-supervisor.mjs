#!/usr/bin/env node
/**
 * Deterministic tests for supervisor.mjs. No Paseo agent or LLM is created.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReminderPrompt, planReminders, runSupervisor } from "./supervisor.mjs";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "team-supervisor-test-"));
const CHANNEL_DIR = path.join(TMP, "channel");
const AGENTS_FILE = path.join(TMP, "agents.json");
const FAKE_PASEO = path.join(TMP, "fake-paseo.mjs");
const SEND_LOG = path.join(TMP, "send.log");
const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const old = (minutes) => new Date(NOW - minutes * 60_000).toISOString();

fs.mkdirSync(path.join(CHANNEL_DIR, "messages"), { recursive: true });
fs.mkdirSync(path.join(CHANNEL_DIR, "receipts"), { recursive: true });
fs.mkdirSync(path.join(CHANNEL_DIR, "supervisor"), { recursive: true });

const members = [
  { agentId: "sup", role: "supervisor" },
  { agentId: "lead", role: "lead" },
  { agentId: "peer", role: "peer", parent: "lead" },
  { agentId: "reviewer", role: "reviewer", parent: "lead" },
  { agentId: "done", role: "peer", parent: "lead" },
];
const channel = { channelId: "watchdog-test", state: "open", createdBy: "sup", members };
const messages = [
  {
    id: "m-lead",
    ts: old(60),
    channelId: channel.channelId,
    threadId: "t-lead",
    replyTo: null,
    from: "sup",
    fromRole: "supervisor",
    to: ["lead"],
    kind: "question",
    body: "Lead status?",
  },
  {
    id: "m-peer",
    ts: old(45),
    channelId: channel.channelId,
    threadId: "t-peer",
    replyTo: null,
    from: "lead",
    fromRole: "lead",
    to: ["peer"],
    kind: "question",
    body: "Peer status?",
  },
  {
    id: "m-reviewer",
    ts: old(2),
    channelId: channel.channelId,
    threadId: "t-reviewer",
    replyTo: null,
    from: "lead",
    fromRole: "lead",
    to: ["reviewer"],
    kind: "question",
    body: "Fresh reviewer evidence?",
  },
  {
    id: "m-done",
    ts: old(60),
    channelId: channel.channelId,
    threadId: "t-done",
    replyTo: null,
    from: "lead",
    fromRole: "lead",
    to: ["done"],
    kind: "question",
    body: "Done status?",
  },
];
fs.writeFileSync(path.join(CHANNEL_DIR, "channel.json"), JSON.stringify(channel, null, 2));
for (const message of messages) {
  fs.writeFileSync(path.join(CHANNEL_DIR, "messages", `${message.id}.json`), JSON.stringify(message, null, 2));
}
// The peer has seen its question but has not answered it: read and open are distinct.
fs.writeFileSync(
  path.join(CHANNEL_DIR, "receipts", "peer.json"),
  JSON.stringify({ version: 1, agentId: "peer", readAt: { "m-peer": old(40) } }, null, 2),
);
fs.writeFileSync(
  AGENTS_FILE,
  JSON.stringify([
    { id: "sup", status: "idle" },
    { id: "lead", status: "running" },
    { id: "peer", status: "idle" },
    { id: "reviewer", status: "running" },
    { id: "done", status: "completed" },
  ], null, 2),
);
fs.writeFileSync(
  FAKE_PASEO,
  `#!/usr/bin/env node\nimport fs from "node:fs";\nfs.appendFileSync(process.env.SEND_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");\nconsole.log(JSON.stringify({ accepted: true }));\n`,
);
fs.chmodSync(FAKE_PASEO, 0o755);

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const agents = JSON.parse(fs.readFileSync(AGENTS_FILE, "utf8"));
const initial = planReminders({
  channel: { ...channel, _dir: CHANNEL_DIR },
  messages,
  agents,
  channelDir: CHANNEL_DIR,
  state: { version: 1, agents: {} },
  nowMs: NOW,
  overdueMs: 10 * 60_000,
  cooldownMs: 15 * 60_000,
  maxReminders: 3,
});
check("running overdue lead is deferred without interrupt", initial.deferred.some((x) => x.agentId === "lead" && x.reason === "running-no-interrupt"));
check("idle peer is reminded even after read but before answer", initial.actions.some((x) => x.agentId === "peer" && x.mode === "wake-idle"));
check("running fresh reviewer is deferred", initial.deferred.some((x) => x.agentId === "reviewer" && x.reason === "running-no-interrupt"));
check("completed agent is not reminded", initial.skipped.some((x) => x.agentId === "done" && x.reason === "status-completed"));
check("prompt contains unread wording and read receipt instruction", /tin nhắn chưa đọc/.test(buildReminderPrompt({
  channelDir: CHANNEL_DIR,
  unreadCount: 2,
  openCount: 3,
  overdueCount: 1,
}) ) && /channel\.mjs read/.test(buildReminderPrompt({
  channelDir: CHANNEL_DIR,
  unreadCount: 2,
  openCount: 3,
  overdueCount: 1,
})));

const previousEnv = process.env.SEND_LOG;
process.env.SEND_LOG = SEND_LOG;
const runOptions = {
  channelDir: CHANNEL_DIR,
  agentsFile: AGENTS_FILE,
  paseoBin: FAKE_PASEO,
  nowMs: NOW,
  overdueMs: 10 * 60_000,
  cooldownMs: 15 * 60_000,
  maxReminders: 3,
  dryRun: false,
};
const sent = runSupervisor(runOptions);
check("real supervisor run succeeds with fake Paseo", sent.ok === true);
check("only idle peer reminder was sent", sent.actions.length === 1 && sent.actions.every((x) => x.sent === true && x.agentId === "peer"));
check("send command was not used to interrupt running lead", fs.readFileSync(SEND_LOG, "utf8").trim().split("\n").length === 1);
check("reminder state is durable", fs.existsSync(path.join(CHANNEL_DIR, "supervisor", "reminders.json")));

const again = runSupervisor(runOptions);
check("cooldown suppresses duplicate reminders", again.actions.length === 0 && again.skipped.filter((x) => x.reason === "cooldown").length === 1);

// Mission/heartbeat evidence is deliberately conservative: compact markers are
// observations, not an authoritative counter or an auto-kill command.
const ACTIVITY_FILE = path.join(TMP, "activity.json");
fs.writeFileSync(
  path.join(CHANNEL_DIR, "mission.json"),
  JSON.stringify({
    schemaVersion: 1,
    missionId: "mission-1",
    intentHash: "intent-1",
    ownerId: "lead",
    leaseEpoch: 1,
    scope: ["src/**"],
    nonGoals: ["rewrite"],
    acceptance: ["tests"],
    status: "open",
    checkpoint: { milestone: "scout" },
    updatedAt: new Date(NOW).toISOString(),
  }, null, 2),
);
fs.writeFileSync(ACTIVITY_FILE, JSON.stringify({ lead: "[Compacted]\n" }));
const baseline = runSupervisor({ ...runOptions, activityFile: ACTIVITY_FILE, dryRun: false });
check("first compact scan establishes a baseline", baseline.heartbeat.alerts.length === 0 && baseline.heartbeat.evidence.lead.baseline === true);
fs.writeFileSync(ACTIVITY_FILE, JSON.stringify({ lead: "[Compacted]\n[Compacted]\n" }));
const heartbeatOne = runSupervisor({ ...runOptions, activityFile: ACTIVITY_FILE, dryRun: true });
check("heartbeat reads compact marker evidence", heartbeatOne.heartbeat.evidence.lead.markerCount === 2);
check("two compact markers request checkpoint, not replacement", heartbeatOne.heartbeat.alerts.some((x) => x.type === "CHECKPOINT_REQUEST"));

fs.writeFileSync(ACTIVITY_FILE, JSON.stringify({ lead: "[Compacted]\n[Compacted]\n[Compacted]\n" }));
const idleAgents = JSON.parse(fs.readFileSync(AGENTS_FILE, "utf8")).map((agent) => agent.id === "lead" ? { ...agent, status: "idle" } : agent);
fs.writeFileSync(AGENTS_FILE, JSON.stringify(idleAgents, null, 2));
const heartbeatTwo = runSupervisor({ ...runOptions, activityFile: ACTIVITY_FILE, dryRun: true });
check("third observed marker proposes successor only at safe idle state", heartbeatTwo.heartbeat.alerts.some((x) => x.type === "SUCCESSOR_PROPOSAL") && heartbeatTwo.heartbeat.alerts.every((x) => x.type !== "AUTO_KILL"));

if (previousEnv === undefined) delete process.env.SEND_LOG;
else process.env.SEND_LOG = previousEnv;

console.log(`\ntest-supervisor.mjs: ${passed} passed, ${failed} failed  (channel at ${CHANNEL_DIR})`);
process.exit(failed ? 1 : 0);
