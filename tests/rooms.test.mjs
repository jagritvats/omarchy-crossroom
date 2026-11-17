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
