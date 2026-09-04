#!/usr/bin/env node
/**
 * paseo-team supervisor.mjs — deterministic channel watchdog.
 *
 * It does not create or run an LLM. Each invocation reads the complete durable
 * message log, read receipts, and reminder state, then optionally sends a
 * short interrupting reminder through the Paseo CLI.
 *
 * Usage:
 *   node supervisor.mjs <channelDir> [options]
 *
 * Options:
 *   --dry-run                 Print actions without calling Paseo or writing state
 *   --agents-file <path>      Read paseo agent-list JSON from a fixture/file
 *   --overdue-ms <n>          Open-item age before a running agent is interrupted
 *   --cooldown-ms <n>         Minimum time between reminders for the same state
 *   --max-reminders <n>       Attempts for the same state; 0 means unlimited
 *   --now <ISO>               Override current time (tests)
 *   --paseo-bin <path>        Paseo executable (default: paseo)
 *   --host <host>             Paseo daemon host
 *
 * The normal cron path is intentionally explicit about interruption: it uses
 * `paseo agent send --no-wait`, whose current Paseo semantics replace an active
 * run. It only sends for an idle agent with unread/open work, or a running agent
 * whose open work is older than --overdue-ms.
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
    const runningIsOverdue = snapshot.status === "running" && snapshot.overdue.length > 0;

    if (!agent) {
      if (snapshot.unread.length > 0 || snapshot.open.length > 0) {
        skipped.push({ ...snapshot, reason: "agent-not-listed" });
      }
      continue;
    }
    if (!idleNeedsReminder && !runningIsOverdue) {
      if (snapshot.status === "running" && (snapshot.unread.length > 0 || snapshot.open.length > 0)) {
        deferred.push({ ...snapshot, reason: "running-before-overdue" });
      } else if (snapshot.unread.length > 0 || snapshot.open.length > 0) {
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
      mode: runningIsOverdue ? "interrupt-running" : "wake-idle",
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
    nowMs: Date.now(),
    paseoBin: process.env.PASEO_BIN || "paseo",
    host: process.env.PASEO_HOST || null,
  };
  const valueOptions = new Map([
    ["--agents-file", "agentsFile"],
    ["--overdue-ms", "overdueMs"],
    ["--cooldown-ms", "cooldownMs"],
    ["--max-reminders", "maxReminders"],
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
