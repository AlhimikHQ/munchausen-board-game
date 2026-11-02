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

test('authenticated non-members can see public metadata but not private room data', async () => {
  const db = env.authenticatedContext('intruder').database();
  await assertSucceeds(get(ref(db, roomPath + '/meta')));
  await assertFails(get(ref(db, roomPath)));
  await assertFails(get(ref(db, roomPath + '/slots/0')));
  await assertFails(get(ref(db, roomPath + '/members')));
  await assertFails(get(ref(db, roomPath + '/settings')));
  await assertFails(get(ref(db, roomPath + '/state')));
  await assertFails(get(ref(db, roomPath + '/events')));
  await assertFails(get(ref(db, roomPath + '/requests')));
});

test('a room can be created by its authenticated host with a valid schema', async () => {
  const db = env.authenticatedContext('host-1').database();
  await assertSucceeds(set(ref(db, roomPath), fixture('lobby')));
  await assertSucceeds(get(ref(db, roomPath + '/state')));
  const invalid = fixture('lobby');
  invalid.settings.playerCount = 5;
  await assertFails(set(ref(db, 'rooms/124'), invalid));
});

test('a user can inspect only their own membership node before joining', async () => {
  const db = env.authenticatedContext('new-player').database();
  await assertSucceeds(get(ref(db, roomPath + '/members/new-player')));
  await assertFails(get(ref(db, roomPath + '/members/player-1')));
  await assertFails(get(ref(db, roomPath + '/members')));
});

test('room members can read the shared board and member list', async () => {
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

test('a member can create only one valid current-turn request under their UID', async () => {
  const db = memberDb();
  const numericState = Array.from({ length: 24 }, () => 0);
  const diceState = numericState.slice();
  diceState[15] = -1; // The top face of the serialized die is four.
  const request = {
    requestId: 'player-1', uid: 'player-1', roll: 4, turnToken: 'turn-0-player-1',
    launchState: numericState, diceState, createdAt: 1700000000000
  };
  await assertFails(set(ref(db, roomPath + '/requests/player-1'), { ...request, turnToken: 'stale-token' }));
  await assertFails(set(ref(db, roomPath + '/requests/player-1'), { ...request, roll: 7 }));
  await assertSucceeds(set(ref(db, roomPath + '/requests/player-1'), request));
  await assertFails(set(ref(db, roomPath + '/requests/player-1'), request));
  await assertFails(set(ref(db, roomPath + '/requests/player-2'), { ...request, requestId: 'player-2' }));
  await assertFails(get(ref(db, roomPath + '/requests')));
});

test('a new authenticated player can claim a free seat and publish membership, presence and readiness', async () => {
  const lobby = fixture('lobby');
  delete lobby.slots[1];
  delete lobby.members['player-1'];
  delete lobby.members['player-2'];
  await seedRoom(roomPath, lobby);

  const db = env.authenticatedContext('guest-new').database();
  const now = 1700000000002;
  const claim = await assertSucceeds(runTransaction(ref(db, roomPath + '/slots/1'), current => {
    if (current !== null) return;
    return { uid: 'guest-new', seat: 1, joinedAt: now };
  }));
  assert.equal(claim.committed, true);

  await assertSucceeds(set(ref(db, roomPath + '/members/guest-new'), {
    name: 'Игрок 2', ready: false, seat: 1, joinedAt: now, connected: true, lastSeenAt: now
  }));
  await assertSucceeds(update(ref(db, roomPath + '/members/guest-new'), {
    connected: true, lastSeenAt: now + 1
  }));
  await assertSucceeds(set(ref(db, roomPath + '/members/guest-new/ready'), true));

  const saved = await assertSucceeds(get(ref(db, roomPath + '/members/guest-new')));
  assert.equal(saved.val().ready, true);
  assert.equal(saved.val().connected, true);
});

test('the host can atomically publish the authoritative game state and event log', async () => {
  const db = env.authenticatedContext('host-1').database();
  const now = 1700000000100;
  const initial = await assertSucceeds(get(ref(db, roomPath)));
  assert.equal(initial.val().meta.hostUid, 'host-1');
  let transactionHostUid = null;
  const result = await assertSucceeds(runTransaction(ref(db, roomPath), current => {
    transactionHostUid = current && current.meta && current.meta.hostUid;
    if (!current || current.meta.hostUid !== 'host-1') return;
    current.state = {
      status: 'started', seq: 1, activeUid: 'player-1', turnToken: 'turn-1',
      processing: null, players: [], snapshot: { version: 3, seq: 1 }, updatedAt: now
    };
    current.events = {
      '000000000001': { seq: 1, type: 'roll', roll: 4, by: 'player-1', createdAt: now }
    };
    current.meta.updatedAt = now;
    return current;
  }));
  assert.equal(transactionHostUid, 'host-1', 'the host transaction must read the seeded room');
  assert.equal(result.committed, true);
  const state = await assertSucceeds(get(ref(db, roomPath + '/state')));
  assert.equal(state.val().seq, 1);
  const events = await assertSucceeds(get(ref(db, roomPath + '/events')));
  assert.equal(events.val()['000000000001'].roll, 4);
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
