#!/usr/bin/env node
/**
 * test-ledger-enforcement.mjs — proves the FROZEN ledger-obligation contract of
 * channel.mjs (member-ledger.md) with real child processes, plus a mutation test.
 *
 * FROZEN CONTRACT (the suite writes the formula out literally; it is never
 * imported from channel.mjs):
 *   obligated = members >= 6 OR substantive posts (question|answer|info) >= 20
 *   MISSING   = ledger.md absent OR size < 512 B
 *   STALE     = obligated AND ledger present AND >= 15 substantive posts newer
 *               than ledger.md mtimeMs
 *   ledgerPolicy === 1: new init MISSING -> BLOCK; checkpoint MISSING -> BLOCK,
 *     STALE -> WARN; lease/close -> WARN only, never block.
 *   absent ledgerPolicy (legacy): WARN only, never block; channel.json keeps no
 *     ledgerPolicy key and jobId/marker bytes are untouched.
 *   sync: untouched (proved by test-ledger-path.mjs byte-identity, C3/C6).
 *   `ledger` appears in command JSON output only when a warn/block is emitted.
 *
 * Required-case map (one line): below-threshold = A, new 6-seat block/pass = B,
 * 4-seat grown to 20 blocks checkpoint = C, stale warn/clear = D, legacy 8-seat
 * grandfathering = E, parallel heavy+light slugs = F, mutation test = G.
 *
 * Safety: every child process runs with PASEO_HOME pinned to a fresh
 * os.tmpdir() sandbox and PASEO_TEAM_DISABLE_SUPERVISOR_JOB=1, so the real
 * ~/.paseo and the real crontab are never written. The suite reads
 * `crontab -l` before and after and fails if the user's
 * paseo-team-supervisor line count changed. The mutation test only edits a
 * COPY of channel.mjs inside a temp directory; it never touches the source.
 *
 * Run:  node test-ledger-enforcement.mjs
 * Exit 0 = all green. Any failure prints FAIL with its case label and exits 1.
 */
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), "channel.mjs");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "team-ledger-enforcement-test-"));
const SANDBOX = path.join(TMP, "paseo-home");
fs.mkdirSync(SANDBOX, { recursive: true });

// Safety first: pin the suite (and every child) to the sandbox before any command.
process.env.PASEO_HOME = SANDBOX;
process.env.PASEO_TEAM_DISABLE_SUPERVISOR_JOB = "1";
const CHILD_ENV = { ...process.env, PASEO_HOME: SANDBOX, PASEO_TEAM_DISABLE_SUPERVISOR_JOB: "1" };

/** A missing crontab counts as zero lines; any real regression shows up as a changed count. */
function supervisorCronLineCount() {
  try {
    return execFileSync("crontab", ["-l"], { encoding: "utf8" })
      .split("\n")
      .filter((line) => line.includes("paseo-team-supervisor")).length;
  } catch {
    return 0;
  }
}
const CRON_BEFORE = supervisorCronLineCount();

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Run a channel.mjs subcommand in the sandbox; raw stdout/stderr are kept for byte checks. */
function run(args, { tool = TOOL, env = CHILD_ENV } = {}) {
  const result = spawnSync("node", [tool, ...args], { encoding: "utf8", env });
  const stdout = result.stdout ?? "";
  return { code: result.status ?? 1, stdout, stderr: result.stderr ?? "", out: parse(stdout) };
}
function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
const hasLedgerField = (text) => text.includes('"ledger"');
const keysOf = (object) => (object && typeof object === "object" ? Object.keys(object) : []);
const ledgerIn = (dir) => path.join(dir, "ledger.md");
/** Generate a real (>= 512 B) ledger body, like the lead-authored file. */
function ledgerBody(label) {
  const lines = [`# Mission ledger — ${label}`, "", `marker: ${crypto.randomUUID()}`, ""];
  while (lines.join("\n").length < 1024) lines.push(`note ${lines.length}: durable mission record line for the ledger obligation test`);
  return lines.join("\n");
}
function writeLedger(dir, label) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ledgerIn(dir), ledgerBody(label));
}
function post(dir, from, to, kind = "info") {
  return run(["post", dir, JSON.stringify({ from, to, kind, body: `${from}->${to.join(",")} ${kind}` })]);
}
const M4 = JSON.stringify([
  { agentId: "cv", role: "supervisor" },
  { agentId: "la", role: "lead" },
  { agentId: "lb", role: "lead" },
  { agentId: "p1", role: "peer", parent: "la" },
]);
const M6 = JSON.stringify([
  { agentId: "cv", role: "supervisor" },
  { agentId: "la", role: "lead" },
  { agentId: "lb", role: "lead" },
  { agentId: "p1", role: "peer", parent: "la" },
  { agentId: "p2", role: "peer", parent: "lb" },
  { agentId: "rv", role: "reviewer", parent: "la" },
]);
const M8 = JSON.stringify([
  { agentId: "cv", role: "supervisor" },
  { agentId: "la", role: "lead" },
  { agentId: "lb", role: "lead" },
  { agentId: "lc", role: "lead" },
  { agentId: "p1", role: "peer", parent: "la" },
  { agentId: "p2", role: "peer", parent: "lb" },
  { agentId: "p3", role: "peer", parent: "lc" },
  { agentId: "rv", role: "reviewer", parent: "la" },
]);
const initArgs = (dir, members, extra = []) => [
  "init", dir, "--channel-id", path.basename(dir), "--by", "cv", "--members", members, ...extra,
];

/* -------- A: below threshold is never blocked and emits no ledger field ---- */
{
  const dir = path.join(TMP, "A-below");
  const init = run(initArgs(dir, M4));
  check(
    "A1 init with 4 seats / 0 posts is allowed and emits no ledger field",
    init.code === 0 && init.out?.ok === true && !hasLedgerField(init.stdout),
    `code=${init.code} ${init.stdout.slice(0, 160)}`,
  );
  const expected = ["ok", "channelId", "dir", "members", "state", "mission", "budgets", "supervisor"];
  check(
    "A2 below-threshold init output keys are unchanged (no ledger)",
    JSON.stringify(keysOf(init.out)) === JSON.stringify(expected),
    JSON.stringify(keysOf(init.out)),
  );
  for (let index = 0; index < 2; index += 1) {
    post(dir, "cv", ["*"]);
    post(dir, "la", ["lb"]);
    post(dir, "lb", ["la"]);
  }
  check("A3 fixture holds 4 seats and 6 substantive posts (below the 20-post arm)", fs.readdirSync(path.join(dir, "messages")).length === 6);
  const checkpoint = run(["checkpoint", dir, "--by", "la", "--json", JSON.stringify({ case: "below" })]);
  check(
    "A4 checkpoint below threshold is allowed and emits no ledger field",
    checkpoint.code === 0 && checkpoint.out?.mission?.checkpoint?.case === "below" && !hasLedgerField(checkpoint.stdout),
    `code=${checkpoint.code} ${checkpoint.stdout.slice(0, 160)}`,
  );
  const close = run(["close", dir, "--by", "cv"]);
  check(
    "A5 close below threshold is allowed and emits no ledger field",
    close.code === 0 && close.out?.state === "closed" && !hasLedgerField(close.stdout),
    `code=${close.code} ${close.stdout.slice(0, 160)}`,
  );
}

/* ---- B: new 6-seat channel blocks on init; passes with a valid ledger ----- */
{
  const dir = path.join(TMP, "B-heavy-new");
  const blocked = run(initArgs(dir, M6));
  check(
    "B1 new 6-seat init without ledger.md BLOCKS with a non-zero exit",
    blocked.code !== 0,
    `code=${blocked.code} ${blocked.stdout.slice(0, 160)}`,
  );
  check(
    "B2 block message is actionable: names ledger.md, its path and 'write ... first'",
    blocked.stderr.includes("ledger.md") &&
      blocked.stderr.includes(ledgerIn(dir)) &&
      /write .*first/i.test(blocked.stderr) &&
      blocked.stderr.includes("re-run init"),
    blocked.stderr.trim(),
  );
  check(
    "B3 blocked init did not create channel.json or mission.json (ledger must exist first)",
    !fs.existsSync(path.join(dir, "channel.json")) && !fs.existsSync(path.join(dir, "mission.json")),
  );
  writeLedger(dir, "B-heavy-new");
  const allowed = run(initArgs(dir, M6));
  check(
    "B4 the same init after writing ledger.md succeeds",
    allowed.code === 0 && allowed.out?.ok === true && !hasLedgerField(allowed.stdout),
    `code=${allowed.code} ${allowed.stdout.slice(0, 160)}`,
  );
  const channel = JSON.parse(fs.readFileSync(path.join(dir, "channel.json"), "utf8"));
  check("B5 new channel.json records ledgerPolicy: 1", channel.ledgerPolicy === 1, JSON.stringify(channel.ledgerPolicy));
  const reinit = run(initArgs(dir, M6));
  const reChannel = JSON.parse(fs.readFileSync(path.join(dir, "channel.json"), "utf8"));
  check(
    "B6 re-init preserves ledgerPolicy: 1 verbatim",
    reinit.code === 0 && reChannel.ledgerPolicy === 1 && !hasLedgerField(reinit.stdout),
    `code=${reinit.code} policy=${JSON.stringify(reChannel.ledgerPolicy)}`,
  );
}

/* --- C: 4-seat channel grown to 20 posts blocks checkpoint, passes with ---- */
{
  const dir = path.join(TMP, "C-grow");
  run(initArgs(dir, M4, ["--max-rounds", "25"]));
  const senders = [["cv", ["*"]], ["la", ["lb"]], ["lb", ["la"]], ["p1", ["la"]]];
  for (let index = 0; index < 5; index += 1) for (const [from, to] of senders) post(dir, from, to);
  check("C1 fixture holds 4 seats and 20 substantive posts", fs.readdirSync(path.join(dir, "messages")).length === 20);
  const blocked = run(["checkpoint", dir, "--by", "la", "--json", JSON.stringify({ case: "grow" })]);
  check(
    "C2 checkpoint on an obligated channel without ledger.md BLOCKS",
    blocked.code !== 0 && blocked.stderr.includes(ledgerIn(dir)),
    `code=${blocked.code} ${blocked.stderr.trim()}`,
  );
  const missionAfterBlock = JSON.parse(fs.readFileSync(path.join(dir, "mission.json"), "utf8"));
  check("C3 blocked checkpoint wrote no checkpoint (state unchanged)", missionAfterBlock.checkpoint === null);
  writeLedger(dir, "C-grow");
  const allowed = run(["checkpoint", dir, "--by", "la", "--json", JSON.stringify({ case: "grow" })]);
  check(
    "C4 checkpoint passes once ledger.md exists, with no ledger field",
    allowed.code === 0 && allowed.out?.mission?.checkpoint?.case === "grow" && !hasLedgerField(allowed.stdout),
    `code=${allowed.code} ${allowed.stdout.slice(0, 160)}`,
  );
}

/* --------- D: STALE warns at 15 newer posts, clears after touching --------- */
{
  const dir = path.join(TMP, "D-stale");
  writeLedger(dir, "D-stale");
  const init = run(initArgs(dir, M6, ["--max-rounds", "25"]));
  check("D1 init with a fresh 6-seat ledger is allowed", init.code === 0 && !hasLedgerField(init.stdout), `code=${init.code}`);
  for (let index = 0; index < 5; index += 1) {
    post(dir, "cv", ["*"]);
    post(dir, "la", ["lb"]);
    post(dir, "lb", ["la"]);
  }
  const warned = run(["checkpoint", dir, "--by", "la", "--json", JSON.stringify({ case: "stale" })]);
  check(
    "D2 checkpoint with 15 substantive posts after ledger mtime WARNS without blocking",
    warned.code === 0 &&
      warned.out?.mission?.checkpoint?.case === "stale" &&
      warned.out?.ledger?.status === "stale" &&
      warned.out?.ledger?.obligated === true &&
      warned.stderr.includes("WARN"),
    `code=${warned.code} ledger=${JSON.stringify(warned.out?.ledger)}`,
  );
  check(
    "D3 stale output keys are the baseline plus the documented ledger field",
    JSON.stringify(keysOf(warned.out)) === JSON.stringify(["ok", "mission", "ledger"]),
    JSON.stringify(keysOf(warned.out)),
  );
  writeLedger(dir, "D-stale-touched"); // touch: fresh mtime after the posts
  const cleared = run(["checkpoint", dir, "--by", "la", "--json", JSON.stringify({ case: "fresh" })]);
  check(
    "D4 warning clears after touching ledger.md (no ledger field, no WARN)",
    cleared.code === 0 && cleared.out?.mission?.checkpoint?.case === "fresh" && !hasLedgerField(cleared.stdout) && !cleared.stderr.includes("WARN"),
    `code=${cleared.code} stderr=${cleared.stderr.trim()}`,
  );
}

/* -------- E: legacy channel.json (no ledgerPolicy) warns, never blocks ----- */
{
  const dir = path.join(TMP, "E-legacy-8");
  writeLedger(dir, "E-legacy-8");
  const fixture = run(initArgs(dir, M8));
  check("E1 fixture channel (8 seats, ledger present) initializes", fixture.code === 0, `code=${fixture.code}`);

  // Rebuild the fixture as a pre-existing legacy channel: the field did not
  // exist in old channel.json files, and no ledger was ever written.
  const channelFile = path.join(dir, "channel.json");
  const legacy = JSON.parse(fs.readFileSync(channelFile, "utf8"));
  delete legacy.ledgerPolicy;
  fs.writeFileSync(channelFile, JSON.stringify(legacy, null, 2));
  fs.unlinkSync(ledgerIn(dir));
  const before = JSON.parse(fs.readFileSync(channelFile, "utf8"));
  check(
    "E2 legacy fixture has 8 seats, no ledgerPolicy and no ledger.md",
    before.members.length === 8 && !Object.prototype.hasOwnProperty.call(before, "ledgerPolicy") && !fs.existsSync(ledgerIn(dir)),
  );
  const jobId = before.supervisor.jobId;
  const marker = before.supervisor.marker;

  const init = run(initArgs(dir, M8));
  check(
    "E3 legacy init (obligated, no ledger) SUCCEEDS with a warning, never blocks",
    init.code === 0 && init.out?.ledger?.status === "missing" && init.out?.ledger?.policy === "legacy" && init.stderr.includes("WARN"),
    `code=${init.code} ledger=${JSON.stringify(init.out?.ledger)}`,
  );
  const afterInit = JSON.parse(fs.readFileSync(channelFile, "utf8"));
  check(
    "E4 legacy channel.json keeps NO ledgerPolicy key (absent preserved verbatim)",
    !Object.prototype.hasOwnProperty.call(afterInit, "ledgerPolicy"),
    JSON.stringify(afterInit.ledgerPolicy),
  );
  check(
    "E5 init output is the baseline plus the documented ledger warn only",
    JSON.stringify(keysOf(init.out)) === JSON.stringify(["ok", "channelId", "dir", "members", "state", "mission", "budgets", "supervisor", "ledger"]),
    JSON.stringify(keysOf(init.out)),
  );

  const checkpoint = run(["checkpoint", dir, "--by", "la", "--json", JSON.stringify({ case: "legacy" })]);
  check(
    "E6 legacy checkpoint SUCCEEDS with a warning (mission updated)",
    checkpoint.code === 0 && checkpoint.out?.mission?.checkpoint?.case === "legacy" && checkpoint.out?.ledger?.status === "missing" && checkpoint.stderr.includes("WARN"),
    `code=${checkpoint.code} ledger=${JSON.stringify(checkpoint.out?.ledger)}`,
  );
  check(
    "E7 legacy checkpoint output is the baseline plus the documented ledger warn only",
    JSON.stringify(keysOf(checkpoint.out)) === JSON.stringify(["ok", "mission", "ledger"]),
    JSON.stringify(keysOf(checkpoint.out)),
  );

  const lease = run(["lease", dir, "--by", "cv", "--owner", "lb", "--handoff-ref", "handoff-legacy"]);
  check(
    "E8 legacy lease SUCCEEDS with a warning (owner rebound)",
    lease.code === 0 && lease.out?.mission?.ownerId === "lb" && lease.out?.ledger?.status === "missing" && lease.stderr.includes("WARN"),
    `code=${lease.code} ledger=${JSON.stringify(lease.out?.ledger)}`,
  );

  const close = run(["close", dir, "--by", "cv"]);
  check(
    "E9 legacy close SUCCEEDS with a warning (never blocked)",
    close.code === 0 && close.out?.state === "closed" && close.out?.ledger?.status === "missing" && close.stderr.includes("WARN"),
    `code=${close.code} ledger=${JSON.stringify(close.out?.ledger)}`,
  );

  const finalChannel = JSON.parse(fs.readFileSync(channelFile, "utf8"));
  check(
    "E10 legacy jobId and marker bytes are identical after init/checkpoint/lease/close",
    finalChannel.supervisor.jobId === jobId && finalChannel.supervisor.marker === marker,
    `jobId=${finalChannel.supervisor.jobId} marker=${finalChannel.supervisor.marker}`,
  );
  check("E11 legacy ledger.md was never auto-created", !fs.existsSync(ledgerIn(dir)));
}

/* ------- F: parallel heavy and light missions in one sandbox do not --------- */
{
  const heavy = path.join(TMP, "F-heavy");
  const light = path.join(TMP, "F-light");
  const heavyBlocked = run(initArgs(heavy, M6));
  const lightInit = run(initArgs(light, M4, ["--max-rounds", "25"]));
  check("F1 heavy (6 seats, no ledger) blocks while light (4 seats) initializes", heavyBlocked.code !== 0 && lightInit.code === 0);
  check(
    "F2 the blocked heavy mission left the light mission untouched (policy 1, no ledger field, no ledger.md)",
    JSON.parse(fs.readFileSync(path.join(light, "channel.json"), "utf8")).ledgerPolicy === 1 &&
      !hasLedgerField(lightInit.stdout) &&
      !fs.existsSync(ledgerIn(light)),
  );
  writeLedger(heavy, "F-heavy");
  const heavyInit = run(initArgs(heavy, M6, ["--max-rounds", "25"]));
  check("F3 heavy initializes once its own ledger exists", heavyInit.code === 0 && !hasLedgerField(heavyInit.stdout), `code=${heavyInit.code}`);
  const senders = [["cv", ["*"]], ["la", ["lb"]], ["lb", ["la"]], ["p1", ["la"]]];
  for (let index = 0; index < 5; index += 1) for (const [from, to] of senders) post(light, from, to);
  const lightBlocked = run(["checkpoint", light, "--by", "la", "--json", JSON.stringify({ case: "light" })]);
  check(
    "F4 light (4 seats, 20 posts, no ledger) blocks on checkpoint independent of the heavy ledger",
    lightBlocked.code !== 0 && lightBlocked.stderr.includes(ledgerIn(light)) && !lightBlocked.stderr.includes(heavy),
    `code=${lightBlocked.code} ${lightBlocked.stderr.trim()}`,
  );
  const heavyCheckpoint = run(["checkpoint", heavy, "--by", "la", "--json", JSON.stringify({ case: "heavy" })]);
  check(
    "F5 heavy's fresh ledger keeps its checkpoint clean while light is blocked",
    heavyCheckpoint.code === 0 && !hasLedgerField(heavyCheckpoint.stdout) && !heavyCheckpoint.stderr.includes("WARN"),
    `code=${heavyCheckpoint.code} stderr=${heavyCheckpoint.stderr.trim()}`,
  );
  writeLedger(light, "F-light");
  const lightAllowed = run(["checkpoint", light, "--by", "la", "--json", JSON.stringify({ case: "light" })]);
  check(
    "F6 light passes after its own ledger exists; the two ledgers stay separate files",
    lightAllowed.code === 0 &&
      !hasLedgerField(lightAllowed.stdout) &&
      fs.readFileSync(ledgerIn(heavy), "utf8").includes("F-heavy") &&
      fs.readFileSync(ledgerIn(light), "utf8").includes("F-light"),
    `code=${lightAllowed.code}`,
  );
}

/* ------- G: mutation test — no-op the threshold and the suite must FAIL ---- */
if (process.env.PASEO_TEAM_LEDGER_MUTATION_CHILD !== "1") {
  const mutantDir = path.join(TMP, "G-mutant");
  fs.mkdirSync(mutantDir, { recursive: true });
  const source = fs.readFileSync(TOOL, "utf8");
  const needle = "const obligated = members >= LEDGER_MIN_MEMBERS || substantive >= LEDGER_MIN_SUBSTANTIVE;";
  const mutantSource = source.replace(needle, "const obligated = false; // MUTATION: threshold no-op'd");
  check(
    "G1 mutant source produced: threshold replaced by a no-op in a COPY of channel.mjs",
    source.includes(needle) && mutantSource !== source && !mutantSource.includes(needle),
  );
  fs.writeFileSync(path.join(mutantDir, "channel.mjs"), mutantSource);
  fs.copyFileSync(fileURLToPath(import.meta.url), path.join(mutantDir, "test-ledger-enforcement.mjs"));
  let mutant = { code: 0, stdout: "", stderr: "" };
  try {
    mutant.stdout = execFileSync("node", [path.join(mutantDir, "test-ledger-enforcement.mjs")], {
      encoding: "utf8",
      env: { ...CHILD_ENV, PASEO_TEAM_LEDGER_MUTATION_CHILD: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    mutant = { code: error.status ?? 1, stdout: error.stdout?.toString() ?? "", stderr: error.stderr?.toString() ?? "" };
  }
  const mutantLog = mutant.stdout + mutant.stderr;
  check(
    "G2 mutated suite FAILS (non-zero exit): enforcement is real, not cosmetic",
    mutant.code !== 0 && mutantLog.includes("FAIL"),
    `code=${mutant.code} tail=${mutantLog.trim().split("\n").slice(-3).join(" | ")}`,
  );
  const firstFail = mutantLog.split("\n").find((line) => line.startsWith("FAIL ")) || "";
  check(
    "G3 the first mutant FAIL is a block/warn case that the no-op disabled",
    /^FAIL (B|C|D|E)/.test(firstFail),
    `first=${firstFail}`,
  );
  check(
    "G4 source channel.mjs was never modified by the mutation test",
    fs.readFileSync(TOOL, "utf8") === source,
  );
}

/* ---------------------- final crontab safety check --------------------- */
const CRON_AFTER = supervisorCronLineCount();
check(
  `CRONTAB paseo-team-supervisor lines unchanged (before=${CRON_BEFORE}, after=${CRON_AFTER})`,
  CRON_AFTER === CRON_BEFORE,
  `real crontab line count moved ${CRON_BEFORE} -> ${CRON_AFTER}`,
);

console.log(`\ntest-ledger-enforcement.mjs: ${passed} passed, ${failed} failed  (sandbox ${SANDBOX})`);
process.exit(failed ? 1 : 0);
