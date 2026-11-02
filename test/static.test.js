import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync("docs/index.html", "utf8");
const rules = JSON.parse(fs.readFileSync("database.rules.json", "utf8"));
const gradle = fs.readFileSync("android/app/build.gradle", "utf8");
const workflow = fs.readFileSync(".github/workflows/android.yml", "utf8");

test("inline game JavaScript parses", () => {
  const scripts = [...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)];
  assert.equal(scripts.length, 1, "expected exactly one inline game script");
  assert.doesNotThrow(() => new vm.Script(scripts[0][1], { filename: "docs/index.html" }));
});

test("Firebase SDK, auth persistence, connection monitoring and recovery are present", () => {
  assert.match(html, /firebase-app-compat\\.js/);
  assert.match(html, /firebase-auth-compat\\.js/);
  assert.match(html, /firebase-database-compat\\.js/);
  assert.match(html, /gstatic\\.com\\/firebasejs\\/13\\.1\\.0\\//);
  assert.match(html, /Auth\\.Persistence\\.LOCAL/);
  assert.match(html, /\\.info\\/connected/);
  assert.match(html, /onDisconnect\\(\\)\\.set\\(false\\)/);
  assert.match(html, /restoreRoomSession/);
  assert.match(html, /syncFromAuthoritativeState/);
  assert.doesNotMatch(html, /const roomStatus=\\(\\)=>\\{\\}/);
});

test("three-dice room flow uses approval, presence and bounded cleanup", () => {
  assert.match(html, /function makeRoomCode\\(\\)\\{return Array\\.from\\(\\{length:3\\}/);
  assert.match(html, /joinRequests/);
  assert.match(html, /approveRoomRequest/);
  assert.match(html, /waitForMembership/);
  assert.match(html, /offlineAt/);
  assert.match(html, /maybePruneOfflineMembers/);
});

test("game-state writes are transactional and dice values are validated", () => {
  assert.match(html, /stateRef\\.transaction\\(/);
  assert.match(html, /lastEvent:event/);
  assert.match(html, /validNetRoll/);
  assert.match(html, /applyNetSnapshot\\(st\\.snapshot\\)/);
});

test("Firebase rules deny global reads and restrict room membership", () => {
  assert.equal(rules.rules[".read"], false);
  assert.equal(rules.rules[".write"], false);
  assert.match(rules.rules.rooms["$roomCode"][".read"], /members/);
  assert.match(rules.rules.rooms["$roomCode"].requests["$requestId"][".write"], /turnUid/);
});

test("CI runs both Firebase tests and Android lint/build", () => {
  assert.match(gradle, /versionCode\\s+3/);
  assert.match(gradle, /versionName\\s+'1\\.2'/);
  assert.match(workflow, /npm run test:static/);
  assert.match(workflow, /npm run test:rules/);
  assert.match(workflow, /testDebugUnitTest lintDebug assembleDebug/);
});
