#!/usr/bin/env node
/**
 * test-ledger-path.mjs — proves the FROZEN ledger-path contract of the team
 * channel (Node >= 18, built-ins only, no real Paseo agents).
 *
 * FROZEN CONTRACT
 *   ledger.md = $PASEO_HOME/team-channels/v1/<encodeURIComponent(workspaceId)>/
 *               <encodeURIComponent(missionSlug)>/ledger.md
 *   missionSlug === channelId
 * i.e. the ledger lives in the SAME folder as the team chat, that folder is
 * valid before any channel exists, and no channel read path may read the file.
 *
 * Required-case map: without-channel = C1, with-channel = C2, parallel missions = C5, channel
 * folder predating the ledger = C6 (ledgerPolicy: 1). The true no-policy over-threshold legacy
 * channel is owned by section E of assets/channel/test-ledger-enforcement.mjs — not duplicated here.
 * Cases (every assertion prints its case label):
 *   C1 channel-less mission folder: `path` resolves it, it can exist holding only
 *      ledger.md, and every channel command fails cleanly without corrupting it.
 *   C2 a later global `init` into that same folder is additive: ledger.md survives
 *      byte-for-byte next to channel.json, messages/, receipts/, rules.md,
 *      mission.json and supervisor/.
 *   C3 no read path reads the ledger: a unique marker in ledger.md appears in NONE
 *      of sync/mission/status/threads/rounds/pending/inbox/unread/wake/read --all/
 *      permit/help, and `sync` stdout is byte-identical with and without ledger.md.
 *   C4 adding ledger.md to an existing channel leaves the persisted supervisor
 *      marker (cron job id) in channel.json unchanged.
 *   C5 parallel missions: two distinct mission slugs coexist side by side.
 *   C6 pre-ledger channel folder (ledgerPolicy: 1 — a policy channel, NOT the
 *      no-ledgerPolicy legacy case): the folder and its channel.json exist before any
 *      ledger.md is written; adding ledger.md afterwards is inert — every pre-existing
 *      file untouched, sync stdout byte-identical, persisted supervisor marker/jobId
 *      unchanged, never echoed, and the channel still works (checkpoint succeeds). The
 *      tree/channel.json/marker comparisons run after sync and again after the
 *      checkpoint, i.e. after channel commands ran with ledger.md present. The true
 *      no-ledgerPolicy over-threshold legacy channel is owned by section E of
 *      assets/channel/test-ledger-enforcement.mjs (not duplicated here).
 *
 * Safety: every child process runs with PASEO_HOME pointed at a fresh os.tmpdir()
 * sandbox and PASEO_TEAM_DISABLE_SUPERVISOR_JOB=1, so the real ~/.paseo and the
 * real crontab are never written. The suite reads `crontab -l` before and after
 * and fails if the user's paseo-team-supervisor line count changed.
 *
 * Run:  node test-ledger-path.mjs
 * Exit 0 = all green. Any failure prints FAIL with its case label and exits 1.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), "channel.mjs");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "team-ledger-path-test-"));
const SANDBOX = path.join(TMP, "paseo-home");
fs.mkdirSync(SANDBOX, { recursive: true });

// Safety first: pin the suite (and every child) to the sandbox before any command.
process.env.PASEO_HOME = SANDBOX;
process.env.PASEO_TEAM_DISABLE_SUPERVISOR_JOB = "1";
const CHILD_ENV = { ...process.env, PASEO_HOME: SANDBOX, PASEO_TEAM_DISABLE_SUPERVISOR_JOB: "1" };
const REAL_HOME = path.join(os.homedir(), ".paseo");

const WS = "wks_9802ec713dd55c52";
const SLUG_A = "mission-ledger-alpha";
const SLUG_B = "mission beta/2"; // exercises encodeURIComponent on the mission slug
const SLUG_C = "mission-ledger-marker";
const SLUG_D = "mission-preledger-channel";
const MEMBERS = JSON.stringify([
  { agentId: "cv-1", role: "supervisor" },
  { agentId: "tq-a", role: "lead" },
  { agentId: "ln-a1", role: "peer", parent: "tq-a" },
]);
const MARKER_A = "paseo-ledger-path-marker-7f3a9c2e5b1d4a8f";
const MARKER_B = "paseo-ledger-path-marker-1a2b3c4d5e6f7a8b";
const MARKER_C = "paseo-ledger-path-marker-9c0f1e2d3b4a5c6d";
const ledgerBody = (marker) =>
  [
    "# Mission ledger",
    "",
    `marker: ${marker}`,
    "Lead-authored durable notes. channel.mjs must never read, copy or echo this file.",
    "",
  ].join("\n");

/** The frozen formula, written out literally — never derived from channel.mjs. */
const missionDir = (workspaceId, missionSlug) =>
  path.join(SANDBOX, "team-channels", "v1", encodeURIComponent(workspaceId), encodeURIComponent(missionSlug));
const ledgerIn = (dir) => path.join(dir, "ledger.md");

/** Content-addressed tree snapshot: relative path -> sha256, directories -> "dir". */
function snapshotTree(rootDir) {
  const out = new Map();
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.set(`${rel}/`, "dir");
        walk(abs, rel);
      } else {
        out.set(rel, crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex"));
      }
    }
  };
  walk(rootDir, "");
  return out;
}

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

/** Run a channel.mjs subcommand in the sandbox; raw stdout is kept for byte checks. */
function run(args) {
  try {
    const stdout = execFileSync("node", [TOOL, ...args], { encoding: "utf8", env: CHILD_ENV });
    return { code: 0, out: parse(stdout), stdout, stderr: "" };
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : error.stdout?.toString() ?? "";
    const stderr = typeof error.stderr === "string" ? error.stderr : error.stderr?.toString() ?? "";
    return { code: error.status ?? 1, out: parse(stdout), stdout, stderr };
  }
}
function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text.trim();
  }
}

/** A missing crontab counts as zero lines; any real regression shows up as a changed count. */
function supervisorCronLineCount() {
  try {
    return execFileSync("crontab", ["-l"], { encoding: "utf8" })
      .split(/\r?\n/)
      .filter((line) => line.includes("paseo-team-supervisor")).length;
  } catch {
    return 0;
  }
}
const CRON_BEFORE = supervisorCronLineCount();

/* ------------------------------ C0 guards ------------------------------ */
check(
  "C0 suite pins PASEO_HOME to a fresh os.tmpdir sandbox for every child",
  CHILD_ENV.PASEO_HOME === SANDBOX && SANDBOX.startsWith(os.tmpdir()) && SANDBOX !== REAL_HOME,
  `sandbox=${SANDBOX}`,
);
check(
  "C0 suite disables the supervisor job so the real crontab is never written",
  CHILD_ENV.PASEO_TEAM_DISABLE_SUPERVISOR_JOB === "1",
);

/* ---------- C1: channel-less mission folder owns ledger.md ------------- */
const DIR_A = missionDir(WS, SLUG_A);
const LEDGER_A = ledgerIn(DIR_A);
{
  const resolved = run(["path", "--channel-id", SLUG_A, "--workspace-id", WS]);
  check(
    "C1 path resolves the frozen folder before any channel exists",
    resolved.code === 0 && resolved.out.ok === true && resolved.out.dir === DIR_A,
    `code=${resolved.code} out=${JSON.stringify(resolved.out)}`,
  );
  check(
    "C1 path uses encodeURIComponent(workspaceId)/encodeURIComponent(missionSlug)",
    resolved.out.dir ===
      path.join(SANDBOX, "team-channels", "v1", encodeURIComponent(WS), encodeURIComponent(SLUG_A)) &&
      path.basename(resolved.out.dir) === encodeURIComponent(SLUG_A),
    String(resolved.out.dir),
  );
  check("C1 path reports the sandbox paseo home", resolved.out.paseoHome === SANDBOX, String(resolved.out.paseoHome));
  check(
    "C1 missionSlug equals channelId",
    resolved.out.channelId === SLUG_A,
    String(resolved.out.channelId),
  );
  check("C1 the channel-less folder does not exist yet", !fs.existsSync(DIR_A));

  fs.mkdirSync(DIR_A, { recursive: true });
  fs.writeFileSync(LEDGER_A, ledgerBody(MARKER_A));
  check(
    "C1 channel-less mission folder can hold only ledger.md",
    JSON.stringify(fs.readdirSync(DIR_A).sort()) === JSON.stringify(["ledger.md"]),
    fs.readdirSync(DIR_A).join(","),
  );
  check("C1 ledger.md carries the unique marker", fs.readFileSync(LEDGER_A, "utf8").includes(MARKER_A));

  const channelCommands = [
    ["mission", DIR_A],
    ["status", DIR_A],
    ["threads", DIR_A],
    ["pending", DIR_A],
    ["sync", DIR_A, "tq-a"],
    ["rounds", DIR_A, "tq-a"],
    ["inbox", DIR_A, "tq-a"],
    ["unread", DIR_A, "tq-a"],
    ["wake", DIR_A, "tq-a"],
    ["post", DIR_A, JSON.stringify({ from: "tq-a", to: ["cv-1"], kind: "info", body: "no channel here" })],
    ["close", DIR_A, "--by", "cv-1"],
  ];
  for (const args of channelCommands) {
    const r = run(args);
    check(
      `C1 ${args[0]} on a channel-less mission fails cleanly`,
      r.code !== 0 && /no channel at/.test(r.stderr),
      `code=${r.code} stderr=${r.stderr.trim()}`,
    );
  }
  check(
    "C1 failed commands left ledger.md untouched",
    fs.readFileSync(LEDGER_A, "utf8") === ledgerBody(MARKER_A),
  );
  check(
    "C1 failed commands created nothing else in the mission folder",
    JSON.stringify(fs.readdirSync(DIR_A).sort()) === JSON.stringify(["ledger.md"]),
    fs.readdirSync(DIR_A).join(","),
  );
}

/* ------ C2: later init is additive and preserves ledger.md ------------- */
{
  const init = run(["init", "--channel-id", SLUG_A, "--workspace-id", WS, "--by", "cv-1", "--members", MEMBERS]);
  check(
    "C2 global init into the channel-less mission folder succeeds",
    init.code === 0 && init.out.ok === true,
    `code=${init.code} ${JSON.stringify(init.out)}`,
  );
  check(
    "C2 init writes into the frozen folder (missionSlug equals channelId)",
    init.out.dir === DIR_A && init.out.channelId === SLUG_A,
    `dir=${init.out.dir}`,
  );
  check(
    "C2 existing ledger.md survives init byte-for-byte",
    fs.existsSync(LEDGER_A) && fs.readFileSync(LEDGER_A, "utf8") === ledgerBody(MARKER_A),
  );
  const entries = fs.readdirSync(DIR_A).sort();
  check(
    "C2 channel and ledger coexist in one folder",
    ["channel.json", "ledger.md", "messages", "mission.json", "receipts", "rules.md", "supervisor"].every((name) =>
      entries.includes(name),
    ),
    entries.join(","),
  );
  check(
    "C2 ledger.md lives in the same folder as the team chat",
    path.dirname(LEDGER_A) === path.dirname(path.join(DIR_A, "channel.json")) &&
      LEDGER_A === path.join(init.out.dir, "ledger.md"),
  );
  const channelA = JSON.parse(fs.readFileSync(path.join(DIR_A, "channel.json"), "utf8"));
  check(
    "C2 persisted channelId equals the mission slug",
    channelA.channelId === SLUG_A && channelA.workspaceId === WS,
    `channelId=${channelA.channelId} workspaceId=${channelA.workspaceId}`,
  );
  const resolvedAgain = run(["path", "--channel-id", SLUG_A, "--workspace-id", WS]);
  check("C2 path is stable before and after init", resolvedAgain.out.dir === DIR_A, String(resolvedAgain.out.dir));
  check(
    "C2 init with the job disabled never wrote the user crontab",
    supervisorCronLineCount() === CRON_BEFORE,
    `before=${CRON_BEFORE} after=${supervisorCronLineCount()}`,
  );
}

/* ---------- C3: no read path reads the ledger -------------------------- */
{
  const probes = [
    ["sync", ["sync", DIR_A, "tq-a"]],
    ["mission", ["mission", DIR_A]],
    ["status", ["status", DIR_A]],
    ["threads", ["threads", DIR_A]],
    ["rounds", ["rounds", DIR_A, "tq-a"]],
    ["pending", ["pending", DIR_A]],
    ["inbox", ["inbox", DIR_A, "tq-a"]],
    ["unread", ["unread", DIR_A, "tq-a"]],
    ["wake", ["wake", DIR_A, "tq-a"]],
    ["read --all", ["read", DIR_A, "tq-a", "--all"]],
    ["permit", ["permit", DIR_A, "tq-a", "cv-1"]],
    ["help", ["help"]],
  ];
  for (const [name, args] of probes) {
    const r = run(args);
    check(
      `C3 ${name} never reads ledger.md (marker absent from all output)`,
      r.code === 0 && !r.stdout.includes(MARKER_A) && !r.stderr.includes(MARKER_A),
      `code=${r.code}${r.stderr ? ` stderr=${r.stderr.trim()}` : ""}`,
    );
  }

  const syncWithLedger = run(["sync", DIR_A, "tq-a"]);
  const held = path.join(TMP, "held-ledger.md");
  fs.renameSync(LEDGER_A, held);
  const syncWithoutLedger = run(["sync", DIR_A, "tq-a"]);
  fs.renameSync(held, LEDGER_A);

  const bytesWith = Buffer.byteLength(syncWithLedger.stdout, "utf8");
  const bytesWithout = Buffer.byteLength(syncWithoutLedger.stdout, "utf8");
  check(
    `C3 sync output byte length identical with ledger.md (${bytesWith}) and without (${bytesWithout})`,
    syncWithLedger.code === 0 && syncWithoutLedger.code === 0 && bytesWith === bytesWithout,
  );
  check(
    "C3 sync stdout is byte-identical in both runs",
    syncWithLedger.stdout === syncWithoutLedger.stdout,
  );
  check(
    "C3 ledger.md restored intact after the byte-length probe",
    fs.existsSync(LEDGER_A) && fs.readFileSync(LEDGER_A, "utf8") === ledgerBody(MARKER_A),
  );
}

/* ---- C4: adding ledger.md must not change the persisted cron marker --- */
const DIR_C = missionDir(WS, SLUG_C);
{
  const initC = run(["init", "--channel-id", SLUG_C, "--workspace-id", WS, "--by", "cv-1", "--members", MEMBERS]);
  const channelFile = path.join(DIR_C, "channel.json");
  const channelBytesBefore = fs.readFileSync(channelFile, "utf8");
  const before = JSON.parse(channelBytesBefore);
  const expectedJobId = crypto
    .createHash("sha256")
    .update(`${DIR_C}\0${SLUG_C}`)
    .digest("hex")
    .slice(0, 16);
  check(
    "C4 channel starts with the frozen supervisor marker for this folder",
    initC.code === 0 &&
      before.supervisor?.marker === `# paseo-team-supervisor:${expectedJobId}` &&
      before.supervisor?.jobId === expectedJobId,
    String(before.supervisor?.marker),
  );

  fs.writeFileSync(ledgerIn(DIR_C), ledgerBody(MARKER_A));
  check(
    "C4 adding ledger.md does not rewrite channel.json",
    fs.readFileSync(channelFile, "utf8") === channelBytesBefore,
  );

  const reinit = run(["init", "--channel-id", SLUG_C, "--workspace-id", WS, "--by", "cv-1", "--members", MEMBERS]);
  const after = JSON.parse(fs.readFileSync(channelFile, "utf8"));
  check(
    "C4 re-init with ledger.md present preserves the supervisor marker and cron job id",
    reinit.code === 0 &&
      reinit.out.dir === DIR_C &&
      after.supervisor?.marker === before.supervisor?.marker &&
      after.supervisor?.jobId === before.supervisor?.jobId,
    `marker=${after.supervisor?.marker} jobId=${after.supervisor?.jobId}`,
  );
  check(
    "C4 ledger.md coexists with the persisted channel after re-init",
    fs.readFileSync(ledgerIn(DIR_C), "utf8") === ledgerBody(MARKER_A),
  );
}

/* ---------- C5: parallel missions do not interfere --------------------- */
const DIR_B = missionDir(WS, SLUG_B);
{
  check(
    "C5 second mission slug encodes to its own sibling folder",
    DIR_B !== DIR_A && path.basename(DIR_B) === encodeURIComponent(SLUG_B) && path.dirname(DIR_B) === path.dirname(DIR_A),
    DIR_B,
  );
  const initB = run(["init", "--channel-id", SLUG_B, "--workspace-id", WS, "--by", "cv-1", "--members", MEMBERS]);
  check(
    "C5 parallel mission initializes beside the first mission",
    initB.code === 0 && initB.out.dir === DIR_B,
    `code=${initB.code} dir=${initB.out.dir}`,
  );
  fs.writeFileSync(ledgerIn(DIR_B), ledgerBody(MARKER_B));
  const channelB = JSON.parse(fs.readFileSync(path.join(DIR_B, "channel.json"), "utf8"));
  check(
    "C5 missionSlug equals channelId for the second mission",
    channelB.channelId === SLUG_B && path.basename(DIR_B) === encodeURIComponent(channelB.channelId),
    `channelId=${channelB.channelId}`,
  );
  const ledgerA = fs.readFileSync(LEDGER_A, "utf8");
  const ledgerB = fs.readFileSync(ledgerIn(DIR_B), "utf8");
  check(
    "C5 each mission keeps its own ledger without cross-contamination",
    ledgerA.includes(MARKER_A) && !ledgerA.includes(MARKER_B) && ledgerB.includes(MARKER_B) && !ledgerB.includes(MARKER_A),
  );
  const syncA = run(["sync", DIR_A, "tq-a"]);
  const syncB = run(["sync", DIR_B, "tq-a"]);
  check(
    "C5 mission A reads only its own channel",
    syncA.code === 0 && syncA.stdout.includes(SLUG_A) && !syncA.stdout.includes(SLUG_B),
    `code=${syncA.code}`,
  );
  check(
    "C5 mission B reads only its own channel and never mission A's ledger",
    syncB.code === 0 &&
      syncB.stdout.includes(SLUG_B) &&
      !syncB.stdout.includes(SLUG_A) &&
      !syncB.stdout.includes(MARKER_A) &&
      !syncB.stderr.includes(MARKER_A),
    `code=${syncB.code}`,
  );
}

/* ------- C6: pre-ledger channel folder (ledgerPolicy: 1, not no-policy) ------- */
const DIR_D = missionDir(WS, SLUG_D);
{
  const initLegacy = run(["init", "--channel-id", SLUG_D, "--workspace-id", WS, "--by", "cv-1", "--members", MEMBERS]);
  const channelFile = path.join(DIR_D, "channel.json");
  check(
    "C6 pre-ledger channel folder is created before any ledger.md exists",
    initLegacy.code === 0 && initLegacy.out.dir === DIR_D && !fs.existsSync(ledgerIn(DIR_D)),
    `code=${initLegacy.code} dir=${initLegacy.out.dir}`,
  );
  run(["post", DIR_D, JSON.stringify({ from: "cv-1", to: ["tq-a"], kind: "info", body: "pre-ledger channel active before ledger" })]);
  const preLedger = snapshotTree(DIR_D);
  const channelBytesBefore = fs.readFileSync(channelFile, "utf8");
  const channelBefore = JSON.parse(channelBytesBefore);
  check(
    "C6 pre-ledger channel has a non-empty persisted supervisor marker and jobId before any ledger",
    typeof channelBefore.supervisor?.marker === "string" &&
      channelBefore.supervisor.marker.length > 0 &&
      typeof channelBefore.supervisor?.jobId === "string" &&
      channelBefore.supervisor.jobId.length > 0,
    `marker=${String(channelBefore.supervisor?.marker)} jobId=${String(channelBefore.supervisor?.jobId)}`,
  );
  // C6 pins its scope: this is a ledgerPolicy: 1 policy channel, NOT the no-policy
  // legacy case. The true no-ledgerPolicy over-threshold legacy channel is owned by
  // section E of assets/channel/test-ledger-enforcement.mjs (not duplicated here).
  check(
    "C6 pre-ledger channel carries ledgerPolicy: 1 (policy channel, not the no-policy legacy case)",
    Object.prototype.hasOwnProperty.call(channelBefore, "ledgerPolicy") && channelBefore.ledgerPolicy === 1,
    `ledgerPolicy=${JSON.stringify(channelBefore.ledgerPolicy)}`,
  );
  const syncBefore = run(["sync", DIR_D, "tq-a"]);

  fs.writeFileSync(ledgerIn(DIR_D), ledgerBody(MARKER_C));

  const postWrite = snapshotTree(DIR_D);
  const addedByWrite = [...postWrite.keys()].filter((rel) => !preLedger.has(rel));
  check(
    "C6 the raw ledger.md write adds only ledger.md to the pre-ledger channel tree",
    addedByWrite.length === 1 && addedByWrite[0] === "ledger.md",
    `added=${addedByWrite.join(",")}`,
  );

  // The three "untouched" comparisons run AFTER a channel command (sync) has
  // executed with ledger.md present, so a code path that mutates the channel
  // whenever a ledger exists can actually fail them.
  const syncAfter = run(["sync", DIR_D, "tq-a"]);
  const postSync = snapshotTree(DIR_D);
  const addedAfterSync = [...postSync.keys()].filter((rel) => !preLedger.has(rel));
  check(
    "C6 after sync with ledger.md present: every pre-existing file is untouched",
    [...preLedger.entries()].every(([rel, hash]) => postSync.get(rel) === hash) &&
      addedAfterSync.length === 1 &&
      addedAfterSync[0] === "ledger.md",
    `added=${addedAfterSync.join(",")}`,
  );
  check(
    "C6 after sync with ledger.md present: channel.json bytes unchanged",
    fs.readFileSync(channelFile, "utf8") === channelBytesBefore,
  );
  const channelAfterSync = JSON.parse(fs.readFileSync(channelFile, "utf8"));
  check(
    "C6 after sync with ledger.md present: supervisor marker and jobId unchanged",
    channelAfterSync.supervisor?.marker === channelBefore.supervisor.marker &&
      channelAfterSync.supervisor?.jobId === channelBefore.supervisor.jobId,
    `marker=${String(channelAfterSync.supervisor?.marker)} jobId=${String(channelAfterSync.supervisor?.jobId)}`,
  );

  const bytesBefore = Buffer.byteLength(syncBefore.stdout, "utf8");
  const bytesAfter = Buffer.byteLength(syncAfter.stdout, "utf8");
  check(
    `C6 pre-ledger sync stdout byte-identical before (${bytesBefore}) and after (${bytesAfter}) ledger.md`,
    syncBefore.code === 0 && syncAfter.code === 0 && bytesBefore === bytesAfter && syncBefore.stdout === syncAfter.stdout,
  );

  const preLedgerProbes = [
    ["sync", ["sync", DIR_D, "tq-a"]],
    ["mission", ["mission", DIR_D]],
    ["status", ["status", DIR_D]],
    ["threads", ["threads", DIR_D]],
    ["rounds", ["rounds", DIR_D, "tq-a"]],
    ["pending", ["pending", DIR_D]],
    ["inbox", ["inbox", DIR_D, "tq-a"]],
    ["unread", ["unread", DIR_D, "tq-a"]],
    ["wake", ["wake", DIR_D, "tq-a"]],
    ["read --all", ["read", DIR_D, "tq-a", "--all"]],
    ["permit", ["permit", DIR_D, "tq-a", "cv-1"]],
    ["help", ["help"]],
  ];
  for (const [name, args] of preLedgerProbes) {
    const r = run(args);
    check(
      `C6 pre-ledger ${name} never echoes ledger.md (marker absent from all output)`,
      r.code === 0 && !r.stdout.includes(MARKER_C) && !r.stderr.includes(MARKER_C),
      `code=${r.code}${r.stderr ? ` stderr=${r.stderr.trim()}` : ""}`,
    );
  }

  const preLedgerCheckpoint = run(["checkpoint", DIR_D, "--by", "tq-a", "--json", JSON.stringify({ milestone: "preledger-ledger-added" })]);
  check(
    "C6 pre-ledger channel still works normally after ledger.md (checkpoint succeeds)",
    preLedgerCheckpoint.code === 0 && preLedgerCheckpoint.out.mission?.checkpoint?.milestone === "preledger-ledger-added",
    `code=${preLedgerCheckpoint.code}`,
  );

  // Re-check the same invariants after the checkpoint too: mission.json is the
  // only legitimate change, and `read --all` legitimately adds one receipt file.
  const expectedAdditions = new Set(["ledger.md", "receipts/tq-a.json"]);
  const postCheckpoint = snapshotTree(DIR_D);
  const changedPreexisting = [...preLedger.keys()].filter(
    (rel) => rel !== "mission.json" && postCheckpoint.get(rel) !== preLedger.get(rel),
  );
  const addedAfterCheckpoint = [...postCheckpoint.keys()].filter((rel) => !preLedger.has(rel));
  check(
    "C6 after checkpoint with ledger.md present: pre-existing files untouched (only mission.json updated)",
    changedPreexisting.length === 0 &&
      addedAfterCheckpoint.length === expectedAdditions.size &&
      addedAfterCheckpoint.every((rel) => expectedAdditions.has(rel)),
    `changed=${changedPreexisting.join(",")} added=${addedAfterCheckpoint.join(",")}`,
  );
  check(
    "C6 after checkpoint with ledger.md present: channel.json bytes unchanged",
    fs.readFileSync(channelFile, "utf8") === channelBytesBefore,
  );
  const channelAfterCheckpoint = JSON.parse(fs.readFileSync(channelFile, "utf8"));
  check(
    "C6 after checkpoint with ledger.md present: supervisor marker and jobId unchanged",
    channelAfterCheckpoint.supervisor?.marker === channelBefore.supervisor.marker &&
      channelAfterCheckpoint.supervisor?.jobId === channelBefore.supervisor.jobId,
    `marker=${String(channelAfterCheckpoint.supervisor?.marker)} jobId=${String(channelAfterCheckpoint.supervisor?.jobId)}`,
  );
  check(
    "C6 ledger.md still intact after the checkpoint",
    fs.readFileSync(ledgerIn(DIR_D), "utf8") === ledgerBody(MARKER_C),
  );
}

/* ---------------------- final crontab safety check --------------------- */
const CRON_AFTER = supervisorCronLineCount();
check(
  `CRONTAB paseo-team-supervisor lines unchanged (before=${CRON_BEFORE}, after=${CRON_AFTER})`,
  CRON_AFTER === CRON_BEFORE,
  `real crontab line count moved ${CRON_BEFORE} -> ${CRON_AFTER}`,
);

console.log(`\ntest-ledger-path.mjs: ${passed} passed, ${failed} failed  (sandbox ${SANDBOX})`);
process.exit(failed ? 1 : 0);
