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

test('all Firebase compat scripts use one pinned release', () => {
  assert.match(html, /firebasejs\\/12\\.19\\.0\\/firebase-app-compat\\.js/);
  assert.match(html, /firebasejs\\/12\\.19\\.0\\/firebase-auth-compat\\.js/);
  assert.match(html, /firebasejs\\/12\\.19\\.0\\/firebase-database-compat\\.js/);
});

test('room codes contain exactly three dice', () => {
  assert.ok(source.includes('function makeRoomCode(){return Array.from({length:3},randomDie).join(\'\')}'));
  assert.ok(source.includes("function roomCodeValid(code){return typeof code==='string'&&/^[1-6]{3}$/.test(code);}"));
});

test('the game protocol locks a turn and commits sequence, event and snapshot together', () => {
  assert.ok(source.includes('function processRollRequest(request,requestId)'));
  assert.ok(source.includes('state.turnToken!==request.turnToken'));
  assert.ok(source.includes('state.processing={requestId'));
  assert.ok(source.includes("room.events[String(seq).padStart(12,'0')]=event"));
  assert.ok(source.includes('room.state={status:\'started\',seq,players:'));
});

test('dice requests are validated against the local deterministic physics simulation', () => {
  assert.ok(source.includes('function validRollRequest(request,requestId)'));
  assert.ok(source.includes('simulateDiceResult(request.launchState)===roll'));
  assert.ok(source.includes('roll<1||roll>6'));
});

test('connection recovery, event gap recovery and listener disposal are implemented', () => {
  assert.ok(source.includes("ref('.info/connected')"));
  assert.ok(source.includes('function restoreRoomConnection()'));
  assert.ok(source.includes('function recoverRoomSnapshot()'));
  assert.ok(source.includes('function stopRoomListeners()'));
});

test('critical network functions are declared exactly once', () => {
  for (const name of ['ensureAuth','createRoom','joinRoom','watchRoomState','processRollRequest','makeNetSnapshot','applyNetSnapshot','leaveNetworkSetup']) {
    const matches = [...source.matchAll(new RegExp('function\\\\s+' + name + '\\\\s*\\\\(', 'g'))];
    assert.equal(matches.length, 1, name + ' should be declared once');
  }
});
