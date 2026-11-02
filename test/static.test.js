"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("docs/index.html", "utf8");
const rules = JSON.parse(fs.readFileSync("database.rules.json", "utf8"));
const gradle = fs.readFileSync("android/app/build.gradle", "utf8");
const workflow = fs.readFileSync(".github/workflows/android.yml", "utf8");

test("inline game JavaScript parses", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, "expected exactly one inline game script");
  assert.doesNotThrow(() => new vm.Script(scripts[0][1], { filename: "docs/index.html" }));
});

test("Firebase SDK is pinned to the audited compat release", () => {
  assert.match(html, /firebase-app-compat\.js/);
  assert.match(html, /firebase-auth-compat\.js/);
  assert.match(html, /firebase-database-compat\.js/);
  assert.match(html, /gstatic\.com\/firebasejs\/13\.1\.0\//);
  assert.match(html, /\.info\/connected/);
  assert.match(html, /onDisconnect\(\)\.set\(false\)/);
});

test("room code remains three dice and lobby approval is implemented", () => {
  assert.match(html, /function makeRoomCode\(\)\{return Array\.from\(\{length:3\}/);
  assert.match(html, /joinRequests/);
  assert.match(html, /approveRoomRequest/);
  assert.match(html, /waitForMembership/);
});

test("game-state commits use a transaction and ordered state snapshots", () => {
  assert.match(html, /stateRef\.transaction\(/);
  assert.match(html, /lastEvent:event/);
  assert.match(html, /syncFromAuthoritativeState/);
  assert.match(html, /applyNetSnapshot\(st\.snapshot\)/);
});

test("Firebase rules deny world reads and scope room reads to members", () => {
  assert.equal(rules.rules[".read"], false);
  assert.equal(rules.rules[".write"], false);
  assert.match(rules.rules.rooms["$roomCode"][".read"], /members/);
});

test("Android version and CI compile/test tasks are present", () => {
  assert.match(gradle, /versionCode\s+3/);
  assert.match(gradle, /versionName\s+'1\.2'/);
  assert.match(workflow, /npm run test/);
  assert.match(workflow, /assembleDebug/);
});
