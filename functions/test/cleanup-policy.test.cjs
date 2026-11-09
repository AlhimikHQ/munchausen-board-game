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
      createdAt: NOW - 20_000,
      updatedAt: NOW - 20_000,
      ...overrides.meta
    },
    members: {
      'host-uid': {
        name: 'Host',
        connected: true,
        lastSeenAt: NOW - 20_000,
        ...overrides.host
      }
    }
  };
}

test('a connected room with a recent host heartbeat is retained', () => {
  assert.equal(shouldDeleteRoom(room(), NOW), false);
});

test('a room whose host is marked offline survives only a short grace period', () => {
  const fresh = room({ host: { connected: false, lastSeenAt: NOW - DISCONNECTED_HOST_TTL_MS + 1 } });
  assert.equal(shouldDeleteRoom(fresh, NOW), false);
  const expired = room({ host: { connected: false, lastSeenAt: NOW - DISCONNECTED_HOST_TTL_MS } });
  assert.equal(shouldDeleteRoom(expired, NOW), true);
});

test('the grace period for an offline host is minutes, not days', () => {
  assert.ok(DISCONNECTED_HOST_TTL_MS <= 10 * 60 * 1000);
  assert.ok(IDLE_ROOM_TTL_MS <= 60 * 60 * 1000);
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
