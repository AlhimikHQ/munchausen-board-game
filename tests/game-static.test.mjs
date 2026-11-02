import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const scriptStart = html.indexOf('<script>');
const scriptEnd = html.lastIndexOf('</script>');
assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, 'inline game script must exist');
const source = html.slice(scriptStart + '<script>'.length, scriptEnd);

test('the complete game script parses as JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'docs/index.html' }));
});

test('all Firebase compat scripts use the same pinned SDK release', () => {
  for (const asset of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-database-compat.js']) {
    assert.ok(html.includes('firebasejs/13.1.0/' + asset), asset + ' must be version pinned');
  }
});

test('Firebase failures are visible in the game instead of only the WebView console', () => {
  assert.ok(source.includes('function showRoomToast(message'));
  assert.ok(source.includes('function reportFirebase(context,error)'));
  assert.ok(source.includes("target.on(event,callback,onError)"));
  assert.ok(source.includes("reportFirebase('Не удалось отправить ход в Firebase',e)"));
  assert.ok(source.includes("firebase.database().goOnline()"));
});

test('Android release APKs keep a stable signer and receive increasing version codes', () => {
  const gradle = fs.readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
  const workflow = fs.readFileSync(new URL('../.github/workflows/android.yml', import.meta.url), 'utf8');
  assert.ok(gradle.includes('versionCode generatedVersionCode'));
  assert.ok(gradle.includes('1000 + githubRunNumber'));
  assert.ok(gradle.includes('signingConfig signingConfigs.release'));
  assert.ok(workflow.includes('ANDROID_KEYSTORE_BASE64'));
  assert.ok(workflow.includes('assembleRelease'));
  assert.ok(workflow.includes('app-release.apk'));
});


test('room codes contain exactly three dice', () => {
  assert.ok(source.includes("function makeRoomCode(){return Array.from({length:3},randomDie).join('');}"));
  assert.ok(source.includes("function roomCodeValid(code){return typeof code==='string'&&/^[1-6]{3}$/.test(code);}"));
});

test('host room transactions retry when the local Firebase cache initially returns null', () => {
  assert.ok(source.includes('function roomTransaction(updateFn)'));
  assert.ok(source.includes('current=>current===null?null:updateFn(current)'));
  assert.equal((source.match(/roomTransaction\(/g) || []).length, 6);
  assert.ok(!source.includes('roomRef.transaction('));
});

test('the turn pipeline locks a turn and commits event, snapshot and sequence atomically', () => {
  assert.ok(source.includes('function processRollRequest(request,requestId)'));
  assert.ok(source.includes('state.turnToken!==request.turnToken'));
  assert.ok(source.includes('state.processing={requestId,uid:request.uid,turnToken:request.turnToken,claimedAt:Date.now()}'));
  assert.ok(source.includes("room.events[String(seq).padStart(12,'0')]=event"));
  assert.ok(source.includes("room.state={status:'started',seq,players:"));
});

test('untrusted dice requests are checked against the deterministic physics simulation', () => {
  assert.ok(source.includes('function validRollRequest(request,requestId)'));
  assert.ok(source.includes('const simulated=simulateDiceState(request.launchState);'));
  assert.ok(source.includes('Math.abs(value-simulated.state[index])<=1e-5'));
  assert.ok(source.includes('roll<1||roll>6'));
});

test('reconnect, gap recovery and subscription disposal are implemented', () => {
  assert.ok(source.includes("firebase.database().ref('.info/connected')"));
  assert.ok(source.includes('function restoreRoomConnection()'));
  assert.ok(source.includes('function recoverRoomSnapshot()'));
  assert.ok(source.includes('function recoverStaleProcessingLock()'));
  assert.ok(source.includes('function scheduleSnapshotRecovery()'));
  assert.ok(source.includes('function stopRoomListeners()'));
  assert.ok(source.includes('function startPresenceHeartbeat()'));
  assert.ok(source.includes("hostPresence.onDisconnect().update({connected:false,ready:false,lastSeenAt:firebase.database.ServerValue.TIMESTAMP})"));
  assert.ok(!source.includes('roomRef.onDisconnect().remove()'));
  assert.ok(!source.includes('ref.onDisconnect().remove()'));
});

test('critical network handlers are declared only once', () => {
  for (const name of ['ensureAuth','createRoom','joinRoom','watchRoomState','processRollRequest','makeNetSnapshot','applyNetSnapshot','leaveNetworkSetup']) {
    assert.equal(source.split('function ' + name + '(').length - 1, 1, name + ' should be declared once');
  }
});
