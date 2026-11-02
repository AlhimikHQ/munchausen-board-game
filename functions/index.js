"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const {
  shouldRemoveRoom,
  expiredJoinRequestKeys
} = require("./cleanup-logic");

initializeApp();

/**
 * Removes closed/abandoned rooms and expires unapproved join requests.
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
      if (shouldRemoveRoom(room, now)) {
        updates[roomSnapshot.key] = null;
        removedRooms += 1;
        return;
      }

      const requests = roomSnapshot.child("joinRequests").val() || {};
      expiredJoinRequestKeys(requests, now).forEach((uid) => {
        updates[roomSnapshot.key + "/joinRequests/" + uid] = null;
        removedRequests += 1;
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
