#!/usr/bin/env node
/**
 * test-channel.mjs — end-to-end verification for channel.mjs with a simulated
 * team of SIX members (no real Paseo agents created):
 *   cv-1 supervisor | tq-a, tq-b leads | ln-a1 (child of tq-a), ln-b1 (child of tq-b) | rv-1 reviewer (of tq-a)
 *
 * Run:  node test-channel.mjs   (creates a fresh channel in os.tmpdir(), asserts every rule)
 * Exit 0 = all green. Any failure prints a diff-style report and exits 1.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TOOL = path.join(import.meta.dirname, "channel.mjs");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "team-channel-test-"));
const CH = path.join(TMP, "team-demo");
const MEMBERS = [
  { agentId: "cv-1", role: "supervisor", persona: "Code Vuong" },
  { agentId: "tq-a", role: "lead", persona: "Chu Du" },
  { agentId: "tq-b", role: "lead", persona: "Tu Ma Y" },
  { agentId: "ln-a1", role: "peer", persona: "Trieu Van", parent: "tq-a" },
  { agentId: "ln-b1", role: "peer", persona: "Lu Bu", parent: "tq-b" },
  { agentId: "rv-1", role: "reviewer", persona: "Reviewer 1", parent: "tq-a" },
];

let passed = 0, failed = 0;
function check(name, cond, extra = "") {
  if (cond) { passed++; }
  else { failed++; console.error(`FAIL: ${name} ${extra ? "— " + extra : ""}`); }
}

/** Run a channel.mjs subcommand; returns {code, out} where out is parsed JSON (or raw string). */
function run(args, opts = {}) {
  try {
    const out = execFileSync("node", [TOOL, ...args], { encoding: "utf8", ...opts });
    return { code: 0, out: parse(out) };
  } catch (e) {
    return { code: e.status ?? 1, out: parse(e.stdout?.toString() || ""), err: e.stderr?.toString() || "" };
  }
}
function parse(s) {
  try { return JSON.parse(s); } catch { return s.trim(); }
}
function post(msg) {
  return run(["post", CH, JSON.stringify(msg)]);
}
const id = (r) => r.out?.id;

// 1. init
fs.mkdirSync(CH, { recursive: true });
{
  const r = run(["init", CH, "--channel-id", "team-demo", "--by", "cv-1", "--members", JSON.stringify(MEMBERS), "--no-supervisor-job"]);
    check("init ok", r.code === 0 && r.out.ok === true, JSON.stringify(r.out));
    check("rules.md written", fs.existsSync(path.join(CH, "rules.md")));
    check("channel.json state open", JSON.parse(fs.readFileSync(path.join(CH, "channel.json"), "utf8")).state === "open");
    check("mission lease written", fs.existsSync(path.join(CH, "mission.json")) && r.out.mission?.ownerId === "tq-a");
    const checkpoint = run(["checkpoint", CH, "--by", "tq-a", "--json", JSON.stringify({ milestone: "briefed", next: "scout" }), "--candidate-identity", "wip-1"]);
    check("lead can persist checkpoint", checkpoint.code === 0 && checkpoint.out.mission?.checkpoint?.milestone === "briefed");
    const deniedCheckpoint = run(["checkpoint", CH, "--by", "tq-b", "--json", JSON.stringify({ milestone: "spoof" })]);
    check("non-owner cannot persist checkpoint", deniedCheckpoint.code !== 0);
    const lease = run(["lease", CH, "--by", "cv-1", "--owner", "tq-b", "--handoff-ref", "handoff-1", "--predecessor", "tq-a"]);
    check("supervisor can fence and rebind lease", lease.code === 0 && lease.out.mission?.ownerId === "tq-b" && lease.out.mission?.leaseEpoch === 2);
    const staleCheckpoint = run(["checkpoint", CH, "--by", "tq-a", "--lease-epoch", "1", "--json", JSON.stringify({ milestone: "stale" })]);
    check("fenced owner cannot checkpoint", staleCheckpoint.code !== 0);
    const successorCheckpoint = run(["checkpoint", CH, "--by", "tq-b", "--lease-epoch", "2", "--json", JSON.stringify({ milestone: "handoff-read" })]);
    check("successor can checkpoint current lease", successorCheckpoint.code === 0 && successorCheckpoint.out.mission?.checkpoint?.milestone === "handoff-read");
    const beforeReinit = JSON.parse(fs.readFileSync(path.join(CH, "mission.json"), "utf8"));
    const reinit = run(["init", CH, "--channel-id", "team-demo", "--by", "cv-1", "--members", JSON.stringify(MEMBERS), "--no-supervisor-job"]);
    const afterReinit = JSON.parse(fs.readFileSync(path.join(CH, "mission.json"), "utf8"));
    check("re-init preserves mission identity, epoch and checkpoint", reinit.code === 0 && afterReinit.missionId === beforeReinit.missionId && afterReinit.leaseEpoch === 2 && afterReinit.checkpoint?.milestone === "handoff-read");
  }

// 2. permission matrix — every edge of the spec
const matrix = [
  // [from, to, expected, label]
  ["cv-1", "tq-a", true, "supervisor → lead"],
  ["cv-1", "ln-b1", true, "supervisor → peer"],
  ["cv-1", "rv-1", true, "supervisor → reviewer"],
  ["cv-1", "*", true, "supervisor → * broadcast"],
  ["tq-a", "cv-1", true, "lead → supervisor"],
  ["tq-a", "tq-b", true, "lead → peer lead (ngang hàng)"],
  ["tq-b", "tq-a", true, "peer lead → lead"],
  ["tq-a", "ln-a1", true, "lead → own peer"],
  ["tq-a", "ln-b1", false, "lead → OTHER's peer denied"],
  ["tq-a", "rv-1", true, "lead → reviewer"],
  ["ln-a1", "tq-a", true, "peer → parent lead"],
  ["ln-a1", "tq-b", false, "peer → other lead denied"],
  ["ln-a1", "cv-1", false, "peer → supervisor denied"],
  ["ln-a1", "ln-b1", false, "peer → peer denied"],
  ["ln-a1", "*", false, "peer → * denied"],
  ["rv-1", "tq-a", true, "reviewer → parent lead"],
  ["rv-1", "ln-a1", true, "reviewer → lead's peer"],
  ["rv-1", "ln-b1", false, "reviewer → other lead's peer denied"],
  ["rv-1", "cv-1", false, "reviewer → supervisor denied"],
  ["rv-1", "tq-b", false, "reviewer → other lead denied"],
];
for (const [f, t, want, label] of matrix) {
  const r = run(["permit", CH, f, t]);
  check(`permit ${label} ${want ? "ALLOW" : "DENY"}`, (r.code === 0) === want, `${f}->${t}: ${r.out.reason ?? r.err}`);
}

// 3. multi-round exchange: lead asks lead, reviewer asks peer, peer answers (reply-scoped)
{
  const q1 = post({ from: "tq-a", to: ["tq-b"], kind: "question", body: "Tách module X?" });
  check("lead→lead question ok", q1.code === 0);
  const a1 = post({ from: "tq-b", to: ["tq-a"], kind: "answer", replyTo: id(q1), body: "Được." });
  check("lead answers lead", a1.code === 0 && a1.out.threadId === q1.out.threadId, "threadId inheritance");

  const qr = post({ from: "rv-1", to: ["ln-a1"], kind: "question", body: "Bằng chứng test?" });
  check("reviewer→peer question ok", qr.code === 0);
  const ar = post({ from: "ln-a1", to: ["rv-1"], kind: "answer", replyTo: id(qr), body: "tests/x.spec.ts" });
  check("peer answers reviewer direct question (reply-only)", ar.code === 0, ar.err);

  const bad1 = post({ from: "ln-a1", to: ["rv-1"], kind: "info", body: "tự nhắn" });
  check("peer cannot initiate to reviewer", bad1.code !== 0);

  const qlead = post({ from: "tq-a", to: ["ln-a1"], kind: "question", body: "tiến độ?" });
  const bad2 = post({ from: "ln-a1", to: ["rv-1"], kind: "answer", replyTo: id(qlead), body: "nhầm" });
  check("peer cannot answer reviewer with lead's question as replyTo", bad2.code !== 0);

  const es = post({ from: "tq-a", to: ["cv-1"], kind: "escalate", body: "cần quyết định" });
  check("lead→supervisor escalate ok", es.code === 0);
  const esBad = post({ from: "ln-a1", to: ["cv-1"], kind: "escalate", body: "lén" });
  check("peer escalate denied", esBad.code !== 0);

  // inbox reflects the still-open items
  const inboxA = run(["inbox", CH, "ln-a1"]);
  check("ln-a1 still owes answer to tq-a's question", inboxA.out.open >= 1, JSON.stringify(inboxA.out));

  // Read receipts are durable and independent from open/answered state.
  const unreadBefore = run(["unread", CH, "ln-a1"]);
  check("unread lists inbound messages", unreadBefore.code === 0 && unreadBefore.out.unread >= 2, JSON.stringify(unreadBefore.out));
  const markReviewerQuestion = run(["read", CH, "ln-a1", id(qr)]);
  check("read marks an addressed message", markReviewerQuestion.code === 0 && markReviewerQuestion.out.marked === 1, JSON.stringify(markReviewerQuestion.out));
  const unreadAfter = run(["unread", CH, "ln-a1"]);
  check("read receipt removes only the selected message", unreadAfter.out.unread === unreadBefore.out.unread - 1 && !unreadAfter.out.items.some((m) => m.id === id(qr)), JSON.stringify(unreadAfter.out));
  const markWrongRecipient = run(["read", CH, "ln-a1", id(q1)]);
  check("read rejects a message for another recipient", markWrongRecipient.code !== 0);

  // role-token addressing is denied across non-parent members
  const roleBad = post({ from: "ln-a1", to: ["lead"], kind: "question", body: "cho mọi lead" });
  check("peer cannot address role token lead (non-parent)", roleBad.code !== 0);

  // finish the loop: qlead answered, supervisor settles escalate, then everyone eods
  post({ from: "ln-a1", to: ["tq-a"], kind: "answer", replyTo: id(qlead), body: "50%, đúng kế hoạch." });
  post({ from: "cv-1", to: ["tq-a"], kind: "ack", replyTo: id(es), body: "đã duyệt scope, tiếp tục" });
  post({ from: "rv-1", to: ["tq-a"], kind: "ack", body: "đã nhận bằng chứng" });
  post({ from: "tq-a", to: ["rv-1"], kind: "ack", body: "rõ" });
  post({ from: "tq-b", to: ["tq-a"], kind: "eod", body: "nhất trí" });
  post({ from: "tq-a", to: ["tq-b"], kind: "eod", body: "xong" });
  post({ from: "ln-a1", to: ["tq-a"], kind: "eod", body: "xong" });

  const st = run(["status", CH]);
  check("closeHint appears when no open items", st.out.closeHint !== null, JSON.stringify(st.out.closeHint));
}

// 4. round budget
{
  const r1 = post({ from: "tq-b", to: ["tq-a"], kind: "question", body: "r1" });
  const r2 = post({ from: "tq-b", to: ["tq-a"], kind: "question", body: "r2" });
  check("round 2 allowed", r1.code === 0 && r2.code === 0);
  const r3 = post({ from: "tq-b", to: ["tq-a"], kind: "question", body: "r3" });
  check("round 3 blocked (maxRoundsPerMember=3, tq-b had 1 prior)", r3.code !== 0, r3.err);
  const rd = run(["rounds", CH, "tq-b"]);
  check("rounds reports exhaustion", rd.out.exhausted === true, JSON.stringify(rd.out));
}

// 5. close lifecycle
{
  const cNonSup = post({ from: "tq-a", to: ["*"], kind: "close", body: "tự đóng" });
  check("non-supervisor cannot post close", cNonSup.code !== 0);
  const c = run(["close", CH, "--by", "cv-1"]);
  check("supervisor closes", c.code === 0 && c.out.state === "closed");
  const late = post({ from: "tq-a", to: ["tq-b"], kind: "info", body: "muộn" });
  check("post after close denied", late.code !== 0);
}

console.log(`\nchannel.mjs test: ${passed} passed, ${failed} failed  (channel at ${CH})`);
process.exit(failed ? 1 : 0);
