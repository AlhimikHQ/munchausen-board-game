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

test('Firebase SDK is pinned and loaded only for multiplayer', () => {
  assert.ok(source.includes("const base='https://www.gstatic.com/firebasejs/13.1.0/';"));
  for (const asset of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-database-compat.js']) {
    assert.ok(source.includes("'" + asset + "'"), asset + ' must be version pinned');
    assert.ok(!html.includes('<script src="https://www.gstatic.com/firebasejs/13.1.0/' + asset), asset + ' must not load at startup');
  }
  assert.ok(source.includes('function loadFirebaseSdk()'));
  assert.ok(source.includes('await loadFirebaseSdk()'));
  assert.ok(!source.includes('const authReady=ensureAuth()'));
});

test('Firebase failures are visible in the game instead of only the WebView console', () => {
  assert.ok(source.includes('function showRoomToast(message'));
  assert.ok(source.includes('function reportFirebase(icon,error)'));
  assert.ok(source.includes("target.on(event,callback,onError)"));
  assert.ok(source.includes("reportFirebase('🎲',e)"));
  assert.ok(source.includes("firebase.database().goOnline()"));
});

test('optimized Android APK updates use one fixed public signing key without secrets', () => {
  const gradle = fs.readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
  const workflow = fs.readFileSync(new URL('../.github/workflows/android.yml', import.meta.url), 'utf8');
  const key = fs.readFileSync(new URL('../android/munchausen-debug.keystore.base64', import.meta.url), 'utf8').trim();
  assert.ok(gradle.includes('versionCode 1000 + githubRunNumber'));
  assert.ok(gradle.includes('storeFile rootProject.file(\'munchausen-debug.keystore\')'));
  assert.ok(gradle.includes('minifyEnabled true'));
  assert.ok(gradle.includes('shrinkResources true'));
  assert.ok(key.startsWith('MII') && key.length > 3000);
  assert.ok(workflow.includes('base64 --decode android/munchausen-debug.keystore.base64'));
  assert.ok(workflow.includes('assembleRelease'));
  assert.ok(workflow.includes('app-release.apk'));
  assert.ok(!workflow.includes('secrets.'));
});


test('room codes contain exactly three dice', () => {
  assert.ok(source.includes("function makeRoomCode(){return Array.from({length:3},randomDie).join('');}"));
  assert.ok(source.includes("function roomCodeValid(code){return typeof code==='string'&&/^[1-6]{3}$/.test(code);}"));
});

test('default player colours are six-digit hex values accepted by the database rules', () => {
  const hex = /^#[0-9a-f]{6}$/i;
  for (const name of ['const COL=', 'const NETWORK_DEFAULT_COLORS=']) {
    const start = source.indexOf(name);
    assert.ok(start >= 0, name + ' must exist');
    const list = source.slice(start, source.indexOf(']', start) + 1);
    const colours = [...list.matchAll(/'(#[0-9a-fA-F]+)'/g)].map(match => match[1]);
    assert.equal(colours.length, 5, name + ' must list five colours');
    for (const colour of colours) assert.match(colour, hex, name + ' contains an invalid colour ' + colour);
  }
});

test('room creation does not hide a rules rejection behind a retry loop', () => {
  assert.ok(source.includes("if(netErr(e)!=='permission-denied')throw e;"));
  assert.ok(source.includes('if(!taken.exists())throw e;'));
  assert.ok(source.includes("throw new Error('No free room code')"));
});

test('joining a room reports every refusal with a symbol instead of failing silently', () => {
  for (const symbol of ['🏠❓', '⚠️🔄', '🏠🔒', '▶️🚫', '👥🚫', '🎲❓']) assert.ok(source.includes("'" + symbol + "'"), symbol);
  assert.ok(source.includes('const refuse=message=>showRoomToast(message,5500);'));
});

test('multiplayer transactions touch only the small state node and retry an empty local cache', () => {
  assert.ok(source.includes('function stateTransaction(updateFn)'));
  assert.ok(source.includes('state=>state===null?null:updateFn(state)'));
  assert.equal(source.split('stateTransaction(').length - 1, 6);
  assert.ok(source.includes('await roomRef.update(updates)'));
  assert.ok(!source.includes('roomRef.transaction('));
  assert.ok(!source.includes('roomTransaction('));
});

test('network dice replay and pawn movement run concurrently after the initial draw', () => {
  assert.ok(source.includes('async function playNetTurn(event)'));
  assert.ok(source.includes("if(mode==='draw'){"));
  assert.ok(source.includes('await Promise.all([replayNetDice(event),play(Number(event.roll))])'));
  assert.ok(source.includes('function playInstant(roll)'));
  assert.ok(source.includes('playInstant(Number(request.roll))'));
  assert.ok(source.includes('await playNetTurn(event)'));
  assert.ok(source.includes('async function processHostOwnRoll'));
  assert.ok(source.includes('roomAnimationPending=true;'));
  assert.ok(source.includes('roomAnimationPending=false;'));
  assert.ok(source.includes('function awaitingOrDraw(){return awaiting()&&!roomProcessing&&!roomAnimationPending;}'));
  assert.ok(source.includes('const awaiting=()=>started&&!busy&&!over&&!roomAnimationPending&&!P.some(p=>p.anim);'));
});

test('the turn pipeline locks a turn and commits event, snapshot and sequence atomically', () => {
  assert.ok(source.includes('function processRollRequest(request,requestId)'));
  assert.ok(source.includes('state.turnToken!==request.turnToken'));
  assert.ok(source.includes('state.processing={requestId,uid:request.uid,turnToken:request.turnToken,claimedAt:Date.now()}'));
  assert.ok(source.includes("['events/'+String(seq).padStart(12,'0')]:event"));
  assert.ok(source.includes("const nextState={status:'started',seq,players:"));
  assert.ok(source.includes("updates['events/'+String(seq-ROOM_EVENT_LIMIT).padStart(12,'0')]=null"));
  assert.ok(source.includes("await roomRef.update(updates)"));
});

test('a roll from a reconnected player is not dropped because of a stale presence flag', () => {
  assert.ok(source.includes('if(!actor){'));
  assert.ok(!source.includes('actor.connected===false'));
});

test('untrusted dice requests are checked, but a physics mismatch between JS engines does not silently drop the turn', () => {
  assert.ok(source.includes('function validRollRequest(request,requestId)'));
  assert.ok(source.includes('const simulated=simulateDiceState(request.launchState);'));
  assert.ok(source.includes('Math.abs(value-simulated.state[index])<=1e-5'));
  assert.ok(source.includes('roll<1||roll>6'));
  assert.ok(source.includes('accepted as reported'));
});

test('reconnect, gap recovery and subscription disposal are implemented', () => {
  assert.ok(source.includes("firebase.database().ref('.info/connected')"));
  assert.ok(source.includes('function restoreRoomConnection()'));
  assert.ok(source.includes('function recoverRoomSnapshot()'));
  assert.ok(source.includes('function recoverStaleProcessingLock()'));
  assert.ok(source.includes('function scheduleSnapshotRecovery()'));
  assert.ok(source.includes('function stopRoomListeners()'));
  assert.ok(source.includes('function startPresenceHeartbeat()'));
  assert.ok(source.includes("onDisconnect().update({connected:false,ready:false,lastSeenAt:firebase.database.ServerValue.TIMESTAMP})"));
});

test('the room is deleted automatically when its creator leaves', () => {
  // the host registers a server-side removal of the whole room right after creating it
  assert.ok(source.includes('async function armRoomDisconnect(ref,uid,host)'));
  assert.ok(source.includes('if(host){await ref.onDisconnect().remove();return;}'));
  assert.ok(source.includes('await armRoomDisconnect(roomRef,fbUser.uid,true);'));
  // and re-registers it after a reconnect or a restored session
  assert.ok(source.includes('await armRoomDisconnect(ref,uid,host);'));
  assert.ok(source.includes('await armRoomDisconnect(ref,fbUser.uid,meta.hostUid===fbUser.uid);'));
  // guests and a returning host react to the room disappearing
  assert.ok(source.includes('function roomClosedByHost()'));
  assert.ok(source.includes('if(!roomMeta){roomClosedByHost();return;}'));
  assert.ok(source.includes('if(!state){roomClosedByHost();return;}'));
  assert.ok(source.includes("host?'📡❌':'🏠❌'"));
  // closing the page deletes the room immediately, a manual exit removes it first and only then cancels the handler
  assert.ok(source.includes("addEventListener('pagehide'"));
  assert.ok(source.includes('try{await ref.remove();removed=true;}'));
  assert.ok(source.includes('if(removed){try{await ref.onDisconnect().cancel();}catch(e){}}'));
});

test('the lobby shows the same player count to everyone and the host starts the game with the play button', () => {
  assert.ok(source.includes('function openSeatList()'));
  assert.ok(source.includes("np=open.length;$('#pn').textContent=np;"));
  assert.ok(source.includes("roomClosed=new Set(Object.keys(settings.closed||{})"));
  assert.ok(source.includes('async function startFromLobby()'));
  assert.ok(source.includes('color:seatColor(Number(m.seat))'));
  assert.ok(source.includes("function refreshSw(){if(netMode&&!started){renderLobbySeats();return;}"));
  // the host can start even when seats are vacant; nobody is started automatically
  assert.ok(source.includes("if(!members.length){showRoomToast('👤❓',3500);return;}"));
  assert.ok(source.includes('players.length<1)return;'));
  assert.ok(!source.includes('maybeStartNetworkGame'));
  assert.ok(!source.includes("members/'+fbUser.uid+'/ready'"));
});

test('the play button connects, starts or waits depending on the network state', () => {
  assert.ok(source.includes("$('#go').onclick=()=>{if(netMode){if(isHost&&!started)startFromLobby();return;}if(!$('#net').hidden){joinRoom();return;}"));
  assert.ok(source.includes("go.textContent='⏳'"));
  assert.ok(source.includes('function applyNetUi()'));
});

test('the host can remove a player, close a vacant seat and reopen it; the removed player is told', () => {
  assert.ok(source.includes("await roomRef.update({['members/'+m.uid]:null,['slots/'+m.seat]:null});"));
  assert.ok(source.includes("{uid:'closed',seat,joinedAt:Date.now()}"));
  assert.ok(source.includes("await roomRef.child('settings/closed/'+seat).set(true);"));
  assert.ok(source.includes("await roomRef.child('settings/closed/'+seat).remove();"));
  assert.ok(source.includes("'2️⃣🚫'"));
  assert.ok(source.includes('roomKicked();return;'));
  assert.ok(source.includes('if(netMode&&!started&&!isHost&&myIndex<0'));
  assert.ok(source.includes("'👤🚫'"));
  assert.ok(source.includes("kb.className='kick'"));
  assert.ok(source.includes('if(isHost&&!mine){'));
});

test('the main menu button asks for confirmation with symbols only', () => {
  assert.ok(html.includes('<button id="exitBtn"'));
  assert.ok(html.includes('<div id="exitAsk" hidden><button class="ok"'));
  assert.ok(source.includes("$('#exitAsk .ok').onclick=async()=>{"));
  assert.ok(source.includes("if(netMode)await withTimeout(leaveNetworkSetup(true),4000,'exit timeout');"));
  assert.ok(source.includes("$('#setup').hidden=true;$('#exitBtn').hidden=false;"));
});

test('the game shows no words: no Cyrillic text in string literals or markup', () => {
  const stripped = html
    .replace(/data:[a-z/+]+;base64,[A-Za-z0-9+/=]+/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\w])\/\/[^\n]*/g, '$1');
  const literal = /(['"`])(?:(?!\1)[^\\\n]|\\.)*[А-Яа-яЁё](?:(?!\1)[^\\\n]|\\.)*\1/;
  const hit = stripped.match(literal);
  assert.equal(hit, null, 'visible text found: ' + (hit && hit[0]));
  const markup = stripped.slice(stripped.indexOf('<body>'), stripped.indexOf('<script>'));
  assert.ok(!/[А-Яа-яЁё]/.test(markup), 'Cyrillic text in the markup');
});

test('player colours in a snapshot are indexed by player, so non-contiguous seats keep the chosen colour', () => {
  assert.ok(source.includes('COL.splice(0,COL.length,...NETWORK_DEFAULT_COLORS.map((c,i)=>snapshot.colors[i]||c))'));
  assert.ok(!source.includes('updateRoomPlayerColors(snapshot.colors)'));
});

test('a player who left in the middle of the game is skipped by the host instead of freezing the game', () => {
  assert.ok(source.includes('async function skipAbsentTurn()'));
  assert.ok(source.includes('t0-absentSince.get(pl.uid)<12000'));
  assert.ok(source.includes("state.processing={requestId:'skip',uid:pl.uid,turnToken:state.turnToken,claimedAt:Date.now()}"));
  assert.ok(source.includes("banner('● ⏭',cur,400)"));
  assert.ok(source.includes("if(event&&event.type==='skip'){"));
  assert.ok(source.includes('if(isHost)startAbsentWatch();'));
  assert.ok(source.includes('function stopRoomListeners(){stopAbsentWatch();'));
});

test('critical network handlers are declared only once', () => {
  for (const name of ['ensureAuth','createRoom','joinRoom','watchRoomState','processRollRequest','makeNetSnapshot','applyNetSnapshot','leaveNetworkSetup','armRoomDisconnect','roomClosedByHost','openSeatList','renderLobbySeats','updateLobbyControls','kickPlayer','closeSeat','reopenSeat','roomKicked','startFromLobby','applyNetUi','skipAbsentTurn','startAbsentWatch','stopAbsentWatch','playInstant','processHostOwnRoll']) {
    assert.equal(source.split('function ' + name + '(').length - 1, 1, name + ' should be declared once');
  }
});
