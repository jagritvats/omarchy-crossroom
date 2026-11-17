// lib/rooms.js: what the bar makes of each line `crossroom rooms --watch --json` prints.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadRooms } from './load.mjs';

const R = loadRooms();
// Objects made inside the vm come from another realm: compare them as plain JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));

const room = (o = {}) => ({
  id: 'room-aaaaaaaaaaaa',
  short: 'room-aaa',
  title: 'Checkout broke',
  host: 'app.crossroom.dev',
  state: 'live',
  yourTurn: 0,
  approval: [],
  asking: [],
  away: [],
  stalled: [],
  lastActivityAt: '2026-11-17T10:00:00.000Z',
  needsYou: false,
  ...o,
});
const line = (rooms) => JSON.stringify({ type: 'rooms', at: '2026-11-17T10:00:00.000Z', live: 0, needsYou: 0, rooms });

test('reads a line, recounting what needs you rather than trusting the totals', () => {
  const s = R.parseLine(line([room({ yourTurn: 1 }), room({ id: 'room-bbbbbbbbbbbb', short: 'room-bbb', state: 'ended' })]));
  assert.equal(s.live, 1);
  assert.equal(s.needsYou, 1);
  assert.equal(s.rooms[0].needsYou, true);
  assert.equal(s.rooms[1].needsYou, false);
});

test('ignores what is not a state: warnings, half lines, other types, bad rooms', () => {
  assert.equal(R.parseLine('crossroom 0.3.2 is out'), null);
  assert.equal(R.parseLine('{"type":"rooms","rooms":'), null);
  assert.equal(R.parseLine('{"type":"event","rooms":[]}'), null);
  const s = R.parseLine(line([{ id: 'x y' }, { id: 'room-ok-1234', state: 'weird', approval: ['B', 'nope', 7], yourTurn: -3 }]));
  assert.equal(s.rooms.length, 1);
  assert.deepEqual(plain(s.rooms[0]).approval, ['B']);
  assert.equal(s.rooms[0].state, 'unknown');
  assert.equal(s.rooms[0].yourTurn, 0);
  assert.equal(s.rooms[0].short, 'room-ok-');
});

test('a seat waiting on approval, asking its user or gone quiet needs you; one that stepped away does not', () => {
  for (const k of ['approval', 'asking', 'stalled']) assert.equal(R.parseLine(line([room({ [k]: ['B'] })])).needsYou, 1, k);
  assert.equal(R.parseLine(line([room({ away: ['B'] })])).needsYou, 0);
});

test('lists what needs you first, then live, then waiting, then the latest ended, newest first', () => {
  const rooms = [
    room({ id: 'ended-old-111', state: 'ended', lastActivityAt: '2026-11-01' }),
    room({ id: 'live-new-1111', lastActivityAt: '2026-11-17' }),
    room({ id: 'needs-you-111', asking: ['A'], lastActivityAt: '2026-11-02' }),
    room({ id: 'open-room-111', state: 'open' }),
    room({ id: 'gone-room-111', state: 'gone' }),
    room({ id: 'ended-new-111', state: 'ended', lastActivityAt: '2026-11-16' }),
  ];
  const s = R.parseLine(line(rooms));
  assert.deepEqual(plain(R.shown(s.rooms, 1).map((r) => r.id)), ['needs-you-111', 'live-new-1111', 'open-room-111', 'ended-new-111']);
});

test('says why a room needs you as keys and letters, never as participant text', () => {
  const r = R.parseLine(line([room({ yourTurn: 2, approval: ['B'], asking: ['A', 'C'], stalled: ['D'], away: ['E'] })])).rooms[0];
  assert.deepEqual(plain(R.reasons(r)), [
    { key: 'room.yourTurn.other', args: ['2'] },
    { key: 'room.approval', args: ['B'] },
    { key: 'room.asking', args: ['A, C'] },
    { key: 'room.stalled', args: ['D'] },
    { key: 'room.away', args: ['E'] },
  ]);
  assert.equal(R.reasons(room({ yourTurn: 1 }))[0].key, 'room.yourTurn.one');
});

test('the bar shows the count of rooms that need you, and only the mark otherwise', () => {
  assert.equal(R.barText(null, 'M'), 'M');
  assert.equal(R.barText(R.parseLine(line([room()])), 'M'), 'M');
  assert.equal(R.barText(R.parseLine(line([room({ yourTurn: 1 }), room({ id: 'room-2-xxxxx', stalled: ['A'] })])), 'M'), 'M 2');
});

test('a notice is raised for something new, never for the first state, never twice, and says only a count', () => {
  const first = R.parseLine(line([room({ yourTurn: 1 })]));
  let n = R.notice(null, first);
  assert.equal(n.notice, null);
  // The same again: nothing.
  n = R.notice(n.keys, first);
  assert.equal(n.notice, null);
  // A seat starts waiting on approval: one notice, with a count.
  const more = R.parseLine(line([room({ yourTurn: 1, approval: ['B'] })]));
  n = R.notice(n.keys, more);
  assert.deepEqual(plain(n.notice), { key: 'notice.one', count: 1 });
  // Answered and asked again in the same pass: a new key, so a new notice.
  const again = R.parseLine(line([room({ yourTurn: 2, approval: ['B'] })]));
  assert.ok(R.notice(n.keys, again).notice);
  // Everything settled: nothing to say.
  assert.equal(R.notice(n.keys, R.parseLine(line([room()]))).notice, null);
  // An ended room raises nothing.
  assert.equal(R.notice([], R.parseLine(line([room({ state: 'ended', yourTurn: 1 })]))).notice, null);
  // Two rooms: the plural.
  const two = R.parseLine(line([room({ yourTurn: 1 }), room({ id: 'room-2-xxxxx', stalled: ['A'] })]));
  assert.deepEqual(plain(R.notice([], two).notice), { key: 'notice.other', count: 2 });
});

test('a topic is one line and never read as a flag', () => {
  assert.equal(R.topicArg('  --seats 9  drop it '), 'seats 9 drop it');
  assert.equal(R.topicArg(`a${String.fromCodePoint(0x2028)}b\nc${String.fromCodePoint(0x85)}d\u0000e`), 'a b c d e');
  assert.equal(R.topicArg('x'.repeat(400)).length, 300);
  assert.equal(R.topicArg(''), '');
});

test('only room ids pass to a command', () => {
  assert.equal(R.safeShort('abcd1234'), 'abcd1234');
  for (const bad of ['', 'abc', '../x', '--print', 'a b', 'x#k=y', null]) assert.equal(R.safeShort(bad), '', String(bad));
});

test("reads what crossroom new --no-seat --json printed, keeping each seat's line", () => {
  const out = JSON.stringify({ roomId: 'room-new-123456', title: 'Release', pasteLines: ['https://app.crossroom.dev/j/a - join', 'https://app.crossroom.dev/j/b - join', 'not a line'] });
  assert.deepEqual(plain(R.parseNewRoom(out)), { id: 'room-new-123456', short: 'room-new', title: 'Release', lines: ['https://app.crossroom.dev/j/a - join', 'https://app.crossroom.dev/j/b - join'] });
  assert.equal(R.parseNewRoom('{"roomId":"room-new-123456","pasteLines":["https://x/j/a"]}'), null);
  assert.equal(R.parseNewRoom('Usage: ...'), null);
});

test('waits longer after each failure, up to five minutes', () => {
  assert.equal(R.backoffMs(0), 2000);
  assert.equal(R.backoffMs(3), 16000);
  assert.equal(R.backoffMs(50), 300000);
});

test("New room's lines show under the form only until the room is in the list", () => {
  const made = { id: 'room-new-123456', lines: ['a', 'b'] };
  assert.equal(R.showMade(null, []), false);
  assert.equal(R.showMade(made, [room()]), true);
  assert.equal(R.showMade(made, [room(), room({ id: 'room-new-123456' })]), false);
});

const seat = (o = {}) => ({ key: '0123456789ab', title: 'Why did checkout break?', letter: 'B', name: 'Claude Code', room: 'live', pending: 0, dir: 'checkout-api', held: true, at: '2026-11-17T10:00:00Z', ...o });

test('reads the seats this computer took, by key, live first; none from an older crossroom', () => {
  const s = R.parseLine(JSON.stringify({ type: 'rooms', rooms: [], seats: [
    seat({ key: 'aaaaaaaaaaaa', room: 'ended', at: '2026-11-17T12:00:00Z' }),
    seat(),
    { key: 'https://x/j/token', title: 'a link is no key' },
    seat({ key: 'bbbbbbbbbbbb', letter: 'zz', room: 'weird', pending: -1 }),
  ] }));
  assert.deepEqual(plain(s.seats.map((x) => x.key)), ['0123456789ab', 'aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
  assert.equal(s.seats[2].letter, '');
  assert.equal(s.seats[2].room, 'unreachable');
  assert.equal(s.seats[2].pending, 0);
  assert.deepEqual(plain(R.parseLine(line([room()])).seats), []);
});

test("a seat's row says what waits for its agent, and when no session holds it", () => {
  assert.deepEqual(plain(R.seatReasons(R.cleanSeat(seat({ pending: 3, held: false })))), [
    { key: 'seat.pending.other', args: ['3'] },
    { key: 'seat.unheld', args: [] },
  ]);
  assert.equal(R.seatReasons(R.cleanSeat(seat({ pending: 1 })))[0].key, 'seat.pending.one');
  assert.deepEqual(plain(R.seatReasons(R.cleanSeat(seat({ room: 'ended', pending: 2, held: false })))), []);
});

test('only a seat key passes to a command', () => {
  assert.equal(R.safeSeatKey('0123456789ab'), '0123456789ab');
  for (const bad of ['', '0123456789AB', '0123456789abc', '--open', 'https://x/j/t']) assert.equal(R.safeSeatKey(bad), '', bad);
});

test("a room's view keeps its newest lines, one line each", () => {
  let v = [];
  for (let i = 0; i < 200; i++) v = R.viewAppend(v, `#${i} message`);
  assert.equal(v.length, 150);
  assert.equal(v.at(-1), '#199 message');
  assert.equal(v[0], '#50 message');
  assert.deepEqual(plain(R.viewAppend(['a'], '   ')), ['a']);
  assert.equal(R.viewAppend([], `x${String.fromCodePoint(0x2028)}y`)[0], 'x y');
});

test('a watch line reads as local time, who, and what they did; bookkeeping is left out', () => {
  assert.equal(R.viewLine('#7 12:34:46 message (A Payments): Retries live in payments/retry.ts', 330), '18:04  A Payments: Retries live in payments/retry.ts');
  assert.equal(R.viewLine('#4 12:34:46 participant_joined (A Payments)', 0), '12:34  A Payments joined');
  assert.equal(R.viewLine('#9 23:50:00 context_requested (B Checkout): Which region?', 30), '00:20  B Checkout asked: Which region?');
  assert.equal(R.viewLine('#1 00:10:00 session_created (crossroom): Checkout', -60), '23:10  Room opened: Checkout');
  assert.equal(R.viewLine('#20 10:00:00 session_ended (owner): done', 0), '10:00  Room ended: done');
  assert.equal(R.viewLine('#12 10:00:00 message (owner): ok', 0), '10:00  You: ok');
  assert.equal(R.viewLine('#13 10:00:00 claim_created (A x): it is', 0), '10:00  A x · claim created: it is');
  for (const t of ['brief_set', 'session_started', 'participant_state', 'participant_attention']) assert.equal(R.viewLine(`#2 10:00:00 ${t} (crossroom)`, 0), null);
  assert.equal(R.viewLine('crossroom: some notice', 0), 'crossroom: some notice');
});

test('pages a list, and splits rooms into active (what needs you first) and recent', () => {
  assert.deepEqual(plain(R.paged([1, 2, 3, 4, 5], 2)), { items: [1, 2], more: 3 });
  assert.deepEqual(plain(R.paged([1], 6)), { items: [1], more: 0 });
  const s = R.parseLine(line([
    room({ id: 'ended-1-aaaa', state: 'ended' }),
    room({ id: 'live-1-aaaaa', lastActivityAt: '2026-11-17T12:00:00Z' }),
    room({ id: 'needs-1-aaaa', yourTurn: 1 }),
    room({ id: 'gone-1-aaaaa', state: 'gone' }),
  ]));
  assert.deepEqual(plain(R.activeRooms(s.rooms).map((r) => r.id)), ['needs-1-aaaa', 'live-1-aaaaa']);
  assert.deepEqual(plain(R.recentRooms(s.rooms).map((r) => r.id)), ['ended-1-aaaa']);
});

test("reads herdr's agents, and finds those in a room and those free to bring into one", () => {
  const h = R.parseHerdr(JSON.stringify({ available: true, agents: [
    { pane: 'w2:p1', name: 'crossroom-w2lh37cf-a', kind: 'claude', status: 'working', dir: 'api', room: 'w2lh37cf', letter: 'A' },
    { pane: 'w3:p1', name: 'mine', kind: 'codex', status: 'idle', dir: 'web', room: '', letter: '' },
    { pane: 'w4:p1', name: 'old', kind: 'claude', status: 'idle', dir: '', room: 'ENDED123xyz', letter: '' },
    { pane: 'bad', kind: 'x' },
    { pane: 'w5:p1', status: 'odd', room: '--x', letter: 'zz' },
  ] }));
  assert.equal(h.available, true);
  assert.equal(h.agents.length, 4);
  assert.equal(h.agents[3].status, 'unknown');
  assert.equal(h.agents[3].room, '');
  const rooms = [room({ id: 'W2LH37Cf6ekB' }), room({ id: 'ENDED123xyzA', state: 'ended' })];
  assert.deepEqual(plain(R.herdrIn(h.agents, rooms[0]).map((a) => a.pane)), ['w2:p1']);
  assert.deepEqual(plain(R.herdrFree(h.agents, rooms).map((a) => a.pane)), ['w3:p1', 'w4:p1', 'w5:p1']);
  assert.equal(R.herdrLabel(h.agents[0]), 'Seat A · claude  ·  api');
  assert.equal(R.herdrLabel(h.agents[1]), 'codex  ·  web');
  assert.deepEqual(plain(R.parseHerdr('{"available":false}')), { available: false, agents: [] });
  assert.deepEqual(plain(R.parseHerdr('junk')), { available: false, agents: [] });
  assert.equal(R.safePane('w1:p2'), 'w1:p2');
  assert.equal(R.safePane('w1:p2; x'), '');
  assert.equal(R.safeKind('codex'), 'codex');
  assert.equal(R.safeKind('bash'), '');
});

test("a room's name for a button: cut at a word, never on punctuation", () => {
  assert.equal(R.shortTitle({ title: 'Herdr launch test: say hello', short: 'VQ9JWxDb' }, 18), 'Herdr launch test…');
  assert.equal(R.shortTitle({ title: 'Ship it', short: 'x' }, 18), 'Ship it');
  assert.equal(R.shortTitle({ title: 'Release notes:', short: 'x' }, 18), 'Release notes');
  assert.equal(R.shortTitle({ title: '', short: 'VQ9JWxDb' }, 18), 'VQ9JWxDb');
  assert.equal(R.shortTitle({ title: 'Supercalifragilisticexpialidocious', short: 'x' }, 10), 'Supercalif…');
});
