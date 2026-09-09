#!/usr/bin/env node
/**
 * paseo-team supervisor.mjs — deterministic channel watchdog.
 *
 * It does not create or run an LLM. Each invocation reads the complete durable
 * message log, read receipts, mission lease and reminder state, then optionally
 * sends a short reminder to an idle agent through the Paseo CLI.
 *
 * Usage:
 *   node supervisor.mjs <channelDir> [options]
 *
 * Options:
 *   --dry-run                 Print actions without calling Paseo or writing state
 *   --agents-file <path>      Read paseo agent-list JSON from a fixture/file
 *   --overdue-ms <n>          Age threshold for open items and stale lease evidence
 *   --cooldown-ms <n>         Minimum time between reminders for the same state
 *   --max-reminders <n>       Attempts for the same state; 0 means unlimited
 *   --activity-file <path>    Fixture/text source for activity-log checks
 *   --log-tail <n>            Maximum log entries to inspect for compact markers
 *   --now <ISO>               Override current time (tests)
 *   --paseo-bin <path>        Paseo executable (default: paseo)
 *   --host <host>             Paseo daemon host
 *
 * The normal cron path avoids interruption: `paseo agent send --no-wait` is used
 * only for idle agents. A running agent with open work is deferred because the
 * current Paseo semantics may replace its active turn. Compact markers are
 * evidence-only and never trigger an automatic kill.
 */
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_OVERDUE_MS = 30 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;
const DEFAULT_MAX_REMINDERS = 3;
const RECEIPTS_DIR = "receipts";
const SUPERVISOR_DIR = "supervisor";
const REMINDER_STATE_FILE = "reminders.json";
const HEARTBEAT_STATE_FILE = "heartbeat.json";
const MISSION_FILE = "mission.json";
const DEFAULT_LOG_TAIL = 1000;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temporary = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function fail(message) {
  throw new Error(`supervisor: ${message}`);
}

export function loadChannel(channelDir) {
  const dir = path.resolve(channelDir);
  const file = path.join(dir, "channel.json");
  if (!fs.existsSync(file)) fail(`no channel at ${dir} (missing channel.json)`);
  const channel = readJson(file);
  if (!Array.isArray(channel.members)) fail(`channel ${channel.channelId ?? "?"} has no members array`);
  return { ...channel, _dir: dir };
}

export function listMessages(channelDir) {
  const dir = path.join(channelDir, "messages");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(dir, name)))
    .sort((left, right) =>
      left.ts < right.ts ? -1 : left.ts > right.ts ? 1 : left.id < right.id ? -1 : 1,
    );
}

function receiptPath(channelDir, agentId) {
  return path.join(channelDir, RECEIPTS_DIR, `${encodeURIComponent(agentId)}.json`);
}

export function loadReadAt(channelDir, agentId) {
  const file = receiptPath(channelDir, agentId);
  if (!fs.existsSync(file)) return {};
  const value = readJson(file);
  return value && value.readAt && typeof value.readAt === "object" ? value.readAt : {};
}

function isAddressedInbound(message, agentId) {
  return (
    message.from !== agentId &&
    Array.isArray(message.to) &&
    (message.to.includes(agentId) || message.to.includes("*"))
  );
}

function isActionable(messages, message, agentId) {
  if (message.kind !== "question" && message.kind !== "escalate") return false;
  if (message.from === agentId) return false;
  const addressed =
    (Array.isArray(message.to) && message.to.includes(agentId)) ||
    (Array.isArray(message.to) && message.to.includes("*")) ||
    (Array.isArray(message.to) && message.to.includes(message.fromRole));
  if (!addressed) return false;
  return !messages.some(
    (candidate) =>
      candidate.threadId === message.threadId &&
      candidate.from === agentId &&
      ["answer", "ack", "eod"].includes(candidate.kind),
  );
}

function summarizeMessage(message) {
  return {
    id: message.id,
    ts: message.ts,
    threadId: message.threadId,
    from: message.from,
    fromRole: message.fromRole,
    kind: message.kind,
  };
}

export function inspectRecipient({ channelDir, messages, member, agent, nowMs, overdueMs }) {
  const readAt = loadReadAt(channelDir, member.agentId);
  const inbound = messages.filter((message) => isAddressedInbound(message, member.agentId));
  const unread = inbound.filter(
    (message) => !Object.prototype.hasOwnProperty.call(readAt, message.id),
  );
  const open = messages.filter((message) => isActionable(messages, message, member.agentId));
  const overdue = open.filter((message) => {
    const timestamp = Date.parse(message.ts);
    return Number.isFinite(timestamp) && nowMs - timestamp >= overdueMs;
  });
  return {
    agentId: member.agentId,
    role: member.role,
    status: agent?.status ?? "missing",
    unread,
    open,
    overdue,
    unreadItems: unread.map(summarizeMessage),
    openItems: open.map(summarizeMessage),
    overdueItems: overdue.map(summarizeMessage),
  };
}

function stateFingerprint(snapshot) {
  const value = {
    status: snapshot.status,
    unread: snapshot.unread.map((message) => message.id).sort(),
    open: snapshot.open.map((message) => message.id).sort(),
    overdue: snapshot.overdue.map((message) => message.id).sort(),
  };
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseIsoMs(value) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function reminderStatePath(channelDir) {
  return path.join(channelDir, SUPERVISOR_DIR, REMINDER_STATE_FILE);
}

function loadReminderState(channelDir) {
  const file = reminderStatePath(channelDir);
  if (!fs.existsSync(file)) return { version: 1, agents: {} };
  const value = readJson(file);
  return {
    version: 1,
    agents: value && value.agents && typeof value.agents === "object" ? value.agents : {},
  };
}

function writeReminderState(channelDir, state) {
  writeJsonAtomic(reminderStatePath(channelDir), state);
}

function missionPath(channelDir) {
  return path.join(channelDir, MISSION_FILE);
}

export function loadMission(channelDir) {
  const file = missionPath(channelDir);
  if (!fs.existsSync(file)) return null;
  const mission = readJson(file);
  if (!mission || typeof mission !== "object" || Array.isArray(mission)) fail("mission.json must contain an object");
  return mission;
}

function heartbeatStatePath(channelDir) {
  return path.join(channelDir, SUPERVISOR_DIR, HEARTBEAT_STATE_FILE);
}

function loadHeartbeatState(channelDir) {
  const file = heartbeatStatePath(channelDir);
  if (!fs.existsSync(file)) return { version: 1, agents: {}, lastAlerts: {} };
  const value = readJson(file);
  return {
    version: 1,
    agents: value && value.agents && typeof value.agents === "object" ? value.agents : {},
    lastAlerts: value && value.lastAlerts && typeof value.lastAlerts === "object" ? value.lastAlerts : {},
  };
}

function writeHeartbeatState(channelDir, state) {
  writeJsonAtomic(heartbeatStatePath(channelDir), state);
}

function readActivityText(options, agentId) {
  if (options.activityFile) {
    const raw = fs.readFileSync(path.resolve(options.activityFile), "utf8");
    try {
      const value = JSON.parse(raw);
      if (typeof value === "string") return value;
      if (value && typeof value === "object" && typeof value[agentId] === "string") return value[agentId];
      return "";
    } catch {
      return raw;
    }
  }
  const args = ["logs", agentId, "--tail", String(options.logTail || DEFAULT_LOG_TAIL)];
  if (options.host) args.push("--host", options.host);
  try {
    return execFileSync(options.paseoBin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

export function readCompactEvidence({ agentId, options, previous = {} }) {
  const text = readActivityText(options, agentId);
  if (text === null) {
    return { agentId, available: false, confidence: "unavailable", markerCount: null, markerDelta: 0, reason: "activity-unavailable" };
  }
  const markerCount = (text.match(/\[Compacted\]/g) || []).length;
  const signature = crypto.createHash("sha256").update(text).digest("hex");
  const hasBaseline = Number.isInteger(previous.markerCount);
  const previousCount = hasBaseline ? previous.markerCount : markerCount;
  return {
    agentId,
    available: true,
    confidence: "partial",
    markerCount,
    markerDelta: hasBaseline ? Math.max(0, markerCount - previousCount) : 0,
    baseline: !hasBaseline,
    signature,
    authoritative: false,
    reason: markerCount > 0 ? "free-text-marker-without-event-id" : "no-marker-observed",
  };
}

function alertFingerprint(alert) {
  return crypto.createHash("sha256").update(JSON.stringify({
    type: alert.type,
    agentId: alert.agentId || null,
    missionId: alert.missionId || null,
    leaseEpoch: alert.leaseEpoch || null,
    evidence: alert.evidence || null,
  })).digest("hex");
}

export function planHeartbeat({ channel, mission, agents, evidenceByAgent, state, nowMs, staleMs = DEFAULT_OVERDUE_MS }) {
  const alerts = [];
  if (!mission) {
    alerts.push({ type: "ROUTE_ALERT", reason: "MISSION_MISSING", target: channel.createdBy });
    return alerts;
  }
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const memberIds = new Set(channel.members.map((member) => member.agentId));
  if (mission.ownerId && !memberIds.has(mission.ownerId)) {
    alerts.push({
      type: "LEASE_FENCE",
      agentId: mission.ownerId,
      missionId: mission.missionId,
      leaseEpoch: mission.leaseEpoch,
      target: channel.createdBy,
      evidence: { reason: "owner-not-in-roster" },
    });
  }
  const ownerIds = mission.ownerId
    ? [mission.ownerId]
    : channel.members.filter((member) => member.role === "lead").map((member) => member.agentId);
  for (const agentId of ownerIds) {
    const agent = agentById.get(agentId);
    const evidence = evidenceByAgent[agentId];
    if (!agent || ["missing", "closed", "completed", "error"].includes(agent.status)) {
      alerts.push({
        type: "SUCCESSOR_PROPOSAL",
        agentId,
        missionId: mission.missionId,
        leaseEpoch: mission.leaseEpoch,
        target: channel.createdBy,
        evidence: { status: agent?.status || "missing", reason: "owner-not-live" },
      });
      continue;
    }
    const updatedMs = parseIsoMs(mission.updatedAt);
    if (updatedMs !== null && nowMs - updatedMs >= staleMs) {
      alerts.push({
        type: "ROUTE_ALERT",
        agentId,
        missionId: mission.missionId,
        leaseEpoch: mission.leaseEpoch,
        target: channel.createdBy,
        evidence: { reason: "LEASE_STALE", ageMs: nowMs - updatedMs, status: agent.status },
      });
    }
    if (evidence?.markerDelta > 0) {
      const type = evidence.markerCount >= 3 && agent.status !== "running" ? "SUCCESSOR_PROPOSAL" : "CHECKPOINT_REQUEST";
      alerts.push({
        type,
        agentId,
        missionId: mission.missionId,
        leaseEpoch: mission.leaseEpoch,
        target: channel.createdBy,
        evidence: {
          reason: evidence.reason,
          markerCount: evidence.markerCount,
          markerDelta: evidence.markerDelta,
          confidence: evidence.confidence,
          status: agent.status,
        },
      });
    }
  }
  return alerts.map((alert) => ({ ...alert, fingerprint: alertFingerprint(alert) }));
}

function buildAlertPrompt(channelDir, alerts) {
  return [
    `Heartbeat alert for channel ${channelDir}.`,
    "Chỉ xử lý theo evidence; guardian không phán architecture và không tự thay Lead.",
    ...alerts.map((alert) => `${alert.type}: agent=${alert.agentId || "-"} mission=${alert.missionId || "-"} epoch=${alert.leaseEpoch || "-"} evidence=${JSON.stringify(alert.evidence || { reason: alert.reason })}`),
    "Nếu cần thay Lead: yêu cầu checkpoint/handoff, fence lease trước, rồi mới đề xuất successor ở safe boundary.",
  ].join("\n");
}

export function buildReminderPrompt({ channelDir, unreadCount, openCount, overdueCount }) {
  const parts = [];
  if (unreadCount > 0) parts.push(`${unreadCount} tin nhắn chưa đọc`);
  if (openCount > 0) parts.push(`${openCount} mục đang nợ trả lời`);
  if (overdueCount > 0) parts.push(`${overdueCount} mục đã quá hạn`);
  const summary =
    parts.length > 0 ? `Bạn có ${parts.join("; ")} trên team channel.` : "Có hoạt động team channel cần kiểm tra.";
  return [
    summary,
    "Phân biệt 2 view (thay <dir> và <agentId> bằng giá trị của bạn):",
    "  • channel.mjs unread <dir> <agentId>  = tin bạn chưa đọc",
    "  • channel.mjs inbox <dir> <agentId>   = mục bạn ĐANG NỢ phải trả lời (open items)",
    "Watchdog nhắc chủ yếu vì mục nợ/open, dù unread có thể = 0.",
    "Cân nhắc xử lý và tiếp tục công việc hiện tại nếu cần.",
    `Channel tại ${channelDir}.`,
    "QUAN TRỌNG: mục open chỉ được coi là xử lý xong khi bạn post answer/ack/eod (kèm replyTo) lên channel.",
    "Chạy channel.mjs read <dir> <agentId> <id...> CHỈ đánh dấu đã đọc, KHÔNG settle câu hỏi.",
    "Post xử lý qua: channel.mjs post <dir> '<json>'. Không tự sửa messages/ trực tiếp.",
  ].join("\n");
}

export function planReminders({
  channel,
  messages,
  agents,
  channelDir,
  state,
  nowMs,
  overdueMs,
  cooldownMs,
  maxReminders,
}) {
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const actions = [];
  const deferred = [];
  const skipped = [];

  if (channel.state !== "open") {
    return { actions, deferred, skipped: [{ reason: `channel-${channel.state}` }], state };
  }

  for (const member of channel.members) {
    const agent = agentById.get(member.agentId);
      const snapshot = inspectRecipient({ channelDir, messages, member, agent, nowMs, overdueMs });
      const idleNeedsReminder =
        snapshot.status === "idle" && (snapshot.unread.length > 0 || snapshot.open.length > 0);
      const runningHasWork = snapshot.status === "running" && (snapshot.unread.length > 0 || snapshot.open.length > 0);

    if (!agent) {
      if (snapshot.unread.length > 0 || snapshot.open.length > 0) {
        skipped.push({ ...snapshot, reason: "agent-not-listed" });
      }
      continue;
    }
      if (runningHasWork) {
        deferred.push({ ...snapshot, reason: "running-no-interrupt" });
        continue;
      }
      if (!idleNeedsReminder) {
        if (snapshot.unread.length > 0 || snapshot.open.length > 0) {
          skipped.push({ ...snapshot, reason: `status-${snapshot.status}` });
        }
        continue;
      }

    const signature = stateFingerprint(snapshot);
    const previous = state.agents[member.agentId];
    const sameState = previous?.signature === signature;
    const attempts = sameState && Number.isInteger(previous?.attempts) ? previous.attempts : 0;
    const lastAttemptMs = parseIsoMs(previous?.lastAttemptAt);
    if (sameState && lastAttemptMs !== null && nowMs - lastAttemptMs < cooldownMs) {
      skipped.push({ ...snapshot, reason: "cooldown", attempts, signature });
      continue;
    }
    if (sameState && maxReminders > 0 && attempts >= maxReminders) {
      skipped.push({ ...snapshot, reason: "max-reminders", attempts, signature });
      continue;
    }

    actions.push({
      ...snapshot,
      signature,
      attempts,
        prompt: buildReminderPrompt({
        channelDir,
        unreadCount: snapshot.unread.length,
        openCount: snapshot.open.length,
        overdueCount: snapshot.overdue.length,
        }),
        mode: "wake-idle",
    });
  }

  return { actions, deferred, skipped, state };
}

function parseAgentList(value) {
  const records = Array.isArray(value) ? value : value?.agents;
  if (!Array.isArray(records)) fail("agent list JSON must be an array or an object with agents[]");
  return records.filter((record) => record && typeof record.id === "string");
}

function loadAgents(options) {
  if (options.agentsFile) return parseAgentList(readJson(path.resolve(options.agentsFile)));
  const args = ["agent", "ls", "--global", "--json"];
  if (options.host) args.push("--host", options.host);
  try {
    return parseAgentList(
      JSON.parse(
        execFileSync(options.paseoBin, args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ),
    );
  } catch (error) {
    const stderr = error?.stderr?.toString?.().trim();
    throw new Error(stderr || (error instanceof Error ? error.message : String(error)));
  }
}

function sendReminder(options, action) {
  const args = ["agent", "send", "--no-wait", "--json"];
  if (options.host) args.push("--host", options.host);
  args.push(action.agentId, action.prompt);
  try {
    return execFileSync(options.paseoBin, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr = error?.stderr?.toString?.().trim();
    throw new Error(stderr || (error instanceof Error ? error.message : String(error)));
  }
}

function parsePositiveNumber(raw, name, { allowZero = true } = {}) {
  const value = Number(raw);
  if (!Number.isFinite(value) || (!allowZero && value <= 0) || (allowZero && value < 0)) {
    fail(`${name} must be a ${allowZero ? "non-negative" : "positive"} number`);
  }
  return value;
}

function parseArgs(argv) {
  if (argv.length === 0 || argv[0].startsWith("-")) {
    fail("usage: supervisor.mjs <channelDir> [options]");
  }
  const options = {
    channelDir: path.resolve(argv[0]),
    dryRun: false,
    agentsFile: null,
    overdueMs: DEFAULT_OVERDUE_MS,
      cooldownMs: DEFAULT_COOLDOWN_MS,
      maxReminders: DEFAULT_MAX_REMINDERS,
      activityFile: null,
      logTail: DEFAULT_LOG_TAIL,
      nowMs: Date.now(),
    paseoBin: process.env.PASEO_BIN || "paseo",
    host: process.env.PASEO_HOST || null,
  };
  const valueOptions = new Map([
    ["--agents-file", "agentsFile"],
    ["--overdue-ms", "overdueMs"],
    ["--cooldown-ms", "cooldownMs"],
      ["--max-reminders", "maxReminders"],
      ["--activity-file", "activityFile"],
      ["--log-tail", "logTail"],
    ["--now", "now"],
    ["--paseo-bin", "paseoBin"],
    ["--host", "host"],
  ]);
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    const key = valueOptions.get(flag);
    if (!key) fail(`unknown option ${flag}`);
    if (index + 1 >= argv.length) fail(`${flag} requires a value`);
    const raw = argv[++index];
    if (key === "overdueMs") options[key] = parsePositiveNumber(raw, flag);
    else if (key === "cooldownMs") options[key] = parsePositiveNumber(raw, flag);
      else if (key === "maxReminders") options[key] = parsePositiveNumber(raw, flag);
      else if (key === "logTail") options[key] = parsePositiveNumber(raw, flag, { allowZero: false });
    else if (key === "now") {
      const parsed = Date.parse(raw);
      if (!Number.isFinite(parsed)) fail("--now must be an ISO timestamp");
      options.nowMs = parsed;
    } else options[key] = raw;
  }
  return options;
}

export function runSupervisor(options) {
  const channel = loadChannel(options.channelDir);
  const messages = listMessages(channel._dir);
  const agents = loadAgents(options);
  const state = loadReminderState(channel._dir);
  const mission = loadMission(channel._dir);
  const heartbeatState = loadHeartbeatState(channel._dir);
  const evidenceByAgent = {};
  if (mission) {
    const leadIds = mission.ownerId
      ? [mission.ownerId]
      : channel.members.filter((member) => member.role === "lead").map((member) => member.agentId);
    for (const agentId of leadIds) {
      evidenceByAgent[agentId] = readCompactEvidence({
        agentId,
        options,
        previous: heartbeatState.agents[agentId],
      });
    }
  }
  const heartbeatAlerts = mission
    ? planHeartbeat({
        channel,
        mission,
        agents,
        evidenceByAgent,
        state: heartbeatState,
        nowMs: options.nowMs,
        staleMs: options.overdueMs,
      })
    : [];
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const heartbeatDelivery = [];
  const nextHeartbeatState = {
    ...heartbeatState,
    agents: Object.fromEntries(Object.entries(evidenceByAgent).map(([agentId, evidence]) => [
      agentId,
      { ...evidence, checkedAt: new Date(options.nowMs).toISOString() },
    ])),
  };
  const alertsByTarget = new Map();
  for (const alert of heartbeatAlerts) {
    const target = alert.target || channel.createdBy;
    if (!alertsByTarget.has(target)) alertsByTarget.set(target, []);
    alertsByTarget.get(target).push(alert);
  }
  for (const [target, alerts] of alertsByTarget) {
    const uniqueAlerts = alerts.filter((alert) => heartbeatState.lastAlerts[alert.fingerprint] !== alert.fingerprint);
    if (uniqueAlerts.length === 0) {
      heartbeatDelivery.push({ target, status: "suppressed", reason: "same-evidence" });
      continue;
    }
    const targetAgent = agentById.get(target);
    const delivery = {
      target,
      alertTypes: uniqueAlerts.map((alert) => alert.type),
      status: targetAgent?.status === "idle" ? "pending" : "deferred-running-or-missing",
      alerts: uniqueAlerts,
    };
    if (!options.dryRun && targetAgent?.status === "idle") {
      try {
        delivery.paseoOutput = sendReminder(options, {
          agentId: target,
          prompt: buildAlertPrompt(channel._dir, uniqueAlerts),
        });
        delivery.status = "sent";
      } catch (error) {
        delivery.status = "failed";
        delivery.error = error instanceof Error ? error.message : String(error);
      }
    }
    for (const alert of uniqueAlerts) nextHeartbeatState.lastAlerts[alert.fingerprint] = alert.fingerprint;
    heartbeatDelivery.push(delivery);
  }
  if (!options.dryRun && mission) writeHeartbeatState(channel._dir, nextHeartbeatState);
  const plan = planReminders({
    channel,
    messages,
    agents,
    channelDir: channel._dir,
    state,
    nowMs: options.nowMs,
    overdueMs: options.overdueMs,
    cooldownMs: options.cooldownMs,
    maxReminders: options.maxReminders,
  });
  const result = {
    ok: true,
    dryRun: options.dryRun,
    channelId: channel.channelId,
    channelDir: channel._dir,
      channelState: channel.state,
      mission: mission
        ? {
            missionId: mission.missionId,
            ownerId: mission.ownerId,
            leaseEpoch: mission.leaseEpoch,
            updatedAt: mission.updatedAt,
          }
        : null,
      heartbeat: {
        evidence: evidenceByAgent,
        alerts: heartbeatAlerts,
        delivery: heartbeatDelivery,
      },
      now: new Date(options.nowMs).toISOString(),
    messages: messages.length,
    actions: [],
    deferred: plan.deferred.map((item) => ({
      agentId: item.agentId,
      status: item.status,
      unread: item.unread.length,
      open: item.open.length,
      overdue: item.overdue.length,
      reason: item.reason,
    })),
    skipped: plan.skipped.map((item) => ({
      agentId: item.agentId,
      status: item.status,
      unread: item.unread?.length ?? 0,
      open: item.open?.length ?? 0,
      overdue: item.overdue?.length ?? 0,
      reason: item.reason,
      attempts: item.attempts,
    })),
  };

  for (const action of plan.actions) {
    const previous = state.agents[action.agentId];
    const sameState = previous?.signature === action.signature;
    const attempts = (sameState && Number.isInteger(previous?.attempts) ? previous.attempts : 0) + 1;
    const stateEntry = {
      signature: action.signature,
      unreadMessageIds: action.unread.map((message) => message.id),
      openMessageIds: action.open.map((message) => message.id),
      overdueMessageIds: action.overdue.map((message) => message.id),
      attempts,
      lastAttemptAt: new Date(options.nowMs).toISOString(),
      lastResult: "pending",
    };

    if (!options.dryRun) {
      state.agents[action.agentId] = stateEntry;
      writeReminderState(channel._dir, state);
    }

    try {
      const output = options.dryRun ? null : sendReminder(options, action);
      if (!options.dryRun) {
        state.agents[action.agentId] = { ...stateEntry, lastResult: "sent" };
        writeReminderState(channel._dir, state);
      }
      result.actions.push({
        agentId: action.agentId,
        status: action.status,
        mode: action.mode,
        unread: action.unread.length,
        open: action.open.length,
        overdue: action.overdue.length,
        attempts,
        prompt: action.prompt,
        sent: !options.dryRun,
        paseoOutput: output,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!options.dryRun) {
        state.agents[action.agentId] = { ...stateEntry, lastResult: "failed", error: message };
        writeReminderState(channel._dir, state);
      }
      result.ok = false;
      result.actions.push({
        agentId: action.agentId,
        status: action.status,
        mode: action.mode,
        unread: action.unread.length,
        open: action.open.length,
        overdue: action.overdue.length,
        attempts,
        prompt: action.prompt,
        sent: false,
        error: message,
      });
    }
  }
  return result;
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = runSupervisor(options);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
