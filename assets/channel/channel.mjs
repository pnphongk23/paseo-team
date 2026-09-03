#!/usr/bin/env node
/**
 * paseo-team channel.mjs — file-based team chat bus on top of the shared workspace.
 *
 * Why: Paseo 0.6 has NO chat/channel/message-bus API. Its primitives are
 * agent creation, send_agent_prompt, activity reads, terminals, and a shared
 * filesystem. This script turns the shared global Paseo home into a bounded,
 * permission-routed, multi-round conversation channel that every agent in the
 * team can read/write with plain file tools without changing the project.
 *
 * Usage (run from anywhere; global storage is the default for init):
 *   node channel.mjs init     --channel-id <id> --workspace-id <workspaceId> --by <supervisorAgentId> --members '<json>'
 *   node channel.mjs init     <legacyDir> --channel-id <id> --by <supervisorAgentId> --members '<json>' [--no-supervisor-job]
 *   node channel.mjs path     --channel-id <id> --workspace-id <workspaceId>
 *   node channel.mjs permit   <dir> <fromAgentId> <toAgentId|role|*>
 *   node channel.mjs post     <dir> '<messageJson>'          # or '-' to read from stdin
 *   node channel.mjs inbox    <dir> <agentId>
 *   node channel.mjs unread   <dir> <agentId>
 *   node channel.mjs read     <dir> <agentId> <messageId...> [--all]
 *   node channel.mjs threads  <dir>
 *   node channel.mjs rounds   <dir> <agentId>
 *   node channel.mjs status   <dir>
 *   node channel.mjs close    <dir> --by <supervisorAgentId>
 *
 * Message JSON for `post`:
 *   { "from": "<agentId>", "to": ["<agentId>|role|*"], "kind": "question|answer|info|ack|eod|escalate|close",
 *     "body": "text", "threadId": "<optional>", "replyTo": "<optional message id>" }
 *
 * Enforced rules (canonical routing matrix — also written to rules.md at init):
 *   supervisor → anyone (+ "*" broadcast), may close
 *   lead       → supervisor, any lead (peer leads), own peers (parent link), reviewers
 *   peer       → own parent lead ONLY
 *   reviewer   → its parent lead and that lead's peers ONLY
 *   escalate   → supervisor ONLY
 * Loop safety: maxRoundsPerMember (substantive posts), maxThreadsPerMember,
 *   maxMessages total, and an "actionable" rule so agents settle each thread
 *   at most once. No shared state file to corrupt — everything is derived
 *   from channel.json + messages/*.json, so concurrent posts are race-free
 *   (one file per message).
 *
 * Node built-ins only. Tested on node v22.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const ROLES = ["supervisor", "lead", "peer", "reviewer"];
const SUBSTANTIVE = new Set(["question", "answer", "info"]);
const CONTROL = new Set(["ack", "eod", "escalate", "close"]);
const KINDS = new Set([...SUBSTANTIVE, ...CONTROL]);
const RECEIPTS_DIR = "receipts";
const SUPERVISOR_DIR = "supervisor";
const SUPERVISOR_SCRIPT = "supervisor.mjs";
const GLOBAL_CHANNEL_ROOT = "team-channels";
const GLOBAL_CHANNEL_VERSION = "v1";
const SUPERVISOR_CRON = "*/2 * * * *";
const DEFAULT_OVERDUE_MS = 30 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;
const DEFAULT_MAX_REMINDERS = 3;
const RULES_MD = `# Team channel routing matrix (canonical)

Members: see channel.json. Roles: supervisor, lead, peer, reviewer.
Every \`to\` address is an agentId, a role token ("supervisor"|"lead"|"peer"|"reviewer"), or "*" (supervisor only).

| from        | may send to                                                          |
|-------------|----------------------------------------------------------------------|
| supervisor  | anyone, "*" broadcast; may post kind close                            |
| lead        | supervisor, any lead (peer leads), own peers (parent link), reviewers |
| peer        | its parent lead ONLY; plus reply-only answers to a reviewer's          |
|             | direct question (never initiates)                                      |
| reviewer    | its parent lead and that lead's peers ONLY                            |

Escalation: kind escalate is supervisor-only.
Loop safety: maxRoundsPerMember substantive posts, maxThreadsPerMember threads,
maxMessages total. Settle each thread at most once (inbox shows what you owe).
Read state is per-recipient in receipts/; use unread/read for read receipts.
The deterministic supervisor job runs every 2 minutes and is removed when the channel closes.
Never edit messages/ by hand; always post through channel.mjs.
`;

function fail(msg, code = 2) {
  console.error(`channel: ${msg}`);
  process.exit(code);
}
const now = () => new Date().toISOString();
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

function writeJsonAtomic(p, value) {
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(p)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, p);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function resolvePaseoHome(value) {
  const configured = value || process.env.PASEO_HOME;
  return path.resolve(configured || path.join(os.homedir(), ".paseo"));
}

function safeSegment(value, label) {
  if (typeof value !== "string" || value.length === 0 || value === "." || value === "..") {
    fail(`${label} must be a non-empty path-safe identifier`);
  }
  return encodeURIComponent(value);
}

function globalChannelDir(o) {
  if (!o.workspaceId) fail("--workspace-id is required when using global channel storage");
  if (!o.channelId) fail("--channel-id required");
  return path.join(
    resolvePaseoHome(o.paseoHome),
    GLOBAL_CHANNEL_ROOT,
    GLOBAL_CHANNEL_VERSION,
    safeSegment(o.workspaceId, "--workspace-id"),
    safeSegment(o.channelId, "--channel-id"),
  );
}

function globalChannelInfo(o) {
  const dir = globalChannelDir(o);
  return {
    dir,
    paseoHome: resolvePaseoHome(o.paseoHome),
    workspaceId: o.workspaceId,
    channelId: o.channelId,
  };
}

function supervisorJobId(channelDir, channelId) {
  return crypto
    .createHash("sha256")
    .update(`${path.resolve(channelDir)}\0${channelId}`)
    .digest("hex")
    .slice(0, 16);
}

function resolveExecutable(command) {
  if (path.isAbsolute(command)) return command;
  if (command.includes(path.sep)) return path.resolve(command);
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, command);
    try {
      if (fs.statSync(candidate).isFile() && (fs.statSync(candidate).mode & 0o111) !== 0) return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }
  return command;
}

function supervisorJobSpec(channelDir, channelId, options = {}, { requireScript = true } = {}) {
  const absoluteChannelDir = path.resolve(channelDir);
  const script = path.resolve(options.supervisorScript || path.join(import.meta.dirname, SUPERVISOR_SCRIPT));
  if (requireScript && !fs.existsSync(script)) {
    fail(`cannot install supervisor job: missing ${script}`);
  }
  const jobId = supervisorJobId(absoluteChannelDir, channelId);
  const marker = `# paseo-team-supervisor:${jobId}`;
  const log = path.join(absoluteChannelDir, SUPERVISOR_DIR, "watchdog.log");
  const paseoBin = resolveExecutable(options.paseoBin || process.env.PASEO_BIN || "paseo");
  const overdueMs = options.overdueMs ?? DEFAULT_OVERDUE_MS;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const maxReminders = options.maxReminders ?? DEFAULT_MAX_REMINDERS;
  const line = [
    SUPERVISOR_CRON,
    shellQuote(process.execPath),
    shellQuote(script),
    shellQuote(absoluteChannelDir),
    "--paseo-bin",
    shellQuote(paseoBin),
    "--overdue-ms",
    String(overdueMs),
    "--cooldown-ms",
    String(cooldownMs),
    "--max-reminders",
    String(maxReminders),
    ">>",
    shellQuote(log),
    "2>&1",
    marker,
  ].join(" ");
  return {
    jobId,
    cadence: SUPERVISOR_CRON,
    marker,
    script,
    channelDir: absoluteChannelDir,
    log,
    line,
  };
}

function crontabCommand() {
  return process.env.PASEO_TEAM_CRONTAB_BIN || "crontab";
}

function readCrontab() {
  const result = spawnSync(crontabCommand(), ["-l"], { encoding: "utf8" });
  if (result.error) fail(`cannot read crontab: ${result.error.message}`);
  if (result.status === 0) return result.stdout || "";
  const stderr = (result.stderr || "").trim();
  if (result.status === 1 && /no crontab/i.test(stderr)) return "";
  fail(`cannot read crontab${stderr ? `: ${stderr}` : ` (exit ${result.status})`}`);
}

function writeCrontab(contents) {
  const result = spawnSync(crontabCommand(), ["-"], { input: contents, encoding: "utf8" });
  if (result.error) fail(`cannot write crontab: ${result.error.message}`);
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    fail(`cannot write crontab${stderr ? `: ${stderr}` : ` (exit ${result.status})`}`);
  }
}

function crontabLines(contents) {
  return contents.split(/\r?\n/).filter((line) => line.length > 0);
}

function installSupervisorJob(spec) {
  fs.mkdirSync(path.dirname(spec.log), { recursive: true });
  const lines = crontabLines(readCrontab()).filter((line) => !line.includes(spec.marker));
  lines.push(spec.line);
  writeCrontab(`${lines.join("\n")}\n`);
  return spec;
}

function removeSupervisorJobMarker(marker) {
  const current = readCrontab();
  const lines = crontabLines(current);
  const remaining = lines.filter((line) => !line.includes(marker));
  if (remaining.length === lines.length) return false;
  writeCrontab(remaining.length > 0 ? `${remaining.join("\n")}\n` : "");
  return true;
}

function removeSupervisorJob(spec) {
  return removeSupervisorJobMarker(spec.marker);
}

function receiptPath(ch, agentId) {
  return path.join(ch._dir, RECEIPTS_DIR, `${encodeURIComponent(agentId)}.json`);
}

function loadReadReceipt(ch, agentId) {
  const p = receiptPath(ch, agentId);
  if (!fs.existsSync(p)) return { version: 1, agentId, readAt: {} };
  const value = readJson(p);
  return {
    version: 1,
    agentId,
    readAt: value && value.readAt && typeof value.readAt === "object" ? value.readAt : {},
  };
}

function isAddressedInbound(msg, agentId) {
  return msg.from !== agentId && Array.isArray(msg.to) && msg.to.includes(agentId);
}

function unreadMessages(ch, agentId) {
  const readAt = loadReadReceipt(ch, agentId).readAt;
  return listMessages(ch).filter(
    (msg) => isAddressedInbound(msg, agentId) && !Object.prototype.hasOwnProperty.call(readAt, msg.id),
  );
}

function loadChannel(dir, { needOpen = false } = {}) {
  const cp = path.join(dir, "channel.json");
  if (!fs.existsSync(cp)) fail(`no channel at ${dir} (missing channel.json)`);
  const ch = readJson(cp);
  ch._dir = dir;
  if (needOpen && ch.state !== "open") fail(`channel ${ch.channelId} is ${ch.state}`);
  return ch;
}
const memberIndex = (ch) => new Map(ch.members.map((m) => [m.agentId, m]));
const byRole = (ch, role) => ch.members.filter((m) => m.role === role);

function listMessages(ch) {
  const d = path.join(ch._dir, "messages");
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson(path.join(d, f)))
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : 1));
}

function resolveTo(ch, to) {
  const idx = memberIndex(ch);
  const out = new Set();
  for (const t of to) {
    if (t === "*") out.add("*");
    else if (ROLES.includes(t)) byRole(ch, t).forEach((m) => out.add(m.agentId));
    else if (idx.has(t)) out.add(t);
    else fail(`unknown address "${t}" (not an agentId, role, or *)`);
  }
  return [...out];
}

/** Canonical routing matrix. Returns { allow, reason }. */
function permit(ch, from, to) {
  const idx = memberIndex(ch);
  const fromM = idx.get(from);
  if (!fromM) return { allow: false, reason: `sender ${from} is not a channel member` };
  if (to === "*") return fromM.role === "supervisor" ? { allow: true } : { allow: false, reason: "only supervisor may broadcast to *" };
  const toM = idx.get(to);
  if (!toM) return { allow: false, reason: `recipient ${to} is not a channel member` };
  const f = fromM.role, t = toM.role;
  switch (f) {
    case "supervisor":
      return { allow: true };
    case "lead":
      if (t === "supervisor") return { allow: true };
      if (t === "lead") return { allow: true, reason: "lead-to-lead (peer leads)" };
      if (t === "peer") return toM.parent === from ? { allow: true, reason: "own peer" } : { allow: false, reason: "lead may only address its own peers" };
      if (t === "reviewer") return { allow: true };
      break;
    case "peer":
      if (t === "lead" && toM.agentId === fromM.parent) return { allow: true, reason: "peer → parent lead" };
      if (t === "reviewer")
        return { allow: false, reason: "peer → reviewer is reply-only (only answering a reviewer's direct question; checked by post)" };
      return { allow: false, reason: "peer may only address its parent lead" };
    case "reviewer":
      if (t === "lead" && toM.agentId === fromM.parent) return { allow: true, reason: "reviewer → parent lead" };
      if (t === "peer" && toM.parent === fromM.parent) return { allow: true, reason: "reviewer → lead's peers" };
      return { allow: false, reason: "reviewer may only address its parent lead and that lead's peers" };
  }
  return { allow: false, reason: `${f} → ${t} not allowed by matrix` };
}

const roundsOf = (msgs, agentId) => msgs.filter((m) => m.from === agentId && SUBSTANTIVE.has(m.kind)).length;
const threadsCreatedBy = (msgs, agentId) =>
  new Set(msgs.filter((m) => m.from === agentId && m.kind === "question" && !m.replyTo).map((m) => m.threadId)).size;

/**
 * Is message m still awaiting a reply from agentA?
 * m is actionable for A iff: m is question/escalate, A is addressed (by id,
 * role token, or *), m.from != A, and A has not yet settled this thread
 * (no answer/ack/eod by A anywhere in the thread).
 */
function isActionable(msgs, m, agentA) {
  if (!(m.kind === "question" || m.kind === "escalate")) return false;
  if (m.from === agentA) return false;
  const addressed = m.to.includes(agentA) || m.to.includes("*") || m.to.includes(m.fromRole);
  if (!addressed) return false;
  return !msgs.some((x) => x.threadId === m.threadId && x.from === agentA && ["answer", "ack", "eod"].includes(x.kind));
}

/* ------------------------------- commands ------------------------------- */

function cmdInit(dir, o) {
  if (!o.channelId) fail("--channel-id required");
  if (!o.by) fail("--by <supervisorAgentId> required");
  let members;
  try {
    members = JSON.parse(o.members);
  } catch {
    fail("--members must be a JSON array");
  }
  if (!Array.isArray(members) || members.length < 2) fail("--members must be a JSON array of >= 2 members");
  const ids = new Set();
  const leads = new Set();
  for (const m of members) {
    if (!m.agentId || !ROLES.includes(m.role)) fail(`member needs agentId + role in ${JSON.stringify(m)}`);
    if (ids.has(m.agentId)) fail(`duplicate member ${m.agentId}`);
    ids.add(m.agentId);
    if (m.role === "supervisor" && m.agentId !== o.by) fail(`supervisor member must equal --by (${m.agentId} != ${o.by})`);
    if (m.role === "lead") leads.add(m.agentId);
    if ((m.role === "peer" || m.role === "reviewer") && !m.parent) fail(`${m.role} ${m.agentId} needs parent (lead agentId)`);
  }
  for (const m of members) {
    if ((m.role === "peer" || m.role === "reviewer") && !leads.has(m.parent))
      fail(`${m.role} ${m.agentId}: parent ${m.parent} must exist and be a lead`);
  }

  const useGlobalStorage = dir === null || o.global === true;
  if (useGlobalStorage && dir !== null && o.global === true) {
    fail("--global cannot be combined with a positional channel directory");
  }
  if (!useGlobalStorage && dir === null) fail("channel directory is required for local channel storage");
  const workspaceId = o.workspaceId || null;
  const channelDir = useGlobalStorage
    ? globalChannelDir({ ...o, workspaceId })
    : path.resolve(dir);
  fs.mkdirSync(path.join(channelDir, "messages"), { recursive: true });
  fs.mkdirSync(path.join(channelDir, RECEIPTS_DIR), { recursive: true });
  fs.mkdirSync(path.join(channelDir, SUPERVISOR_DIR), { recursive: true });

  const disableSupervisorJob =
    Object.prototype.hasOwnProperty.call(o, "noSupervisorJob") ||
    process.env.PASEO_TEAM_DISABLE_SUPERVISOR_JOB === "1";
  const supervisorOptions = {
    supervisorScript: o.supervisorScript,
    paseoBin: o.paseoBin,
    overdueMs: o.overdueMs === undefined ? DEFAULT_OVERDUE_MS : Number(o.overdueMs),
    cooldownMs: o.cooldownMs === undefined ? DEFAULT_COOLDOWN_MS : Number(o.cooldownMs),
    maxReminders: o.maxReminders === undefined ? DEFAULT_MAX_REMINDERS : Number(o.maxReminders),
  };
  for (const [name, value] of Object.entries(supervisorOptions).filter(([name]) => name.endsWith("Ms") || name === "maxReminders")) {
    if (!Number.isFinite(value) || value < 0) fail(`--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} must be non-negative`);
  }

  const job = supervisorJobSpec(channelDir, o.channelId, supervisorOptions, {
    requireScript: !disableSupervisorJob,
  });
  if (!disableSupervisorJob) installSupervisorJob(job);
  const ch = {
    schemaVersion: useGlobalStorage ? 2 : 1,
    storage: useGlobalStorage ? "paseo-global" : "local",
    workspaceId,
    channelId: o.channelId,
    name: o.name || o.channelId,
    state: "open",
    createdAt: now(),
    createdBy: o.by,
    budgets: {
      maxRoundsPerMember: Number(o.maxRounds || 3),
      maxThreadsPerMember: Number(o.maxThreads || 4),
      maxMessages: Number(o.maxMessages || 250),
    },
    supervisor: {
      enabled: !disableSupervisorJob,
      status: disableSupervisorJob ? "disabled" : "active",
      jobId: job.jobId,
      cadence: job.cadence,
      marker: job.marker,
      script: job.script,
      log: job.log,
      overdueMs: supervisorOptions.overdueMs,
      cooldownMs: supervisorOptions.cooldownMs,
      maxReminders: supervisorOptions.maxReminders,
      installedAt: disableSupervisorJob ? null : now(),
    },
    members,
  };
  writeJsonAtomic(path.join(channelDir, "channel.json"), ch);
  fs.writeFileSync(path.join(channelDir, "rules.md"), RULES_MD);
  console.log(JSON.stringify({
    ok: true,
    channelId: ch.channelId,
    dir: channelDir,
    members: members.length,
    state: ch.state,
    supervisor: ch.supervisor,
  }));
}

function cmdPath(o) {
  const info = globalChannelInfo(o);
  console.log(JSON.stringify({ ok: true, ...info }));
}

function cmdPermit(ch, from, to) {
  const r = permit(ch, from, to);
  console.log(JSON.stringify({ allow: r.allow, from, to, reason: r.reason || "ok" }));
  process.exit(r.allow ? 0 : 1);
}

function cmdPost(ch, raw, readStdin) {
  if (ch.state !== "open") fail(`channel ${ch.channelId} is ${ch.state}`);
  let msg;
  try {
    msg = JSON.parse(readStdin ? fs.readFileSync(0, "utf8") : raw);
  } catch {
    fail("post payload is not valid JSON");
  }
  if (!msg.from) fail("post requires from (agentId)");
  if (!Array.isArray(msg.to) || msg.to.length === 0) fail("post requires to: [agentId|role|*]");
  if (!KINDS.has(msg.kind)) fail(`kind must be one of ${[...KINDS].join(", ")}`);
  if (typeof msg.body !== "string" || msg.body.trim().length === 0) fail("post requires non-empty body");
  const idx = memberIndex(ch);
  const fromM = idx.get(msg.from);
  if (!fromM) fail(`sender ${msg.from} is not a channel member`);
  if (msg.kind === "close" && fromM.role !== "supervisor") fail("only supervisor may post close");

  const msgs = listMessages(ch);
  if (msgs.length >= ch.budgets.maxMessages) fail(`channel hit maxMessages=${ch.budgets.maxMessages}; supervisor should close`);

  const to = resolveTo(ch, msg.to);
  if (msg.kind === "escalate") {
    if (to.length !== 1 || to[0] !== ch.createdBy) fail("escalate may only target the supervisor");
  }
  const recipients = to.includes("*") ? ch.members.map((m) => m.agentId) : to;
  for (const r of recipients) {
    // peer → reviewer is handled by the reply-scope rule below (skip matrix here).
    if (fromM.role === "peer" && idx.get(r)?.role === "reviewer") continue;
    const p = permit(ch, msg.from, r);
    if (!p.allow) fail(`permission denied: ${msg.from} -> ${r} (${p.reason})`);
  }

  // Peer → reviewer: reply-only exception so a reviewer can actually obtain
  // information from a peer without loosening the peer→lead-only rule globally.
  // Peer may answer ONLY the reviewer's own direct question/escalate, never
  // initiate. (The strict-relay alternative: peer answers via its parent lead
  // and the lead relays to the reviewer.)
  const peerToReviewers = recipients.filter((r) => idx.get(r)?.role === "reviewer" && fromM.role === "peer");
  for (const r of peerToReviewers) {
    if (!["answer", "ack", "eod"].includes(msg.kind)) fail(`peer ${msg.from} may only reply (answer/ack/eod) to reviewer ${r}, not initiate`);
    const parent = msg.replyTo && msgs.find((m) => m.id === msg.replyTo);
    if (!parent || parent.from !== r || !["question", "escalate"].includes(parent.kind))
      fail(`peer ${msg.from} may only answer reviewer ${r}'s own direct question`);
  }

  // Reply/correlation validation.
  let threadId = msg.threadId;
  if (msg.replyTo) {
    const parent = msgs.find((m) => m.id === msg.replyTo);
    if (!parent) fail(`replyTo ${msg.replyTo} does not exist`);
    threadId = msg.threadId || parent.threadId;
    if (threadId !== parent.threadId) fail(`replyTo ${msg.replyTo} is in thread ${parent.threadId}, not ${msg.threadId}`);
  }
  threadId = threadId || `t-${crypto.randomUUID().slice(0, 8)}`;

  // Loop budgets.
  const round = roundsOf(msgs, msg.from) + (SUBSTANTIVE.has(msg.kind) ? 1 : 0);
  if (SUBSTANTIVE.has(msg.kind)) {
    if (round > ch.budgets.maxRoundsPerMember)
      fail(`round budget exceeded: ${msg.from} at round ${round}/${ch.budgets.maxRoundsPerMember}`);
    if (!msg.replyTo && msg.kind === "question" && threadsCreatedBy(msgs, msg.from) >= ch.budgets.maxThreadsPerMember)
      fail(`thread budget exceeded: ${msg.from} opened maxThreadsPerMember=${ch.budgets.maxThreadsPerMember}`);
  }

  const id = crypto.randomUUID();
  const ts = now();
  const full = {
    id,
    ts,
    channelId: ch.channelId,
    threadId,
    replyTo: msg.replyTo || null,
    from: msg.from,
    fromRole: fromM.role,
    to: [...new Set(recipients)],
    kind: msg.kind,
    body: msg.body,
    round,
  };
  const fname = `${ts.replace(/[:.]/g, "-")}-${id.slice(0, 8)}.json`;
  fs.writeFileSync(path.join(ch._dir, "messages", fname), JSON.stringify(full, null, 2));
  console.log(JSON.stringify({ ok: true, id, ts, threadId, round, to: full.to }));
}

function cmdPending(ch) {
  const msgs = listMessages(ch);
  const deliveries = ch.members
    .map((m) => ({
      agentId: m.agentId,
      role: m.role,
      open: msgs.filter((x) => isActionable(msgs, x, m.agentId)).length,
      items: msgs
        .filter((x) => isActionable(msgs, x, m.agentId))
        .map((x) => ({ id: x.id, ts: x.ts, threadId: x.threadId, from: x.from, fromRole: x.fromRole, kind: x.kind, body: x.body })),
    }))
    .filter((r) => r.open > 0);
  console.log(JSON.stringify({ channelId: ch.channelId, due: deliveries.length, deliveries }, null, 2));
}

function cmdWake(ch, agentId) {
  const msgs = listMessages(ch);
  const byId = new Map(msgs.map((m) => [m.id, m]));
  const idx = memberIndex(ch);
  if (!idx.has(agentId)) fail(`${agentId} is not a channel member`);
  const toNotify = new Set();
  for (const m of msgs) {
    if (m.from === agentId && ["answer", "ack", "eod"].includes(m.kind) && m.replyTo) {
      const parent = byId.get(m.replyTo);
      if (parent && parent.from !== agentId && ["question", "escalate"].includes(parent.kind)) toNotify.add(parent.from);
    }
  }
  const out = [...toNotify].map((id) => ({ agentId: id, role: idx.get(id)?.role }));
  console.log(JSON.stringify({ responder: agentId, toNotify: out }, null, 2));
}

function cmdInbox(ch, agentId) {
  const idx = memberIndex(ch);
  if (!idx.has(agentId)) fail(`${agentId} is not a channel member`);
  const msgs = listMessages(ch);
  const open = msgs
    .filter((m) => isActionable(msgs, m, agentId))
    .map((m) => ({ id: m.id, ts: m.ts, threadId: m.threadId, from: m.from, fromRole: m.fromRole, kind: m.kind, body: m.body }));
  console.log(JSON.stringify({ agentId, open: open.length, items: open }, null, 2));
}

function cmdUnread(ch, agentId) {
  const idx = memberIndex(ch);
  if (!idx.has(agentId)) fail(`${agentId} is not a channel member`);
  const items = unreadMessages(ch, agentId).map((m) => ({
    id: m.id,
    ts: m.ts,
    threadId: m.threadId,
    from: m.from,
    fromRole: m.fromRole,
    kind: m.kind,
    body: m.body,
  }));
  console.log(JSON.stringify({ agentId, unread: items.length, items }, null, 2));
}

function cmdRead(ch, agentId, rawArgs) {
  const idx = memberIndex(ch);
  if (!idx.has(agentId)) fail(`${agentId} is not a channel member`);
  const options = rawArgs.filter((arg) => arg.startsWith("--"));
  const ids = rawArgs.filter((arg) => !arg.startsWith("--"));
  const all = options.includes("--all");
  const unknownOption = options.find((arg) => arg !== "--all");
  if (unknownOption) fail(`unknown read option ${unknownOption}`);
  if (all && ids.length > 0) fail("read --all cannot be combined with message IDs");
  if (!all && ids.length === 0) fail("read requires message IDs or --all");

  const msgs = listMessages(ch);
  const byId = new Map(msgs.map((m) => [m.id, m]));
  const selectedIds = all
    ? msgs.filter((m) => isAddressedInbound(m, agentId)).map((m) => m.id)
    : [...new Set(ids)];
  for (const id of selectedIds) {
    const msg = byId.get(id);
    if (!msg) fail(`message ${id} does not exist`);
    if (!isAddressedInbound(msg, agentId)) fail(`message ${id} is not addressed to ${agentId}`);
  }

  const receipt = loadReadReceipt(ch, agentId);
  const markedAt = now();
  const marked = [];
  for (const id of selectedIds) {
    if (!Object.prototype.hasOwnProperty.call(receipt.readAt, id)) marked.push(id);
    receipt.readAt[id] = markedAt;
  }
  writeJsonAtomic(receiptPath(ch, agentId), receipt);
  console.log(JSON.stringify({
    ok: true,
    agentId,
    marked: marked.length,
    messageIds: marked,
    unread: unreadMessages(ch, agentId).length,
  }, null, 2));
}

function cmdThreads(ch) {
  const msgs = listMessages(ch);
  const groups = new Map();
  for (const m of msgs) {
    if (!groups.has(m.threadId)) groups.set(m.threadId, []);
    groups.get(m.threadId).push(m);
  }
  const out = [];
  for (const [tid, mm] of groups) {
    const root = mm.find((m) => !m.replyTo) || mm[0];
    const openIds = mm.filter((m) => m.kind === "question" || m.kind === "escalate").map((m) => m.id);
    out.push({
      threadId: tid,
      startedBy: root.from,
      kind: root.kind,
      messages: mm.length,
      lastTs: mm[mm.length - 1].ts,
      participants: [...new Set(mm.map((m) => m.from))],
      questionIds: openIds,
    });
  }
  console.log(JSON.stringify({ threads: out.length, items: out }, null, 2));
}

function cmdRounds(ch, agentId) {
  const msgs = listMessages(ch);
  const idx = memberIndex(ch);
  if (!idx.has(agentId)) fail(`${agentId} is not a channel member`);
  const substantive = roundsOf(msgs, agentId);
  console.log(
    JSON.stringify({
      agentId,
      role: idx.get(agentId).role,
      substantivePosts: substantive,
      maxRoundsPerMember: ch.budgets.maxRoundsPerMember,
      threadsOpened: threadsCreatedBy(msgs, agentId),
      maxThreadsPerMember: ch.budgets.maxThreadsPerMember,
      exhausted: substantive >= ch.budgets.maxRoundsPerMember,
    })
  );
}

function cmdStatus(ch) {
  const msgs = listMessages(ch);
  const byMember = ch.members.map((m) => ({
    agentId: m.agentId,
    role: m.role,
    persona: m.persona || null,
    parent: m.parent || null,
    sent: msgs.filter((x) => x.from === m.agentId).length,
    rounds: roundsOf(msgs, m.agentId),
    openItems: msgs.filter((x) => isActionable(msgs, x, m.agentId)).length,
    unread: unreadMessages(ch, m.agentId).length,
  }));
  const openThreads = [...new Set(msgs.filter((m) => m.kind === "question" || m.kind === "escalate").map((m) => m.threadId))];
  console.log(
    JSON.stringify(
      {
        channelId: ch.channelId,
        state: ch.state,
        budgets: ch.budgets,
        messages: msgs.length,
        members: byMember,
        openThreads,
        closeHint:
          ch.state === "open" && msgs.length > 0 && byMember.every((m) => m.openItems === 0)
            ? "no open items — supervisor may post close"
            : null,
      },
      null,
      2
    )
  );
}

function cmdClose(ch, by) {
  if (by !== ch.createdBy) fail("only the channel creator (supervisor) may close");
  ch.state = "closed";
  ch.closedAt = now();
  writeJsonAtomic(path.join(ch._dir, "channel.json"), ch);
  const ts = now();
  fs.writeFileSync(
    path.join(ch._dir, "messages", `${ts.replace(/[:.]/g, "-")}-close.json`),
    JSON.stringify(
      { id: crypto.randomUUID(), ts, channelId: ch.channelId, threadId: "system", replyTo: null, from: by, fromRole: "supervisor", to: ["*"], kind: "close", body: "channel closed by supervisor", round: 0 },
      null,
      2
    )
  );
  let supervisorJobRemoved = false;
  let supervisorJobError = null;
  try {
    if (ch.supervisor?.enabled !== false) {
      const marker = ch.supervisor?.marker || `# paseo-team-supervisor:${supervisorJobId(ch._dir, ch.channelId)}`;
      supervisorJobRemoved = removeSupervisorJobMarker(marker);
    }
  } catch (error) {
    supervisorJobError = error instanceof Error ? error.message : String(error);
  }
  const result = { ok: supervisorJobError === null, channelId: ch.channelId, state: ch.state, supervisorJobRemoved };
  if (supervisorJobError) result.supervisorJobError = supervisorJobError;
  console.log(JSON.stringify(result));
  if (supervisorJobError) process.exitCode = 1;
}

/* --------------------------------- main --------------------------------- */

const args = process.argv.slice(2);
const cmd = args.shift();
let dir = null;
if (cmd === "init") {
  if (args[0] && !args[0].startsWith("--")) dir = args.shift();
} else if (cmd !== "path") {
  dir = args.shift();
}
if (!cmd || (dir === null && cmd !== "init" && cmd !== "path")) {
  console.error("usage: channel.mjs init [<dir>] [options] | path [options] | <command> <dir> [args]");
  process.exit(2);
}
function parseOpts(a) {
  const o = {};
  const booleanOptions = new Set(["global", "noSupervisorJob"]);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith("--")) continue;
    const key = a[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (booleanOptions.has(key)) o[key] = true;
    else o[key] = a[++i];
  }
  return o;
}
(function main() {
  switch (cmd) {
    case "init":
      cmdInit(dir, parseOpts(args));
      break;
    case "path":
      cmdPath(parseOpts(args));
      break;
    case "permit":
      cmdPermit(loadChannel(dir), args[0], args[1]);
      break;
    case "post":
      cmdPost(loadChannel(dir, { needOpen: true }), args[0], args[0] === "-");
      break;
    case "inbox":
      cmdInbox(loadChannel(dir), args[0]);
      break;
    case "unread":
      cmdUnread(loadChannel(dir), args[0]);
      break;
    case "read":
      cmdRead(loadChannel(dir), args[0], args.slice(1));
      break;
    case "wake":
      cmdWake(loadChannel(dir), args[0]);
      break;
    case "pending":
      cmdPending(loadChannel(dir));
      break;
    case "threads":
      cmdThreads(loadChannel(dir));
      break;
    case "rounds":
      cmdRounds(loadChannel(dir), args[0]);
      break;
    case "status":
      cmdStatus(loadChannel(dir));
      break;
    case "close": {
      const o = parseOpts(args);
      cmdClose(loadChannel(dir), o.by);
      break;
    }
    default:
      fail(`unknown command ${cmd}`);
  }
})();