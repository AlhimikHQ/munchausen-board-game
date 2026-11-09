'use strict';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const CLOSED_ROOM_GRACE_MS = HOUR_MS;
/* Комната удаляется на клиенте через onDisconnect().remove(), как только создатель вышел.
   Ниже — страховка на случай, если обработчик не успел зарегистрироваться или сервер его не выполнил. */
const DISCONNECTED_HOST_TTL_MS = 5 * MINUTE_MS;
const IDLE_ROOM_TTL_MS = 30 * MINUTE_MS;

function timestamp(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function shouldDeleteRoom(room, now = Date.now()) {
  if (!room || typeof room !== 'object' || !room.meta || typeof room.meta !== 'object') {
    return true;
  }

  const meta = room.meta;
  if (Number(meta.schema) !== 3 || typeof meta.hostUid !== 'string' || !meta.hostUid) {
    return true;
  }

  const createdAt = timestamp(meta.createdAt);
  const updatedAt = timestamp(meta.updatedAt) || createdAt;
  if (meta.status === 'closed') {
    const closedAt = updatedAt || createdAt;
    return closedAt > 0 && now - closedAt >= CLOSED_ROOM_GRACE_MS;
  }

  if (meta.status !== 'lobby' && meta.status !== 'started') {
    return true;
  }

  const host = room.members && room.members[meta.hostUid];
  const lastSeenAt = timestamp(host && host.lastSeenAt) || updatedAt || createdAt;
  if (!host || host.connected === false) {
    return lastSeenAt > 0 && now - lastSeenAt >= DISCONNECTED_HOST_TTL_MS;
  }

  return lastSeenAt > 0 && now - lastSeenAt >= IDLE_ROOM_TTL_MS;
}

module.exports = {
  MINUTE_MS,
  HOUR_MS,
  DAY_MS,
  CLOSED_ROOM_GRACE_MS,
  DISCONNECTED_HOST_TTL_MS,
  IDLE_ROOM_TTL_MS,
  shouldDeleteRoom
};
