#!/usr/bin/env node
// The herdr side of the Crossroom bar: herdr is Omarchy's terminal workspace for AI coding agents.
// bin/crossroom-bar runs this as `crossroom-bar herdr <command>`:
//
//   agents                      herdr's agents as one JSON line, each matched to a Crossroom room where
//                               it holds a seat: {available, agents: [{pane, name, kind, status, dir,
//                               room, letter}]}
//   start <seats> <kind> [<topic>]  a room with every seat filled by <kind> in a herdr workspace
//                               (`crossroom new --launch ... --in herdr`); prints {roomId, title, launched}
//   focus <pane>                bring that agent's pane forward in herdr
//   bring <room> <pane>         a new seat in a room opened here, and the agent in <pane> told to take it
//
// What it prints never holds a seat link or an owner link: a room is its id, an agent its herdr pane.
// A seat link passes from crossroom to herdr inside this process, and reaches herdr as the prompt's
// argument (as `crossroom launch` hands one to every agent it starts). Which pane took a seat in which
// room is kept in $XDG_STATE_HOME/crossroom-bar/herdr.json (0600): pane ids and room ids only.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const KINDS = ['claude', 'codex', 'opencode', 'gemini'];
const ROOM = /^[A-Za-z0-9][A-Za-z0-9_-]{3,79}$/;
const PANE = /^w\d{1,6}:p\d{1,6}$/;
// What `crossroom launch --in herdr` names an agent when it knows the room: in lowercase, as herdr
// takes names, so the room is matched to it without regard to case.
const LAUNCHED = /^crossroom-([a-z0-9][a-z0-9_-]{3,79})-([a-l])$/;
const STATUS = ['idle', 'working', 'blocked', 'done', 'unknown'];

const oneLine = (s, n) =>
  String(s ?? '')
    // C0 and C1 controls, DEL, bidi overrides and isolates, the line and paragraph separators.
    .replace(new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069\\u2028\\u2029]+', 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);

const lastName = (p) => oneLine(String(p ?? '').replace(/\/+$/, '').split('/').pop(), 60);

/** herdr's `agent list` answer, as the bar shows it, each agent matched to its room where known. */
export function agentsView(listJson, map) {
  let j;
  try {
    j = JSON.parse(listJson);
  } catch {
    return { available: false, agents: [] };
  }
  const agents = Array.isArray(j?.result?.agents) ? j.result.agents : [];
  const out = [];
  for (const a of agents) {
    if (!a || typeof a.pane_id !== 'string' || !PANE.test(a.pane_id)) continue;
    const name = oneLine(a.name, 80);
    const launched = LAUNCHED.exec(name);
    const kept = map?.[a.pane_id];
    const room = launched ? launched[1] : kept && ROOM.test(kept.room ?? '') ? kept.room : '';
    out.push({
      pane: a.pane_id,
      name,
      kind: oneLine(a.agent, 20),
      status: STATUS.includes(a.agent_status) ? a.agent_status : 'unknown',
      dir: lastName(a.foreground_cwd || a.cwd),
      room,
      letter: launched ? launched[2].toUpperCase() : '',
    });
    if (out.length >= 40) break;
  }
  return { available: true, agents: out };
}

/** `crossroom new`'s arguments for a room whose every seat herdr fills with one kind of agent. */
export function startArgs(seats, kind, topic) {
  const n = Number(seats);
  if (!(Number.isInteger(n) && n >= 2 && n <= 6)) throw new Error('start takes 2 to 6 seats');
  if (!KINDS.includes(kind)) throw new Error(`start takes one of ${KINDS.join(', ')}`);
  const t = oneLine(topic, 300).replace(/^-+\s*/, '');
  return ['new', ...(t ? [t] : []), '--seats', String(n), '--launch', Array(n).fill(kind).join(','), '--in', 'herdr', '--json'];
}

/** What `crossroom new --launch --json` printed, kept to what may leave this process. */
export function startResult(out) {
  let r;
  try {
    r = JSON.parse(out);
  } catch {
    return null;
  }
  if (!r || typeof r.roomId !== 'string' || !ROOM.test(r.roomId)) return null;
  return { roomId: r.roomId, short: r.roomId.slice(0, 8), title: oneLine(r.title, 120), launched: Number(r.launched) || 0 };
}

const stateFile = (env) => path.join(env.XDG_STATE_HOME || path.join(env.HOME || homedir(), '.local', 'state'), 'crossroom-bar', 'herdr.json');

function readMap(env) {
  try {
    const m = JSON.parse(readFileSync(stateFile(env), 'utf8'));
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}

function writeMap(env, map) {
  const file = stateFile(env);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(map)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

const realRun = (bin, args) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120_000 });
  return { status: r.status ?? 1, out: r.stdout ?? '', err: (r.stderr ?? '') || (r.error ? r.error.message : '') };
};

/**
 * Run one command. `io` holds how: `run(bin, args)`, `env`, `out(line)`, `err(line)`, and the two
 * programs (`crossroom`, `herdr`). Answers the exit code.
 */
export function main(argv, io) {
  const [cmd, ...rest] = argv;
  const herdr = io.herdr || 'herdr';
  const cr = io.crossroom || 'crossroom';
  try {
    if (cmd === 'agents') {
      const r = io.run(herdr, ['agent', 'list']);
      io.out(JSON.stringify(r.status === 0 ? agentsView(r.out, readMap(io.env)) : { available: false, agents: [] }));
      return 0;
    }
    if (cmd === 'start') {
      const [seats, kind, ...topic] = rest;
      const r = io.run(cr, startArgs(seats, kind, topic.join(' ')));
      const made = r.status === 0 ? startResult(r.out) : null;
      if (!made) {
        io.err(oneLine(r.err, 300) || 'the room did not open');
        return 1;
      }
      io.out(JSON.stringify(made));
      return 0;
    }
    if (cmd === 'focus') {
      const [pane] = rest;
      if (!PANE.test(pane ?? '')) throw new Error('focus takes a herdr pane (w1:p2)');
      return io.run(herdr, ['agent', 'focus', pane]).status === 0 ? 0 : 1;
    }
    if (cmd === 'bring') {
      const [room, pane] = rest;
      if (!ROOM.test(room ?? '')) throw new Error('bring takes a room id');
      if (!PANE.test(pane ?? '')) throw new Error('bring takes a herdr pane (w1:p2)');
      const list = agentsView(io.run(herdr, ['agent', 'list']).out, {});
      const agent = list.agents.find((a) => a.pane === pane);
      if (!agent) {
        io.err('That herdr pane holds no agent now.');
        return 1;
      }
      if (agent.status === 'blocked' || agent.status === 'working') {
        io.err('That agent is busy; bring it in once it is idle.');
        return 1;
      }
      const added = io.run(cr, ['new', '--add', room, '--name', agent.kind || 'Agent', '--json']);
      let line = '';
      try {
        line = JSON.parse(added.out).pasteLine;
      } catch {}
      if (added.status !== 0 || typeof line !== 'string' || !/^https?:\/\/\S+\/j\/\S+ - /.test(line)) {
        io.err(oneLine(added.err, 300) || 'no seat could be added to that room');
        return 1;
      }
      const sent = io.run(herdr, ['agent', 'prompt', pane, line]);
      if (sent.status !== 0) {
        io.err(`herdr did not take the prompt: ${oneLine(sent.err || sent.out, 200)}`);
        return 1;
      }
      const map = readMap(io.env);
      map[pane] = { room };
      writeMap(io.env, map);
      io.out(JSON.stringify({ ok: true, room: room.slice(0, 8), pane }));
      return 0;
    }
    io.err('usage: crossroom-herdr agents | start <seats> <kind> [<topic>] | focus <pane> | bring <room> <pane>');
    return 2;
  } catch (e) {
    io.err(e instanceof Error ? e.message : String(e));
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), {
    run: realRun,
    env: process.env,
    out: (l) => process.stdout.write(`${l}\n`),
    err: (l) => process.stderr.write(`${l}\n`),
    crossroom: process.env.CROSSROOM_BIN || 'crossroom',
    herdr: process.env.HERDR_BIN || 'herdr',
  });
}
