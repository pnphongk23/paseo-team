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
 *   node channel.mjs sync     <dir> <agentId>
 *   node channel.mjs read     <dir> <agentId> <messageId...> [--all]
 *   node channel.mjs threads  <dir>
 *   node channel.mjs rounds   <dir> <agentId>
 *   node channel.mjs status   <dir>
 *   node channel.mjs mission  <dir>
 *   node channel.mjs checkpoint <dir> --by <agentId> --json '<checkpoint-json>'
 *   node channel.mjs lease <dir> --by <supervisorId> --owner <leadId> --handoff-ref <ref>
 *   node channel.mjs close    <dir> --by <supervisorAgentId>
 *   node channel.mjs help     [role|command]   # or --help / -h (no command prints help too)
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
const MISSION_FILE = "mission.json";
const GLOBAL_CHANNEL_ROOT = "team-channels";
const GLOBAL_CHANNEL_VERSION = "v1";
const SUPERVISOR_CRON = "*/10 * * * *";
const DEFAULT_OVERDUE_MS = 30 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;
const DEFAULT_MAX_REMINDERS = 3;
const LEDGER_FILE = "ledger.md";
const LEDGER_MIN_BYTES = 512;
const LEDGER_MIN_MEMBERS = 6;
const LEDGER_MIN_SUBSTANTIVE = 20;
const LEDGER_STALE_POSTS = 15;
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
Read state is per-recipient in receipts/; use sync for the turn snapshot and read for receipts.
The deterministic supervisor job runs every 10 minutes and is removed when the channel closes.
  Never edit messages/ or mission.json by hand; always post through channel.mjs, and use mission/checkpoint/lease commands for durable lease state.
`;

function fail(msg, code = 2) {
  console.error(`channel: ${msg}`);
  process.exit(code);
}
const now = () => new Date().toISOString();
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

function missionPath(dir) {
  return path.join(dir, MISSION_FILE);
}

function loadMission(dir) {
  const file = missionPath(dir);
  if (!fs.existsSync(file)) return null;
  const mission = readJson(file);
  if (!mission || typeof mission !== "object" || Array.isArray(mission)) fail("mission.json must contain an object");
  if (!mission.missionId || !Number.isInteger(mission.leaseEpoch) || mission.leaseEpoch < 1) {
    fail("mission.json needs missionId and positive integer leaseEpoch");
  }
  return mission;
}

function newMission({ channelId, ownerId, requested }) {
  const value = requested && typeof requested === "object" && !Array.isArray(requested) ? requested : {};
  return {
    schemaVersion: 1,
    missionId: value.missionId || `${channelId}:${crypto.randomUUID()}`,
    intentHash: value.intentHash || null,
    ownerId: value.ownerId || ownerId || null,
    leaseEpoch: Number.isInteger(value.leaseEpoch) && value.leaseEpoch > 0 ? value.leaseEpoch : 1,
    scope: value.scope || null,
    nonGoals: Array.isArray(value.nonGoals) ? value.nonGoals : [],
    acceptance: Array.isArray(value.acceptance) ? value.acceptance : [],
    status: value.status || "open",
    checkpoint: value.checkpoint || null,
    candidateIdentity: value.candidateIdentity || null,
    predecessor: value.predecessor || null,
    handoffRef: value.handoffRef || null,
    createdAt: value.createdAt || now(),
    updatedAt: now(),
  };
}

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

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createFunctionalManifest(rootDir, rawFiles) {
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) fail("manifest requires at least one file");
  const files = [...new Set(rawFiles)]
    .filter((file) => path.basename(file) !== ".DS_Store")
    .map((file) => path.normalize(file))
    .sort();
  if (files.length === 0) fail("manifest has no functional files after excluding .DS_Store");
  const entries = files.map((file) => {
    if (path.isAbsolute(file) || file === ".." || file.startsWith(`..${path.sep}`)) fail(`manifest path must be relative: ${file}`);
    const absolute = path.join(rootDir, file);
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) fail(`manifest path is not a file: ${file}`);
    const content = fs.readFileSync(absolute);
    return { path: file.split(path.sep).join("/"), bytes: content.length, sha256: sha256(content) };
  });
  const manifest = { schemaVersion: 1, files: entries };
  return { ...manifest, digest: sha256(canonicalJson(manifest)) };
}

function validateFunctionalManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !manifest.digest) {
    fail("audit requires a schemaVersion=1 functional manifest with digest");
  }
  const entries = manifest.files;
  if (entries.some((entry) => !entry || typeof entry.path !== "string" || entry.path.endsWith("/.DS_Store") || path.basename(entry.path) === ".DS_Store" || !Number.isInteger(entry.bytes) || !/^[a-f0-9]{64}$/.test(entry.sha256))) {
    fail("functional manifest contains an invalid or excluded entry");
  }
  const normalized = entries.map((entry) => ({ path: entry.path, bytes: entry.bytes, sha256: entry.sha256 }));
  if (canonicalJson(normalized) !== canonicalJson([...normalized].sort((a, b) => a.path.localeCompare(b.path)))) fail("functional manifest entries must be sorted");
  const expected = sha256(canonicalJson({ schemaVersion: 1, files: normalized }));
  if (manifest.digest !== expected) fail(`functional manifest digest mismatch (${manifest.digest} != ${expected})`);
  return { schemaVersion: 1, files: normalized, digest: expected };
}

function launchSupervisorAudit({ manifest, criteria, reviewers }) {
  const frozenManifest = validateFunctionalManifest(manifest);
  if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) fail("audit criteria must be an object");
  if (!Array.isArray(reviewers) || reviewers.length !== 2 || new Set(reviewers).size !== 2 || reviewers.some((id) => typeof id !== "string" || !id)) {
    fail("supervisor audit requires exactly two distinct reviewer IDs");
  }
  const criteriaDigest = sha256(canonicalJson(criteria));
  const invocationDigest = sha256(canonicalJson({ manifestDigest: frozenManifest.digest, criteriaDigest }));
  return {
    schemaVersion: 1,
    state: "AWAITING_SECOND_START",
    manifest: frozenManifest,
    manifestDigest: frozenManifest.digest,
    criteria,
    criteriaDigest,
    invocationDigest,
    reviewers: reviewers.map((id) => ({ id, manifestDigest: frozenManifest.digest, criteriaDigest, started: false })),
    verdicts: {},
  };
}

function auditReviewer(audit, reviewerId) {
  const reviewer = audit.reviewers.find((item) => item.id === reviewerId);
  if (!reviewer) fail(`reviewer ${reviewerId} is not part of this audit`);
  if (reviewer.manifestDigest !== audit.manifestDigest || reviewer.criteriaDigest !== audit.criteriaDigest) fail("reviewer invocation digest mismatch");
  return reviewer;
}

function verifyAuditInvocation(audit, o) {
  if (o.manifestDigest !== audit.manifestDigest || o.criteriaDigest !== audit.criteriaDigest) {
    fail("invocation is not bound to this audit's manifest and criteria digests");
  }
}

function startSupervisorReviewer(audit, reviewerId) {
  const reviewer = auditReviewer(audit, reviewerId);
  if (reviewer.started) fail(`reviewer ${reviewerId} already started`);
  reviewer.started = true;
  if (audit.reviewers.every((item) => item.started)) audit.state = "READY_FOR_VERDICTS";
  return audit;
}

function recordSupervisorVerdict(audit, reviewerId, verdict) {
  if (!["CLEAR", "VIOLATION", "INSUFFICIENT_EVIDENCE"].includes(verdict)) fail(`invalid supervisor verdict: ${verdict}`);
  const reviewer = auditReviewer(audit, reviewerId);
  if (!audit.reviewers.every((item) => item.started)) fail("second reviewer must start before any verdict is exposed");
  if (audit.verdicts[reviewerId]) fail(`reviewer ${reviewerId} already submitted a verdict`);
  audit.verdicts[reviewerId] = { verdict, invocationDigest: audit.invocationDigest };
  return audit;
}

function mergeSupervisorAudit(audit) {
  if (!audit.reviewers.every((item) => item.started) || Object.keys(audit.verdicts).length !== 2) {
    fail("UNRESOLVED: both independent reviewers must start and submit before merge");
  }
  const verdicts = audit.reviewers.map((item) => audit.verdicts[item.id]?.verdict);
  const status = verdicts.every((verdict) => verdict === "CLEAR") ? "CLEAR" : "UNRESOLVED";
  return { state: status, manifestDigest: audit.manifestDigest, criteriaDigest: audit.criteriaDigest, verdicts };
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

const messageSummary = (m) => ({
  id: m.id,
  ts: m.ts,
  threadId: m.threadId,
  from: m.from,
  fromRole: m.fromRole,
  kind: m.kind,
  body: m.body,
});

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

/* ---------------------------- mission ledger ----------------------------- */

function ledgerPath(ch) {
  return path.join(ch._dir, LEDGER_FILE);
}

/**
 * FROZEN ledger contract (member-ledger.md), one shared probe for init/checkpoint/lease/close:
 *   obligated = members >= 6 OR substantive posts (question|answer|info) >= 20
 *   MISSING   = ledger.md absent OR size < 512 B
 *   STALE     = obligated AND ledger present AND >= 15 substantive posts newer than its mtimeMs
 */
function ledgerStatus(ch) {
  const messages = listMessages(ch);
  const substantive = messages.filter((m) => SUBSTANTIVE.has(m.kind)).length;
  const members = (ch.members || []).length;
  const obligated = members >= LEDGER_MIN_MEMBERS || substantive >= LEDGER_MIN_SUBSTANTIVE;
  const file = ledgerPath(ch);
  let missing = true;
  let stale = false;
  if (fs.existsSync(file)) {
    const size = fs.statSync(file).size;
    missing = size < LEDGER_MIN_BYTES;
    if (!missing && obligated) {
      const mtimeMs = fs.statSync(file).mtimeMs;
      stale = messages.filter((m) => SUBSTANTIVE.has(m.kind) && Date.parse(m.ts) > mtimeMs).length >= LEDGER_STALE_POSTS;
    }
  }
  return { policy: ch.ledgerPolicy, members, substantive, obligated, missing, stale, path: file };
}

/**
 * Enforcement matrix. policy === 1 is enforced; an ABSENT policy is legacy
 * (warn only, never block); any other value is not checked. canBlock is true
 * only where the command is allowed to block (new init, checkpoint).
 */
function ledgerGate(ch, { canBlock = false } = {}) {
  const status = ledgerStatus(ch);
  let action = "none";
  if (status.policy === 1) {
    if (status.obligated) {
      if (status.missing) action = canBlock ? "block" : "warn";
      else if (status.stale) action = "warn";
    }
  } else if (status.policy === undefined && status.obligated && (status.missing || status.stale)) {
    action = "warn";
  }
  return { action, status };
}

function ledgerBlockMessage(status, command) {
  return `mission ledger required (${status.members} seats, ${status.substantive} substantive posts): write ${status.path} (>= ${LEDGER_MIN_BYTES} bytes) first, then re-run ${command}`;
}

function ledgerWarnMessage(status, command) {
  const why = status.missing
    ? `missing or smaller than ${LEDGER_MIN_BYTES} bytes`
    : `${LEDGER_STALE_POSTS}+ substantive posts newer than its mtime`;
  return `ledger.md is ${why} (${status.members} seats, ${status.substantive} substantive posts); ${command} continues — update ${status.path}`;
}

function ledgerReport(status) {
  return {
    status: status.missing ? "missing" : "stale",
    obligated: status.obligated,
    members: status.members,
    substantive: status.substantive,
    policy: status.policy === undefined ? "legacy" : status.policy,
  };
}

const ledgerWarn = (status, command) => console.error(`channel: WARN ${ledgerWarnMessage(status, command)}`);

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

function resolveBudget(raw, previous, fallback, used, option) {
  const value = raw === undefined ? (previous ?? fallback) : Number(raw);
  if (!Number.isInteger(value) || value < 1) fail(`--${option} must be a positive integer`);
  if (value < used) fail(`--${option}=${value} is below existing usage ${used}`);
  return value;
}

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

  const channelFile = path.join(channelDir, "channel.json");
  const existingChannel = fs.existsSync(channelFile) ? loadChannel(channelDir) : null;
  if (existingChannel?.channelId && existingChannel.channelId !== o.channelId) {
    fail(`channel identity mismatch on re-init (${o.channelId} != ${existingChannel.channelId})`);
  }
  if (existingChannel?.createdBy && existingChannel.createdBy !== o.by) {
    fail(`only existing supervisor ${existingChannel.createdBy} may re-init this channel`);
  }
  // Ledger gate: a NEW heavy channel must not exist without its ledger; re-init and
  // legacy channels only warn (never block). Runs before channel.json/crontab writes.
  const ledgerPolicy = existingChannel ? existingChannel.ledgerPolicy : 1;
  const ledger = ledgerGate({ _dir: channelDir, members, ledgerPolicy }, { canBlock: !existingChannel });
  if (ledger.action === "block") fail(ledgerBlockMessage(ledger.status, "init"), 3);
  if (ledger.action === "warn") ledgerWarn(ledger.status, "init");
  const existingMessages = existingChannel ? listMessages(existingChannel) : [];
  const usedRounds = Math.max(0, ...members.map((member) => roundsOf(existingMessages, member.agentId)));
  const usedThreads = Math.max(0, ...members.map((member) => threadsCreatedBy(existingMessages, member.agentId)));
  const budgets = {
    maxRoundsPerMember: resolveBudget(o.maxRounds, existingChannel?.budgets?.maxRoundsPerMember, 3, usedRounds, "max-rounds"),
    maxThreadsPerMember: resolveBudget(o.maxThreads, existingChannel?.budgets?.maxThreadsPerMember, 4, usedThreads, "max-threads"),
    maxMessages: resolveBudget(o.maxMessages, existingChannel?.budgets?.maxMessages, 250, existingMessages.length, "max-messages"),
  };
  const existingMission = fs.existsSync(missionPath(channelDir)) ? loadMission(channelDir) : null;
  let requestedMission = null;
  if (o.missionJson !== undefined) {
    try {
      requestedMission = JSON.parse(o.missionJson);
    } catch {
      fail("--mission-json must be a JSON object");
    }
    if (!requestedMission || typeof requestedMission !== "object" || Array.isArray(requestedMission)) {
      fail("--mission-json must be a JSON object");
    }
  }
  if (existingMission && requestedMission?.missionId && requestedMission.missionId !== existingMission.missionId) {
    fail(`mission identity mismatch on re-init (${requestedMission.missionId} != ${existingMission.missionId})`);
  }

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
      workspaceId: workspaceId || existingChannel?.workspaceId || null,
      channelId: o.channelId,
      name: o.name || existingChannel?.name || o.channelId,
      state: "open",
      ledgerPolicy,
      createdAt: existingChannel?.createdAt || now(),
      createdBy: existingChannel?.createdBy || o.by,
      updatedAt: now(),
      budgets,
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
        installedAt: disableSupervisorJob ? null : existingChannel?.supervisor?.installedAt || now(),
      },
      members,
    };
    writeJsonAtomic(channelFile, ch);
  if (!existingMission) {
    writeJsonAtomic(missionPath(channelDir), newMission({
      channelId: ch.channelId,
      ownerId: members.find((member) => member.role === "lead")?.agentId || null,
      requested: requestedMission,
    }));
  }
  fs.writeFileSync(path.join(channelDir, "rules.md"), RULES_MD);
  const result = {
      ok: true,
      channelId: ch.channelId,
      dir: channelDir,
      members: members.length,
      state: ch.state,
      mission: loadMission(channelDir),
      budgets: ch.budgets,
      supervisor: ch.supervisor,
    };
  if (ledger.action === "warn") result.ledger = ledgerReport(ledger.status);
  console.log(JSON.stringify(result));
}

function cmdPath(o) {
  const info = globalChannelInfo(o);
  console.log(JSON.stringify({ ok: true, ...info }));
}

function auditFile(ch) {
  return path.join(ch._dir, SUPERVISOR_DIR, "compliance-audit.json");
}

function loadAudit(ch) {
  const file = auditFile(ch);
  if (!fs.existsSync(file)) fail("no supervisor compliance audit at channel");
  return readJson(file);
}

function cmdManifest(rootDir, rawFiles) {
  console.log(JSON.stringify(createFunctionalManifest(rootDir, rawFiles), null, 2));
}

function cmdAuditLaunch(ch, o) {
  let audit;
  try {
    audit = launchSupervisorAudit({
      manifest: JSON.parse(o.manifestJson),
      criteria: JSON.parse(o.criteriaJson),
      reviewers: JSON.parse(o.reviewersJson),
    });
  } catch (error) {
    if (error instanceof SyntaxError) fail("audit launch JSON is invalid");
    throw error;
  }
  writeJsonAtomic(auditFile(ch), audit);
  console.log(JSON.stringify({ ok: true, state: audit.state, manifestDigest: audit.manifestDigest, criteriaDigest: audit.criteriaDigest, invocationDigest: audit.invocationDigest }));
}

function cmdAuditStart(ch, o) {
  const audit = loadAudit(ch);
  verifyAuditInvocation(audit, o);
  startSupervisorReviewer(audit, o.reviewerId);
  writeJsonAtomic(auditFile(ch), audit);
  console.log(JSON.stringify({ ok: true, state: audit.state, started: audit.reviewers.filter((item) => item.started).map((item) => item.id) }));
}

function cmdAuditVerdict(ch, o) {
  const audit = loadAudit(ch);
  verifyAuditInvocation(audit, o);
  recordSupervisorVerdict(audit, o.reviewerId, o.verdict);
  writeJsonAtomic(auditFile(ch), audit);
  console.log(JSON.stringify({ ok: true, state: audit.state, verdictCount: Object.keys(audit.verdicts).length }));
}

function cmdAuditMerge(ch) {
  const audit = loadAudit(ch);
  const result = mergeSupervisorAudit(audit);
  audit.state = result.state;
  audit.merge = result;
  writeJsonAtomic(auditFile(ch), audit);
  console.log(JSON.stringify(result));
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
    .map(messageSummary);
  console.log(JSON.stringify({ agentId, open: open.length, items: open }, null, 2));
}

function cmdUnread(ch, agentId) {
  const idx = memberIndex(ch);
  if (!idx.has(agentId)) fail(`${agentId} is not a channel member`);
  const items = unreadMessages(ch, agentId).map(messageSummary);
  console.log(JSON.stringify({ agentId, unread: items.length, items }, null, 2));
}

function cmdSync(ch, agentId) {
  const idx = memberIndex(ch);
  if (!idx.has(agentId)) fail(`${agentId} is not a channel member`);
  const msgs = listMessages(ch);
  const readAt = loadReadReceipt(ch, agentId).readAt;
  const unread = msgs
    .filter((m) => isAddressedInbound(m, agentId) && !Object.prototype.hasOwnProperty.call(readAt, m.id))
    .map(messageSummary);
  const open = msgs.filter((m) => isActionable(msgs, m, agentId)).map(messageSummary);
  const substantivePosts = roundsOf(msgs, agentId);
  const threadsOpened = threadsCreatedBy(msgs, agentId);
  const closeHint = ch.state === "open" && msgs.length > 0 && ch.members.every(
    (member) => !msgs.some((m) => isActionable(msgs, m, member.agentId)),
  )
    ? "no open items — supervisor may post close"
    : null;
  console.log(JSON.stringify({
    channelId: ch.channelId,
    state: ch.state,
    agentId,
    mission: loadMission(ch._dir),
    unread: { count: unread.length, items: unread },
    inbox: { open: open.length, items: open },
    budget: {
      substantivePosts,
      maxRoundsPerMember: ch.budgets.maxRoundsPerMember,
      threadsOpened,
      maxThreadsPerMember: ch.budgets.maxThreadsPerMember,
      exhausted: substantivePosts >= ch.budgets.maxRoundsPerMember,
    },
    messages: { total: msgs.length, max: ch.budgets.maxMessages },
    closeHint,
  }, null, 2));
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
          mission: loadMission(ch._dir),
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

function cmdMission(ch) {
  const mission = loadMission(ch._dir);
  if (!mission) fail(`channel ${ch.channelId} has no mission.json`);
  console.log(JSON.stringify(mission, null, 2));
}

function cmdCheckpoint(ch, by, raw, candidateIdentity, leaseEpoch) {
  if (!by) fail("checkpoint requires --by <agentId>");
  const mission = loadMission(ch._dir);
  if (!mission) fail(`channel ${ch.channelId} has no mission.json`);
  if (by !== mission.ownerId && by !== ch.createdBy) fail(`checkpoint denied for ${by}; only current owner or supervisor may write`);
  if (leaseEpoch !== undefined && Number(leaseEpoch) !== mission.leaseEpoch) fail(`stale lease epoch ${leaseEpoch}; current epoch is ${mission.leaseEpoch}`);
  let checkpoint;
  try {
    checkpoint = JSON.parse(raw || "");
  } catch {
    fail("checkpoint requires --json <object>");
  }
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) fail("checkpoint --json must be an object");
  const ledger = ledgerGate(ch, { canBlock: true });
  if (ledger.action === "block") fail(ledgerBlockMessage(ledger.status, "checkpoint"), 3);
  if (ledger.action === "warn") ledgerWarn(ledger.status, "checkpoint");
  const updated = {
    ...mission,
    checkpoint,
    candidateIdentity: candidateIdentity || mission.candidateIdentity || null,
    updatedAt: now(),
  };
  writeJsonAtomic(missionPath(ch._dir), updated);
  const result = { ok: true, mission: updated };
  if (ledger.action === "warn") result.ledger = ledgerReport(ledger.status);
  console.log(JSON.stringify(result, null, 2));
}

function cmdLease(ch, by, ownerId, handoffRef, predecessor) {
  if (by !== ch.createdBy) fail(`lease rebind denied for ${by}; only channel supervisor may fence an owner`);
  if (!ownerId) fail("lease requires --owner <leadId>");
  if (!handoffRef) fail("lease requires --handoff-ref <ref>");
  const mission = loadMission(ch._dir);
  if (!mission) fail(`channel ${ch.channelId} has no mission.json`);
  const owner = ch.members.find((member) => member.agentId === ownerId && member.role === "lead");
  if (!owner) fail(`lease owner ${ownerId} must be a channel lead`);
  const ledger = ledgerGate(ch);
  if (ledger.action === "warn") ledgerWarn(ledger.status, "lease");
  const updated = {
    ...mission,
    ownerId,
    leaseEpoch: mission.leaseEpoch + 1,
    predecessor: predecessor || mission.ownerId || null,
    handoffRef,
    updatedAt: now(),
  };
  writeJsonAtomic(missionPath(ch._dir), updated);
  const result = { ok: true, mission: updated };
  if (ledger.action === "warn") result.ledger = ledgerReport(ledger.status);
  console.log(JSON.stringify(result, null, 2));
}

const ROLE_SCOPE = {
  supervisor: "You may send to ANYONE and broadcast with to:[\"*\"]. You alone may post kind close.",
  lead: "You may send to: supervisor, any lead (peer leads), your OWN peers (those with parent = you), reviewers.",
  peer: "You may send to your parent lead ONLY. You may also REPLY (answer/ack/eod) to a reviewer's DIRECT question, but never initiate to a reviewer, never escalate.",
  reviewer: "You may send to your parent lead and that lead's peers ONLY. You may ask a peer a mission-relevant question; the peer may reply once.",
};

function cmdHelp(filter) {
  const header = [
    "paseo-team channel.mjs — file-based team chat bus on the shared workspace.",
    "Paseo has no chat API; team members talk through this tool. All posts go through",
    "`post` so routing + budgets are enforced. Never hand-edit messages/, receipts/, or supervisor/.",
    "",
  ];
  const commands = [
      "init    [<dir>] --channel-id <id> --workspace-id <ws> --by <supervisorId> --members '<json>'",
      "path    --channel-id <id> --workspace-id <ws>",
      "manifest <root> <file...>          deterministic functional manifest/digest (.DS_Store excluded)",
      "audit-launch <dir> --manifest-json <json> --criteria-json <json> --reviewers-json <json>",
      "audit-start <dir> --reviewer-id <id> --manifest-digest <d> --criteria-digest <d> | audit-verdict <dir> --reviewer-id <id> --manifest-digest <d> --criteria-digest <d> --verdict <v> | audit-merge <dir>",
      "permit  <dir> <fromAgentId> <toAgentId|role|*>",
      "post    <dir> '<messageJson>'   (or '-' to read stdin)",
      "sync    <dir> <agentId>            mission + unread + inbox + own budget",
      "inbox   <dir> <agentId>            open items you owe a reply to",
    "unread  <dir> <agentId>            inbound addressed to you, not yet read",
    "read    <dir> <agentId> <id...> [--all]",
      "threads <dir> | pending <dir> | wake <dir> <agentId> | rounds <dir> <agentId>",
      "status  <dir>",
      "mission <dir>                         read the durable mission lease",
      "checkpoint <dir> --by <agentId> --json '<object>' [--lease-epoch <n>] [--candidate-identity <id>]",
      "lease <dir> --by <supervisorId> --owner <leadId> --handoff-ref <ref> [--predecessor <id>]",
      "close   <dir> --by <supervisorAgentId>",
    "help    [role|command]",
  ];
  const postSchema = [
    "Post message JSON:",
    `  { "from":"<agentId>", "to":["<agentId>|role|*"], "kind":"${[...KINDS].join("|")}",`,
    '    "body":"text", "threadId":"<optional>", "replyTo":"<optional message id>" }',
    "  replyTo must reference the parent message and keep its threadId.",
    "  question/escalate stay actionable until the asked agent posts answer/ack/eod in that thread; read does not settle.",
    "",
  ];
  const matrix = [
    "Routing matrix (denied by default):",
    "  supervisor -> anyone, \"*\" broadcast; may post kind close",
    "  lead       -> supervisor, any lead (peer leads), its OWN peers (parent = it), reviewers",
    "  peer       -> its parent lead ONLY; + reply-only answer/ack/eod to a reviewer's DIRECT question (never initiates)",
    "  reviewer   -> its parent lead and that lead's peers ONLY",
    "Escalate (kind: escalate) -> supervisor only.",
    "",
  ];
  const turn = [
      "One turn (do this each exchange point):",
      "  1. sync <dir> <yourAgentId>",
      "  2. answer exactly what you owe (answer/ack/eod with replyTo) or post one info",
      "  3. read <dir> <yourAgentId> <id...> (does not settle); do not add eod after a settling answer/ack",
      "  4. sync once before finishing only when your post may have changed close readiness.",
    "",
  ];

  const ledger = [
    `Ledger obligation (channel.json ledgerPolicy: 1): obligated when members >= ${LEDGER_MIN_MEMBERS} OR substantive posts (${[...SUBSTANTIVE].join("|")}) >= ${LEDGER_MIN_SUBSTANTIVE}; ledger.md (same dir as channel.json) must be >= ${LEDGER_MIN_BYTES} bytes.`,
    `  STALE when ${LEDGER_STALE_POSTS}+ substantive posts are newer than ledger.md mtime. policy 1: new init MISSING -> BLOCK; checkpoint MISSING -> BLOCK, STALE -> warn; lease/close -> warn only.`,
    "  legacy (no ledgerPolicy): warn only, never block. sync never reads the ledger.",
    "",
  ];

  if (filter && ROLES.includes(filter)) {
    console.log([...header, `ROLE: ${filter.toUpperCase()}`, `  ${ROLE_SCOPE[filter]}`, "", ...matrix, ...turn, "Run `channel.mjs --help` for the full command list."].join("\n"));
    return;
  }
  if (filter) {
    console.log([...header, "Commands (dir = channel dir from `path`/`init`):", ...commands.map((l) => (l.includes(filter) ? `>> ${l}` : `   ${l}`)), "", ...postSchema, ...matrix, ...ledger, ...turn].join("\n"));
    return;
  }
  console.log([
    ...header,
    "Commands (dir = channel dir from `path`/`init`; run from anywhere):",
    ...commands.map((l) => `  ${l}`),
    "",
    ...postSchema,
    ...matrix,
    ...ledger,
    ...turn,
    "See references/channel-operations.md for watchdog + member registration.",
  ].join("\n"));
}

function cmdClose(ch, by) {
  if (by !== ch.createdBy) fail("only the channel creator (supervisor) may close");
  const ledger = ledgerGate(ch);
  if (ledger.action === "warn") ledgerWarn(ledger.status, "close");
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
  if (ledger.action === "warn") result.ledger = ledgerReport(ledger.status);
  if (supervisorJobError) result.supervisorJobError = supervisorJobError;
  console.log(JSON.stringify(result));
  if (supervisorJobError) process.exitCode = 1;
}

/* --------------------------------- main --------------------------------- */

const args = process.argv.slice(2);
const cmd = args.shift();
if (cmd === undefined || cmd === "--help" || cmd === "-h" || cmd === "help") {
  cmdHelp(args[0]);
  process.exit(0);
}
let dir = null;
if (cmd === "init") {
  if (args[0] && !args[0].startsWith("--")) dir = args.shift();
} else if (cmd !== "path") {
  dir = args.shift();
}
if (dir === null && cmd !== "init" && cmd !== "path") {
  console.error(`channel: ${cmd} requires a channel <dir>   (try \`channel.mjs --help\`)`);
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
      case "manifest":
        cmdManifest(dir, args);
        break;
      case "audit-launch":
        cmdAuditLaunch(loadChannel(dir, { needOpen: true }), parseOpts(args));
        break;
      case "audit-start":
        cmdAuditStart(loadChannel(dir, { needOpen: true }), parseOpts(args));
        break;
      case "audit-verdict":
        cmdAuditVerdict(loadChannel(dir, { needOpen: true }), parseOpts(args));
        break;
      case "audit-merge":
        cmdAuditMerge(loadChannel(dir, { needOpen: true }));
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
    case "sync":
      cmdSync(loadChannel(dir), args[0]);
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
    case "mission":
      cmdMission(loadChannel(dir));
      break;
    case "checkpoint": {
      const o = parseOpts(args);
      cmdCheckpoint(loadChannel(dir, { needOpen: true }), o.by, o.json, o.candidateIdentity, o.leaseEpoch);
      break;
    }
    case "lease": {
      const o = parseOpts(args);
      cmdLease(loadChannel(dir, { needOpen: true }), o.by, o.owner, o.handoffRef, o.predecessor);
      break;
    }
    case "close": {
      const o = parseOpts(args);
      cmdClose(loadChannel(dir), o.by);
      break;
    }
    default:
      fail(`unknown command ${cmd}`);
  }
})();
