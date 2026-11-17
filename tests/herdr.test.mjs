// bin/crossroom-herdr.mjs: herdr's agents matched to rooms, starting a room's agents in herdr, and
// bringing an agent already running in herdr into a room. Run in process with a fake runner.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { agentsView, main, startArgs, startResult } from '../bin/crossroom-herdr.mjs';

const agent = (o = {}) => ({ agent: 'claude', agent_status: 'idle', cwd: '/home/me/repo', foreground_cwd: '/home/me/repo', name: 'claude', pane_id: 'w1:p1', ...o });
const list = (agents) => JSON.stringify({ id: 'cli:agent:list', result: { agents, type: 'agent_list' } });
const SEAT = 'https://app.crossroom.dev/j/AbCdEfGhIjKlMnOp';
const OWNER = 'https://app.crossroom.dev/s/W2LH37Cf6ekB#k=owner-secret';

function world({ agents = [agent()], add = { status: 0, out: JSON.stringify({ roomId: 'W2LH37Cf6ekB', seatUrl: SEAT, pasteLine: `${SEAT} - join this Crossroom room as my agent.` }) } } = {}) {
  const state = mkdtempSync(path.join(tmpdir(), 'crossroom-herdr-'));
  const calls = [];
  const out = [];
  const err = [];
  const io = {
    env: { XDG_STATE_HOME: state, HOME: state },
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    crossroom: 'crossroom',
    herdr: 'herdr',
    run: (bin, args) => {
      calls.push([bin, ...args]);
      if (bin === 'herdr' && args[0] === 'agent' && args[1] === 'list') return { status: 0, out: list(agents), err: '' };
      if (bin === 'crossroom' && args.includes('--add')) return { ...add, err: add.err ?? '' };
      if (bin === 'crossroom' && args.includes('--launch'))
        return { status: 0, out: JSON.stringify({ roomId: 'NEWROOM1abcd', title: 'Ship it', watchUrl: OWNER, pasteLines: [`${SEAT} - join`], launched: 2 }), err: '' };
      return { status: 0, out: '{}', err: '' };
    },
  };
  return { io, calls, out, err, state };
}

test('matches each herdr agent to its room: by the name crossroom gave it, or by a seat it was brought into', () => {
  const v = agentsView(
    list([
      agent({ name: 'crossroom-W2LH37Cf-b', pane_id: 'w2:p2', agent_status: 'working', foreground_cwd: '/home/me/checkout-api/' }),
      agent({ name: 'mine', pane_id: 'w3:p1', agent: 'codex' }),
      agent({ pane_id: 'w4:p1' }),
      agent({ pane_id: 'not a pane' }),
      agent({ pane_id: 'w5:p1', agent_status: 'weird', name: `x${String.fromCodePoint(0x202e)}y` }),
    ]),
    { 'w3:p1': { room: 'Z9a1CDx2abcd' }, 'w4:p1': { room: '--evil' } },
  );
  assert.equal(v.available, true);
  assert.deepEqual(v.agents, [
    { pane: 'w2:p2', name: 'crossroom-W2LH37Cf-b', kind: 'claude', status: 'working', dir: 'checkout-api', room: 'W2LH37Cf', letter: 'B' },
    { pane: 'w3:p1', name: 'mine', kind: 'codex', status: 'idle', dir: 'repo', room: 'Z9a1CDx2abcd', letter: '' },
    { pane: 'w4:p1', name: 'claude', kind: 'claude', status: 'idle', dir: 'repo', room: '', letter: '' },
    { pane: 'w5:p1', name: 'x y', kind: 'claude', status: 'unknown', dir: 'repo', room: '', letter: '' },
  ]);
  assert.deepEqual(agentsView('herdr: not running', {}), { available: false, agents: [] });
});

test('starts a room with every seat filled in herdr, and keeps only the room from what crossroom printed', () => {
  assert.deepEqual(startArgs('3', 'codex', '  --relay http://x  ship it '), ['new', 'relay http://x ship it', '--seats', '3', '--launch', 'codex,codex,codex', '--in', 'herdr', '--json']);
  assert.deepEqual(startArgs(2, 'claude', ''), ['new', '--seats', '2', '--launch', 'claude,claude', '--in', 'herdr', '--json']);
  assert.throws(() => startArgs(1, 'claude', ''), /2 to 6/);
  assert.throws(() => startArgs(2, 'bash', ''), /one of/);
  const w = world();
  assert.equal(main(['start', '2', 'claude', 'Ship', 'it'], w.io), 0);
  assert.deepEqual(JSON.parse(w.out[0]), { roomId: 'NEWROOM1abcd', short: 'NEWROOM1', title: 'Ship it', launched: 2 });
  assert.ok(!w.out.join('').includes('#k=') && !w.out.join('').includes('/j/'));
  assert.equal(startResult('Usage: ...'), null);
});

test('brings a running agent into a room: a new seat, its line as the prompt, the pane remembered', () => {
  const w = world({ agents: [agent({ pane_id: 'w3:p1', agent: 'codex' })] });
  assert.equal(main(['bring', 'W2LH37Cf6ekB', 'w3:p1'], w.io), 0);
  assert.deepEqual(w.calls[1], ['crossroom', 'new', '--add', 'W2LH37Cf6ekB', '--name', 'codex', '--json']);
  assert.deepEqual(w.calls[2], ['herdr', 'agent', 'prompt', 'w3:p1', `${SEAT} - join this Crossroom room as my agent.`]);
  assert.deepEqual(JSON.parse(w.out[0]), { ok: true, room: 'W2LH37Cf', pane: 'w3:p1' });
  const file = path.join(w.state, 'crossroom-bar', 'herdr.json');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { 'w3:p1': { room: 'W2LH37Cf6ekB' } });
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  // The next listing finds it in that room.
  const v = world({ agents: [agent({ pane_id: 'w3:p1', agent: 'codex' })] });
  v.io.env = w.io.env;
  main(['agents'], v.io);
  assert.equal(JSON.parse(v.out[0]).agents[0].room, 'W2LH37Cf6ekB');
});

test('brings nothing into a room for a busy agent, a pane with no agent, or a seat that could not be added', () => {
  for (const status of ['working', 'blocked']) {
    const w = world({ agents: [agent({ agent_status: status })] });
    assert.equal(main(['bring', 'W2LH37Cf6ekB', 'w1:p1'], w.io), 1);
    assert.match(w.err[0], /busy/);
    assert.ok(!w.calls.some((c) => c.includes('--add')));
  }
  const gone = world({ agents: [] });
  assert.equal(main(['bring', 'W2LH37Cf6ekB', 'w1:p1'], gone.io), 1);
  const refused = world({ add: { status: 2, out: '', err: 'Room W2LH37Cf6ekB was not opened from this machine' } });
  assert.equal(main(['bring', 'W2LH37Cf6ekB', 'w1:p1'], refused.io), 1);
  assert.ok(!refused.calls.some((c) => c[1] === 'agent' && c[2] === 'prompt'));
  for (const bad of [['bring', '--add', 'w1:p1'], ['bring', 'W2LH37Cf6ekB', 'w1:p1; rm'], ['focus', '--all']]) assert.equal(main(bad, world().io), 2, bad.join(' '));
});

test('focus brings an agent forward by its pane, and agents says when herdr is not there', () => {
  const w = world();
  assert.equal(main(['focus', 'w2:p2'], w.io), 0);
  assert.deepEqual(w.calls[0], ['herdr', 'agent', 'focus', 'w2:p2']);
  const none = world();
  none.io.run = () => ({ status: 127, out: '', err: 'herdr: not found' });
  main(['agents'], none.io);
  assert.deepEqual(JSON.parse(none.out[0]), { available: false, agents: [] });
});
