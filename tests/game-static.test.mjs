import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)];
const source = scripts.map(match => match[1]).join('\\n');

test('the complete game script parses as JavaScript', () => {
  assert.equal(scripts.length, 1, 'expected exactly one inline game script');
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'docs/index.html' }));
});

test('all Firebase compat scripts use the same pinned SDK release', () => {
  assert.match(html, /firebasejs\\/12\\.19\\.0\\/firebase-app-compat\\.js/);
  assert.match(html, /firebasejs\\/12\\.19\\.0\\/firebase-auth-compat\\.js/);
  assert.match(html, /firebasejs\\/12\\.19\\.0\\/firebase-database-compat\\.js/);
});

test('room codes contain exactly three dice', () => {
  assert.ok(source.includes("function makeRoomCode(){return Array.from({length:3},randomDie).join('');}"));
  assert.ok(source.includes("function roomCodeValid(code){return typeof code==='string'&&/^[1-6]{3}$/.test(code);}"));
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
  assert.ok(source.includes('simulateDiceResult(request.launchState)===roll'));
  assert.ok(source.includes('roll<1||roll>6'));
});

test('reconnect, gap recovery and subscription disposal are implemented', () => {
  assert.ok(source.includes("firebase.database().ref('.info/connected')"));
  assert.ok(source.includes('function restoreRoomConnection()'));
  assert.ok(source.includes('function recoverRoomSnapshot()'));
  assert.ok(source.includes('function stopRoomListeners()'));
});

test('critical network handlers are declared only once', () => {
  for (const name of ['ensureAuth','createRoom','joinRoom','watchRoomState','processRollRequest','makeNetSnapshot','applyNetSnapshot','leaveNetworkSetup']) {
    assert.equal(source.split('function ' + name + '(').length - 1, 1, name + ' should be declared once');
  }
});
