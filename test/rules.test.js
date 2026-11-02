"use strict";

import test from "node:test";
import fs from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from "@firebase/rules-unit-testing";
import { ref, get, set, update } from "firebase/database";

const projectId = "demo-munchausen-board-game";
let env;

const makeRoom = (overrides = {}) => ({
  hostUid: "host",
  maxPlayers: 3,
  createdAt: Date.now(),
  settings: { playerCount: 3 },
  members: {
    host: {
      name: "Host", seat: 0, ready: true, online: true,
      color: "#e02020", joinedAt: Date.now()
    }
  },
  state: {
    status: "lobby", seq: 0, turnUid: null,
    snapshot: null, lastActivityAt: Date.now()
  },
  ...overrides
});

async function seedRoom(room = makeRoom(), code = "123") {
  await env.withSecurityRulesDisabled(async (context) => {
    await set(ref(context.database(), "rooms/" + code), room);
  });
}

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    database: {
      host: "127.0.0.1",
      port: 9000,
      rules: fs.readFileSync("database.rules.json", "utf8")
    }
  });
});

test.afterEach(async () => {
  await env.clearDatabase();
});

test.after(async () => {
  await env.cleanup();
});

test("unauthenticated and non-member clients cannot read a room", async () => {
  await seedRoom();
  const anonymous = env.unauthenticatedContext().database();
  const intruder = env.authenticatedContext("intruder").database();
  await assertFails(get(ref(anonymous, "rooms/123")));
  await assertFails(get(ref(intruder, "rooms/123")));
  await assertFails(get(ref(intruder, "rooms/123/state")));
});

test("joining is a request; a requester can read only their own request", async () => {
  await seedRoom();
  const guest = env.authenticatedContext("guest").database();
  await assertSucceeds(set(ref(guest, "rooms/123/joinRequests/guest"), {
    name: "Guest", createdAt: Date.now()
  }));
  await assertSucceeds(get(ref(guest, "rooms/123/joinRequests/guest")));
  await assertFails(get(ref(guest, "rooms/123/members")));
  await assertFails(get(ref(guest, "rooms/123/state")));
  await assertFails(set(ref(guest, "rooms/123/joinRequests/other"), {
    name: "Impersonated", createdAt: Date.now()
  }));
});

test("host can approve a player; a member can read the admitted room", async () => {
  await seedRoom();
  const host = env.authenticatedContext("host").database();
  const guest = env.authenticatedContext("guest").database();
  await assertSucceeds(set(ref(guest, "rooms/123/joinRequests/guest"), {
    name: "Guest", createdAt: Date.now()
  }));
  await assertSucceeds(set(ref(host, "rooms/123/members"), {
    host: { name: "Host", seat: 0, online: true, ready: true, color: "#e02020" },
    guest: { name: "Guest", seat: 1, ready: false, online: true, color: "#1e5bff", joinedAt: Date.now() }
  }));
  await assertSucceeds(get(ref(guest, "rooms/123/state")));
  await assertSucceeds(get(ref(guest, "rooms/123/members")));
  await assertFails(get(ref(guest, "rooms/123")));
  await assertFails(get(ref(guest, "rooms/123/requests")));
  await assertFails(get(ref(guest, "rooms/123/joinRequests/other")));
});

test("a room cannot be overfilled by join requests", async () => {
  await seedRoom(makeRoom({
    maxPlayers: 2,
    settings: { playerCount: 2 },
    members: {
      host: { name: "Host", seat: 0, online: true },
      guest: { name: "Guest", seat: 1, online: true }
    }
  }));
  const intruder = env.authenticatedContext("intruder").database();
  await assertFails(set(ref(intruder, "rooms/123/joinRequests/intruder"), {
    name: "Intruder", createdAt: Date.now()
  }));
});

test("only the host can commit game state or append authoritative events", async () => {
  await seedRoom(makeRoom({
    members: {
      host: { name: "Host", seat: 0, online: true },
      guest: { name: "Guest", seat: 1, online: true }
    },
    state: {
      status: "started", seq: 0, turnUid: "host",
      snapshot: { version: 3 }, lastActivityAt: Date.now()
    }
  }));
  const host = env.authenticatedContext("host").database();
  const guest = env.authenticatedContext("guest").database();
  await assertSucceeds(update(ref(host, "rooms/123/state"), {
    seq: 1, snapshot: { version: 3 }, turnUid: "guest"
  }));
  await assertFails(update(ref(guest, "rooms/123/state"), {
    seq: 2, turnUid: "guest"
  }));
  await assertSucceeds(set(ref(host, "rooms/123/events/1"), {
    seq: 1, type: "roll", roll: 4
  }));
  await assertFails(set(ref(guest, "rooms/123/events/2"), {
    seq: 2, type: "roll", roll: 5
  }));
});

test("a player may submit only their own valid request on their turn", async () => {
  await seedRoom(makeRoom({
    members: {
      host: { name: "Host", seat: 0, online: true },
      guest: { name: "Guest", seat: 1, online: true },
      other: { name: "Other", seat: 2, online: true }
    },
    state: {
      status: "started", seq: 0, turnUid: "guest",
      snapshot: { version: 3 }, lastActivityAt: Date.now()
    }
  }));
  const guest = env.authenticatedContext("guest").database();
  const host = env.authenticatedContext("host").database();
  const other = env.authenticatedContext("other").database();
  const fakeState = Array.from({ length: 24 }, (_, i) => i === 9 || i === 13 || i === 17 ? 1 : 0);
  const request = {
    uid: "guest", roll: 4,
    launchState: fakeState, diceState: fakeState,
    createdAt: Date.now()
  };
  await assertSucceeds(set(ref(guest, "rooms/123/requests/request-1"), request));
  await assertSucceeds(set(ref(host, "rooms/123/requests/request-1"), null));
  await assertFails(set(ref(other, "rooms/123/requests/request-2"), request));
  await assertFails(set(ref(guest, "rooms/123/requests/request-3"), { ...request, uid: "host" }));
  await assertFails(set(ref(guest, "rooms/123/requests/request-4"), { ...request, roll: 7 }));
});

test("members can update only their own presence, readiness and color", async () => {
  await seedRoom(makeRoom({
    members: {
      host: { name: "Host", seat: 0, online: true, ready: true, color: "#e02020" },
      guest: { name: "Guest", seat: 1, online: true, ready: false, color: "#1e5bff" }
    }
  }));
  const guest = env.authenticatedContext("guest").database();
  await assertSucceeds(set(ref(guest, "rooms/123/members/guest/ready"), true));
  await assertSucceeds(set(ref(guest, "rooms/123/members/guest/online"), false));
  await assertSucceeds(set(ref(guest, "rooms/123/members/guest/color"), "#12c4c4"));
  await assertFails(set(ref(guest, "rooms/123/members/host/ready"), false));
  await assertFails(set(ref(guest, "rooms/123/members/host/color"), "#000000"));
});

test("requesters can delete rejected or expired requests but not active requests", async () => {
  await seedRoom();
  const guest = env.authenticatedContext("guest").database();
  const host = env.authenticatedContext("host").database();
  const requestPath = "rooms/123/joinRequests/guest";
  await assertSucceeds(set(ref(guest, requestPath), {
    name: "Guest", createdAt: Date.now()
  }));
  await assertSucceeds(set(ref(guest, requestPath), null));
  await assertSucceeds(update(ref(host, requestPath), { status: "rejected" }));
  await assertSucceeds(set(ref(guest, requestPath), null));
  await assertSucceeds(set(ref(guest, requestPath), {
    name: "Guest", createdAt: Date.now() - 120000
  }));
  await assertSucceeds(set(ref(guest, requestPath), null));
});

test("only a current member can take over an offline host", async () => {
  await seedRoom(makeRoom({
    members: {
      host: { name: "Host", seat: 0, online: false },
      guest: { name: "Guest", seat: 1, online: true }
    }
  }));
  const guest = env.authenticatedContext("guest").database();
  const outsider = env.authenticatedContext("outsider").database();
  await assertSucceeds(set(ref(guest, "rooms/123/hostUid"), "guest"));
  await assertFails(set(ref(outsider, "rooms/123/hostUid"), "outsider"));
});

test("room creation is an atomic write; active rooms cannot be overwritten", async () => {
  const owner = env.authenticatedContext("owner").database();
  const outsider = env.authenticatedContext("outsider").database();
  await assertSucceeds(set(ref(owner, "rooms/456"), makeRoom({
    hostUid: "owner",
    members: {
      owner: { name: "Owner", seat: 0, ready: false, online: false, color: "#e02020" }
    }
  })));
  await assertSucceeds(get(ref(owner, "rooms/456/state")));
  await assertFails(set(ref(outsider, "rooms/123"), makeRoom({
    hostUid: "outsider",
    members: {
      outsider: { name: "Outsider", seat: 0, online: true }
    }
  })));
  const host = env.authenticatedContext("host").database();
  await assertFails(set(ref(host, "rooms/123"), makeRoom()));
});

test("host child updates remain allowed but guests cannot promote themselves", async () => {
  await seedRoom(makeRoom({
    members: {
      host: { name: "Host", seat: 0, online: true },
      guest: { name: "Guest", seat: 1, online: true }
    }
  }));
  const host = env.authenticatedContext("host").database();
  const guest = env.authenticatedContext("guest").database();
  await assertSucceeds(set(ref(host, "rooms/123/state"), {
    status: "started", seq: 0, turnUid: "host", snapshot: { version: 3 }
  }));
  await assertFails(set(ref(guest, "rooms/123/state"), {
    status: "started", seq: 0, turnUid: "guest", snapshot: { version: 3 }
  }));
});
