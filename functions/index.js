'use strict';

const { getApps, initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const { shouldDeleteRoom } = require('./cleanup-policy.cjs');

const DATABASE_URL = 'https://board-games-n1-default-rtdb.europe-west1.firebasedatabase.app';

if (getApps().length === 0) {
  initializeApp({ databaseURL: DATABASE_URL });
}

exports.cleanupAbandonedRooms = onSchedule({
  schedule: 'every 15 minutes',
  timeZone: 'Etc/UTC',
  region: 'europe-west1',
  maxInstances: 1,
  timeoutSeconds: 540,
  memory: '256MiB'
}, async () => {
  const roomsRef = getDatabase().ref('rooms');
  const rooms = await roomsRef.get();
  const updates = {};
  const now = Date.now();

  rooms.forEach((room) => {
    if (shouldDeleteRoom(room.val(), now)) {
      updates[room.key] = null;
    }
  });

  const roomCodes = Object.keys(updates);
  if (roomCodes.length > 0) {
    await roomsRef.update(updates);
  }

  logger.info('Abandoned room cleanup completed', { deletedRooms: roomCodes.length });
  return { deletedRooms: roomCodes.length };
});
