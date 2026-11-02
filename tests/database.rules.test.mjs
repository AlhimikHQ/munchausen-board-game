import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, get, set, update, runTransaction } from 'firebase/database';

const projectId = 'demo-munchausen';
const roomPath = 'rooms/123';
let env;

function fixture(status = 'started') {
  const now = 1700000000000;
  return {
    meta: { schema: 3, hostUid: 'host-1', status, maxPlayers: 3, createdAt: now, updatedAt: now },
    slots: {
      0: { uid: 'host-1', seat: 0, joinedAt: now },
      1: { uid: 'player-1', seat: 1, joinedAt: now }
    },
    members: {
      'host-1': { name: 'Host', ready: true, seat: 0, joinedAt: now, connected: true, lastSeenAt: now },
      'player-1': { name: 'Player 1', ready: true, seat: 1, joinedAt: now, connected: true, lastSeenAt: now },
      'player-2': { name: 'Player 2', ready: false, seat: 2, joinedAt: now, connected: true, lastSeenAt: now }
    },
    settings: { playerCount: 3, colors: ['#e02020', '#1e5bff', '#1faa3c'], updatedAt: now },
    state: { status, seq: 0, activeUid: 'player-1', turnToken: 'turn-0-player-1', processing: null, snapshot: {} },
    events: {},
    requests: {}
  };
}

async function seedRoom(path = roomPath, data = fixture()) {
  await env.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), path), data);
  });
}

function memberDb(uid = 'player-1') {
  return env.authenticatedContext(uid).database();
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    database: {
      host: '127.0.0.1',
      port: 9000,
      rules: fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')
    }
  });
});

beforeEach(async () => {
  await env.clearDatabase();
  await seedRoom();
});

after(async () => {
  if (env) await env.cleanup();
});

test('unauthenticated clients cannot enumerate rooms', async () => {
  const db = env.unauthenticatedContext().database();
  await assertFails(get(ref(db, roomPath + '/meta')));
  await assertFails(get(ref(db, roomPath)));
});

test('authenticated non-members can see room metadata, not private room state', async () => {
  const db = env.authenticatedContext('intruder').database();
  await assertSucceeds(get(ref(db, roomPath + '/meta')));
  await assertFails(get(ref(db, roomPath)));
  await assertFails(get(ref(db, roomPath + '/members')));
  await assertFails(get(ref(db, roomPath + '/settings')));
  await assertFails(get(ref(db, roomPath + '/state')));
  await assertFails(get(ref(db, roomPath + '/events')));
  await assertFails(get(ref(db, roomPath + '/requests')));
});

test('a member can read the shared board and member list', async () => {
  const db = memberDb();
  await assertSucceeds(get(ref(db, roomPath + '/members')));
  await assertSucceeds(get(ref(db, roomPath + '/settings')));
  await assertSucceeds(get(ref(db, roomPath + '/state')));
  await assertSucceeds(get(ref(db, roomPath + '/events')));
});

test('members cannot modify another player or write authoritative state directly', async () => {
  const db = memberDb();
  await assertFails(update(ref(db, roomPath + '/members/player-2'), { ready: true }));
  await assertFails(set(ref(db, roomPath + '/state/seq'), 99));
  await assertFails(set(ref(db, roomPath + '/events/000000000001'), { seq: 1 }));
});

test('a member can update their own ready state and colour, but not another seat', async () => {
  const db = memberDb();
  await assertSucceeds(update(ref(db, roomPath + '/members/player-1'), { ready: false }));
  await assertSucceeds(set(ref(db, roomPath + '/settings/colors/1'), '#aabbcc'));
  await assertFails(set(ref(db, roomPath + '/settings/colors/0'), '#aabbcc'));
});

test('only the active player can submit a request for the current turn', async () => {
  const db = memberDb();
  const numericState = Array.from({ length: 24 }, () => 0);
  const request = {
    requestId: 'req-1', uid: 'player-1', roll: 4, turnToken: 'turn-0-player-1',
    launchState: numericState, diceState: numericState, createdAt: 1700000000000
  };
  await assertSucceeds(set(ref(db, roomPath + '/requests/req-1'), request));
  await assertFails(set(ref(db, roomPath + '/requests/req-2'), { ...request, requestId: 'req-2', uid: 'player-2' }));
  await assertFails(set(ref(db, roomPath + '/requests/req-3'), { ...request, requestId: 'req-3', turnToken: 'stale-token' }));
  await assertFails(set(ref(db, roomPath + '/requests/req-4'), { ...request, requestId: 'req-4', roll: 7 }));
  await assertFails(get(ref(db, roomPath + '/requests')));
});

test('concurrent seat transactions cannot allocate the same slot twice', async () => {
  const initial = fixture('lobby');
  initial.members = { 'host-1': initial.members['host-1'] };
  initial.slots = { 0: initial.slots[0] };
  initial.state = { status: 'lobby', seq: 0, activeUid: '', turnToken: '', processing: null, snapshot: {} };
  await seedRoom('rooms/124', initial);
  const claim = async uid => {
    const db = env.authenticatedContext(uid).database();
    return runTransaction(ref(db, 'rooms/124/slots/1'), current => {
      if (current !== null) return;
      return { uid, seat: 1, joinedAt: 1700000000001 };
    });
  };
  const results = await Promise.allSettled([claim('guest-a'), claim('guest-b')]);
  const winners = results.filter(result => result.status === 'fulfilled' && result.value.committed);
  assert.equal(winners.length, 1);
});
