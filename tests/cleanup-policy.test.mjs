import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  CLOSED_ROOM_GRACE_MS,
  DISCONNECTED_HOST_TTL_MS,
  IDLE_ROOM_TTL_MS,
  shouldDeleteRoom
} = require('../functions/cleanup-policy.cjs');
const functionSource = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const NOW = 2_000_000_000_000;

function makeRoom(meta = {}, host = {}) {
  return {
    meta: { schema: 3, hostUid: 'host-uid', status: 'lobby', createdAt: NOW - 60_000, updatedAt: NOW - 60_000, ...meta },
    members: { 'host-uid': { connected: true, lastSeenAt: NOW - 60_000, ...host } }
  };
}

test('scheduled room cleanup function parses and targets the configured RTDB region', () => {
  assert.doesNotThrow(() => new vm.Script(functionSource, { filename: 'functions/index.js' }));
  assert.match(functionSource, /onSchedule/);
  assert.match(functionSource, /europe-west1/);
  assert.match(functionSource, /roomsRef\.update\(updates\)/);
});

test('a healthy room with a current host heartbeat is preserved', () => {
  assert.equal(shouldDeleteRoom(makeRoom(), NOW), false);
});

test('a host disconnect gets a one-day recovery window', () => {
  assert.equal(shouldDeleteRoom(makeRoom({}, { connected: false, lastSeenAt: NOW - DISCONNECTED_HOST_TTL_MS + 1 }), NOW), false);
  assert.equal(shouldDeleteRoom(makeRoom({}, { connected: false, lastSeenAt: NOW - DISCONNECTED_HOST_TTL_MS }), NOW), true);
});

test('the cleanup also expires a stale presence heartbeat and closed room', () => {
  assert.equal(shouldDeleteRoom(makeRoom({}, { connected: true, lastSeenAt: NOW - IDLE_ROOM_TTL_MS }), NOW), true);
  assert.equal(shouldDeleteRoom(makeRoom({ status: 'closed', updatedAt: NOW - CLOSED_ROOM_GRACE_MS }), NOW), true);
});

test('invalid and pre-v3 rooms are eligible for cleanup', () => {
  assert.equal(shouldDeleteRoom(null, NOW), true);
  assert.equal(shouldDeleteRoom(makeRoom({ schema: 2 }), NOW), true);
});
