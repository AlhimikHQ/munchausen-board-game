import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { shouldRemoveRoom, expiredJoinRequestKeys, CLOSED_ROOM_RETENTION_MS, ABANDONED_ROOM_RETENTION_MS, JOIN_REQUEST_RETENTION_MS } = require("../functions/cleanup-logic.js");

const html = fs.readFileSync("docs/index.html", "utf8");
const rules = JSON.parse(fs.readFileSync("database.rules.json", "utf8"));
const gradle = fs.readFileSync("android/app/build.gradle", "utf8");
const workflow = fs.readFileSync(".github/workflows/android.yml", "utf8");
const functionsSource = fs.readFileSync("functions/index.js", "utf8");

test("inline game JavaScript parses", () => {
  const start = html.indexOf("<script>");
  const end = html.indexOf("</script>", start + 8);
  assert.notEqual(start, -1, "game script tag must exist");
  assert.notEqual(end, -1, "game script closing tag must exist");
  assert.equal(html.indexOf("<script>", end + 9), -1, "expected one inline script");
  assert.doesNotThrow(() => new vm.Script(html.slice(start + 8, end), { filename: "docs/index.html" }));
});

test("Cloud Function source parses", () => {
  assert.doesNotThrow(() => new vm.Script(functionsSource, { filename: "functions/index.js" }));
});

test("Firebase SDK, auth persistence, connection monitoring and recovery are present", () => {
  assert.ok(html.includes("firebase-app-compat.js"));
  assert.ok(html.includes("firebase-auth-compat.js"));
  assert.ok(html.includes("firebase-database-compat.js"));
  assert.ok(html.includes("firebasejs/13.1.0/"));
  assert.ok(html.includes("Auth.Persistence.LOCAL"));
  assert.ok(html.includes(".info/connected"));
  assert.ok(html.includes("onDisconnect().set(false)"));
  assert.ok(html.includes("restoreRoomSession"));
  assert.ok(html.includes("syncFromAuthoritativeState"));
  assert.ok(!html.includes("const roomStatus=()=>{}"));
});

test("three-dice room flow uses approval, presence and bounded cleanup", () => {
  assert.ok(html.includes("Array.from({length:3},randomDie)"));
  assert.ok(html.includes("joinRequests"));
  assert.ok(html.includes("approveRoomRequest"));
  assert.ok(html.includes("waitForMembership"));
  assert.ok(html.includes("offlineAt"));
  assert.ok(html.includes("maybePruneOfflineMembers"));
});

test("game-state writes are transactional and dice values are validated", () => {
  assert.ok(html.includes("stateRef.transaction("));
  assert.ok(html.includes("lastEvent:event"));
  assert.ok(html.includes("validNetRoll"));
  assert.ok(html.includes("applyNetSnapshot(st.snapshot)"));
  assert.ok(html.includes("makeInitialNetSnapshot"));
});

test("Firebase rules deny global reads and restrict room membership", () => {
  assert.equal(rules.rules[".read"], false);
  assert.equal(rules.rules[".write"], false);
  assert.equal(rules.rules.rooms["$roomCode"][".read"], undefined);
  assert.ok(rules.rules.rooms["$roomCode"].state[".read"].includes("members"));
  assert.ok(rules.rules.rooms["$roomCode"].joinRequests[".read"].includes("hostUid"));
  assert.ok(rules.rules.rooms["$roomCode"].requests["$requestId"][".write"].includes("turnUid"));
  assert.ok(rules.rules.rooms["$roomCode"].members[".write"].includes("hostUid"));
});

test("CI runs Firebase emulator tests and Android lint/build", () => {
  assert.ok(gradle.includes("versionCode 3"));
  assert.ok(gradle.includes("versionName '1.2'"));
  assert.ok(workflow.includes("npm run test:static"));
  assert.ok(workflow.includes("npm run test:rules"));
  assert.ok(workflow.includes("testDebugUnitTest lintDebug assembleDebug"));
});

test("cleanup retains active rooms and removes expired closed or abandoned rooms", () => {
  const now = 1_800_000_000_000;
  assert.equal(shouldRemoveRoom({ state: { status: "lobby", lastActivityAt: now } }, now), false);
  assert.equal(shouldRemoveRoom({ state: { status: "closed", closedAt: now } }, now + CLOSED_ROOM_RETENTION_MS - 1), false);
  assert.equal(shouldRemoveRoom({ state: { status: "closed", closedAt: now } }, now + CLOSED_ROOM_RETENTION_MS), true);
  assert.equal(shouldRemoveRoom({
    hostUid: "host",
    createdAt: now - ABANDONED_ROOM_RETENTION_MS,
    members: { host: { online: false } },
    state: { status: "started" }
  }, now), true);
  assert.equal(shouldRemoveRoom({
    hostUid: "host",
    createdAt: now - ABANDONED_ROOM_RETENTION_MS * 2,
    members: { host: { online: true } },
    state: { status: "started" }
  }, now), false);
});

test("cleanup expires only old join requests", () => {
  const now = 9_000_000;
  const requests = {
    old: { createdAt: now - JOIN_REQUEST_RETENTION_MS },
    recent: { createdAt: now - 1000 },
    invalid: { createdAt: 0 }
  };
  assert.deepEqual(expiredJoinRequestKeys(requests, now), ["old"]);
});
