'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CLOSED_ROOM_GRACE_MS,
  DISCONNECTED_HOST_TTL_MS,
  IDLE_ROOM_TTL_MS,
  shouldDeleteRoom
} = require('../cleanup-policy.cjs');

const NOW = 2_000_000_000_000;
function room(overrides = {}) {
  return {
    meta: {
      schema: 3,
      hostUid: 'host-uid',
      status: 'lobby',
      createdAt: NOW - 60_000,
      updatedAt: NOW - 60_000,
      ...overrides.meta
    },
    members: {
      'host-uid': {
        name: 'Host',
        connected: true,
        lastSeenAt: NOW - 60_000,
        ...overrides.host
      }
    }
  };
}

test('a connected room with a recent host heartbeat is retained', () => {
  assert.equal(shouldDeleteRoom(room(), NOW), false);
});

test('a recently disconnected host receives the reconnect grace period', () => {
  const value = room({ host: { connected: false, lastSeenAt: NOW - DISCONNECTED_HOST_TTL_MS + 1 } });
  assert.equal(shouldDeleteRoom(value, NOW), false);
});

test('a room is deleted after its host has been offline for 24 hours', () => {
  const value = room({ host: { connected: false, lastSeenAt: NOW - DISCONNECTED_HOST_TTL_MS } });
  assert.equal(shouldDeleteRoom(value, NOW), true);
});

test('a room with a stale heartbeat is deleted even if the presence flag is stale', () => {
  const value = room({ host: { connected: true, lastSeenAt: NOW - IDLE_ROOM_TTL_MS } });
  assert.equal(shouldDeleteRoom(value, NOW), true);
});

test('an explicitly closed room is retained for its grace period, then deleted', () => {
  const value = room({ meta: { status: 'closed', updatedAt: NOW - CLOSED_ROOM_GRACE_MS + 1 } });
  assert.equal(shouldDeleteRoom(value, NOW), false);
  value.meta.updatedAt = NOW - CLOSED_ROOM_GRACE_MS;
  assert.equal(shouldDeleteRoom(value, NOW), true);
});

test('rooms from old or malformed schemas are removed', () => {
  assert.equal(shouldDeleteRoom(null, NOW), true);
  assert.equal(shouldDeleteRoom({ meta: { schema: 2, hostUid: 'host-uid' } }, NOW), true);
});
