"use strict";

const CLOSED_ROOM_RETENTION_MS = 10 * 60 * 1000;
const ABANDONED_ROOM_RETENTION_MS = 24 * 60 * 60 * 1000;
const JOIN_REQUEST_RETENTION_MS = 10 * 60 * 1000;

function shouldRemoveRoom(room, now = Date.now()) {
  if (!room) return false;
  const state = room.state || {};
  const host = room.members && room.members[room.hostUid];
  const closedAt = Number(state.closedAt || 0);
  const lastActivityAt = Number(state.lastActivityAt || room.createdAt || 0);

  const closedAndExpired =
    state.status === "closed" &&
    (!closedAt || now - closedAt >= CLOSED_ROOM_RETENTION_MS);

  const hostGoneAndExpired =
    host &&
    host.online === false &&
    lastActivityAt > 0 &&
    now - lastActivityAt >= ABANDONED_ROOM_RETENTION_MS;

  return Boolean(closedAndExpired || hostGoneAndExpired);
}

function expiredJoinRequestKeys(joinRequests, now = Date.now()) {
  if (!joinRequests || typeof joinRequests !== "object") return [];
  return Object.entries(joinRequests)
    .filter(([, request]) => {
      const createdAt = Number((request || {}).createdAt || 0);
      return createdAt > 0 && now - createdAt >= JOIN_REQUEST_RETENTION_MS;
    })
    .map(([uid]) => uid);
}

module.exports = {
  CLOSED_ROOM_RETENTION_MS,
  ABANDONED_ROOM_RETENTION_MS,
  JOIN_REQUEST_RETENTION_MS,
  shouldRemoveRoom,
  expiredJoinRequestKeys
};
