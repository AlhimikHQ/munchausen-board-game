"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");

initializeApp();

const CLOSED_ROOM_RETENTION_MS = 10 * 60 * 1000;
const ABANDONED_ROOM_RETENTION_MS = 24 * 60 * 60 * 1000;
const JOIN_REQUEST_RETENTION_MS = 10 * 60 * 1000;

/**
 * Deletes closed/abandoned rooms and expires unapproved join requests.
 * Realtime Database onDisconnect presence markers are the source of truth
 * for an unexpectedly disconnected host.
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
    const updates = {};
    let removedRooms = 0;
    let removedRequests = 0;

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
        updates[roomSnapshot.key] = null;
        removedRooms += 1;
        return;
      }

      const requests = roomSnapshot.child("joinRequests");
      requests.forEach((requestSnapshot) => {
        const createdAt = Number((requestSnapshot.val() || {}).createdAt || 0);
        if (createdAt > 0 && now - createdAt >= JOIN_REQUEST_RETENTION_MS) {
          updates[roomSnapshot.key + "/joinRequests/" + requestSnapshot.key] = null;
          removedRequests += 1;
        }
      });
    });

    if (Object.keys(updates).length) {
      await roomsRef.update(updates);
    }

    logger.info("Room cleanup completed", {
      scanned: snapshot.numChildren(),
      removedRooms,
      removedRequests
    });
  }
);
