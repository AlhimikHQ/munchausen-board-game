"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");

initializeApp();

const CLOSED_ROOM_RETENTION_MS = 10 * 60 * 1000;
const ABANDONED_ROOM_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Removes closed lobbies and games whose host presence has been offline
 * for more than 24 hours. Presence is written by Realtime Database
 * onDisconnect(), so it also works when a device loses power or the app dies.
 */
exports.cleanupAbandonedRooms = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "UTC",
    region: "europe-west1",
    retryCount: 2
  },
  async () => {
    const roomsRef = getDatabase().ref("rooms");
    const snapshot = await roomsRef.get();
    const now = Date.now();
    const removals = {};

    snapshot.forEach((roomSnapshot) => {
      const room = roomSnapshot.val() || {};
      const state = room.state || {};
      const host = room.members && room.members[room.hostUid];
      const closedAt = Number(state.closedAt || 0);
      const lastActivityAt = Number(state.lastActivityAt || room.createdAt || 0);

      const closedAndExpired =
        state.status === "closed" &&
        closedAt > 0 &&
        now - closedAt >= CLOSED_ROOM_RETENTION_MS;

      const hostGoneAndExpired =
        host &&
        host.online === false &&
        lastActivityAt > 0 &&
        now - lastActivityAt >= ABANDONED_ROOM_RETENTION_MS;

      if (closedAndExpired || hostGoneAndExpired) {
        removals[roomSnapshot.key] = null;
      }
    });

    const roomCodes = Object.keys(removals);
    if (roomCodes.length) {
      await roomsRef.update(removals);
    }

    logger.info("Room cleanup completed", {
      scanned: snapshot.numChildren(),
      removed: roomCodes.length
    });
  }
);
