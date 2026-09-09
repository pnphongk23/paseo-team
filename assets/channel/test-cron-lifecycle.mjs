#!/usr/bin/env node
/**
 * Verify global channel storage plus OS-cron lifecycle. Uses a fake crontab
 * executable and never changes the user's real crontab or starts an agent.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TOOL = path.join(import.meta.dirname, "channel.mjs");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "team-cron-lifecycle-test-"));
const PROJECT_DIR = path.join(TMP, "project");
const PASEO_HOME = path.join(TMP, "paseo");
const CRONTAB_FILE = path.join(TMP, "crontab");
const FAKE_CRONTAB = path.join(TMP, "crontab.mjs");
const MEMBERS = JSON.stringify([
  { agentId: "sup", role: "supervisor" },
  { agentId: "lead", role: "lead" },
]);

fs.mkdirSync(PROJECT_DIR, { recursive: true });
fs.writeFileSync(
  FAKE_CRONTAB,
  `#!/usr/bin/env node
import fs from "node:fs";
const file = process.env.FAKE_CRONTAB_FILE;
const op = process.argv[2];
if (op === "-l") {
  if (!fs.existsSync(file)) {
    console.error("no crontab for test");
    process.exit(1);
  }
  process.stdout.write(fs.readFileSync(file, "utf8"));
} else if (op === "-") {
  fs.writeFileSync(file, fs.readFileSync(0, "utf8"));
} else {
  console.error("unexpected crontab operation: " + op);
  process.exit(2);
}
`,
);
fs.chmodSync(FAKE_CRONTAB, 0o755);

const env = {
  ...process.env,
  PASEO_HOME,
  PASEO_TEAM_CRONTAB_BIN: FAKE_CRONTAB,
  FAKE_CRONTAB_FILE: CRONTAB_FILE,
};
function run(args) {
  return JSON.parse(execFileSync("node", [TOOL, ...args], { encoding: "utf8", env }));
}

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const expectedDir = path.join(PASEO_HOME, "team-channels", "v1", "ws-123", "cron-test");
const resolved = run([
  "path",
  "--channel-id",
  "cron-test",
  "--workspace-id",
  "ws-123",
]);
check("path resolves under global Paseo home", resolved.dir === expectedDir, JSON.stringify(resolved));

const created = run([
  "init",
  "--channel-id",
  "cron-test",
  "--workspace-id",
  "ws-123",
  "--by",
  "sup",
  "--members",
  MEMBERS,
  "--paseo-bin",
  "/test/bin/paseo",
]);
const firstCrontab = fs.readFileSync(CRONTAB_FILE, "utf8");
const marker = created.supervisor.marker;
check("init enables global supervisor job by default", created.supervisor.enabled === true);
  check("channel is outside project directory", created.dir === expectedDir && !fs.existsSync(path.join(PROJECT_DIR, ".team")));
  check("channel records global storage identity", created.supervisor.cadence === "*/10 * * * *" && JSON.parse(fs.readFileSync(path.join(expectedDir, "channel.json"), "utf8")).workspaceId === "ws-123");
  const mission = JSON.parse(fs.readFileSync(path.join(expectedDir, "mission.json"), "utf8"));
  check("global init writes durable mission lease", mission.ownerId === "lead" && mission.leaseEpoch === 1);
check("crontab contains the global channel job", firstCrontab.includes(marker) && firstCrontab.includes(expectedDir) && firstCrontab.includes("*/10 * * * *"));
check("cron command is a plain node supervisor", firstCrontab.includes("supervisor.mjs") && firstCrontab.includes("/test/bin/paseo"));

const second = run([
  "init",
  "--channel-id",
  "cron-test",
  "--workspace-id",
  "ws-123",
  "--by",
  "sup",
  "--members",
  MEMBERS,
  "--paseo-bin",
  "/test/bin/paseo",
]);
  const duplicateCrontab = fs.readFileSync(CRONTAB_FILE, "utf8");
  check("global re-init is idempotent", second.dir === expectedDir && duplicateCrontab.split(marker).length - 1 === 1);
  check("global re-init preserves mission lease", JSON.parse(fs.readFileSync(path.join(expectedDir, "mission.json"), "utf8")).missionId === mission.missionId);

const closed = run(["close", expectedDir, "--by", "sup"]);
const finalCrontab = fs.readFileSync(CRONTAB_FILE, "utf8");
check("close removes the global channel job", closed.supervisorJobRemoved === true && !finalCrontab.includes(marker));
check("channel is closed", closed.state === "closed");

console.log(`\ntest-cron-lifecycle.mjs: ${passed} passed, ${failed} failed  (channel at ${expectedDir})`);
process.exit(failed ? 1 : 0);
