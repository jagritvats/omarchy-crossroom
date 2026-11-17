// bin/crossroom-bar under bash, with a fake `crossroom` and `wl-copy` that record what they were given.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(new URL('../bin/crossroom-bar', import.meta.url));
const bash = process.env.BASH_FOR_TESTS || 'bash';
// A path as bash reads it in a PATH: Git Bash's /c/... on Windows, since C:/... splits at its colon.
const posix = (p) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
const LINK = 'https://app.crossroom.dev/s/abcd1234efgh#k=secret-owner-token';

function world(version = '0.3.1') {
  const dir = mkdtempSync(path.join(tmpdir(), 'crossroom-bar-'));
  const log = path.join(dir, 'argv.log');
  const clip = path.join(dir, 'clipboard');
  const fake = path.join(dir, 'crossroom');
  // One argument a line, then a separator, for each call.
  writeFileSync(
    fake,
    `#!/usr/bin/env bash
for a in "$@"; do printf '%s\\n' "$a" >> "${log.replace(/\\/g, '/')}"; done
echo --- >> "${log.replace(/\\/g, '/')}"
case "$1" in
  --version) echo "${version}" ;;
  open) [ "\${3:-}" = "--print" ] && echo "${LINK}" ;;
  new) echo '{"roomId":"abcd1234efgh","pasteLines":["https://x/j/a - join","https://x/j/b - join"]}' ;;
  rooms) echo '{"type":"rooms","rooms":[]}' ;;
esac
exit 0
`,
  );
  chmodSync(fake, 0o755);
  const wl = path.join(dir, 'wl-copy');
  writeFileSync(wl, `#!/usr/bin/env bash\ncat > "${clip.replace(/\\/g, '/')}"\nfor a in "$@"; do printf 'ARG %s\\n' "$a" >> "${log.replace(/\\/g, '/')}"; done\n`);
  chmodSync(wl, 0o755);
  const run = (args, { input = '', withCrossroom = true, withWl = true } = {}) => {
    const env = { ...process.env, HOME: dir, PATH: `${process.env.PATH}` };
    if (withCrossroom) env.CROSSROOM_BIN = fake.replace(/\\/g, '/');
    else delete env.CROSSROOM_BIN;
    // A PATH holding only the fake wl-copy's directory when it is wanted, plus what bash needs.
    const bin = path.dirname(spawnSync(bash, ['-c', 'command -v head'], { encoding: 'utf8' }).stdout.trim() || '/usr/bin/head');
    env.PATH = withWl ? `${posix(dir)}:${bin}` : bin;
    if (!withCrossroom) {
      // The fake must not be found on PATH either: leave its directory out.
      env.PATH = bin;
    }
    // PATH is set inside bash: on Windows a POSIX PATH handed to spawn would hide bash itself.
    const want = env.PATH;
    env.PATH = process.env.PATH;
    return spawnSync(bash, ['-c', 'PATH="$1"; shift; exec bash "$@"', '_', want, launcher.replace(/\\/g, '/'), ...args], { input, encoding: 'utf8', env });
  };
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').split('---\n').filter(Boolean).map((c) => c.trim().split('\n')) : []);
  const clipboard = () => (existsSync(clip) ? readFileSync(clip, 'utf8') : null);
  return { run, calls, clipboard, log };
}

test('watch runs crossroom rooms --watch --json with the interval, once the version is new enough', () => {
  const w = world('0.3.1');
  const r = w.run(['watch', '30']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"type":"rooms"/);
  assert.deepEqual(w.calls().at(-1), ['rooms', '--watch', '--json', '--interval', '30']);
});

test('watch refuses a crossroom too old for it, with exit 3, and says how to update', () => {
  const w = world('0.3.0');
  const r = w.run(['watch', '20']);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /older than the bar needs \(0\.3\.1\): npm install -g crossroom/);
  assert.equal(w.calls().length, 1); // only --version
  for (const v of ['0.4.0', '1.0.0', '0.3.2-beta.1', 'dev']) assert.equal(world(v).run(['watch', '20']).status, 0, v);
});

test('watch takes seconds only', () => {
  assert.equal(world().run(['watch', '20; rm -rf ~']).status, 2);
});

test('open and copy-link take a room id, never a flag or anything else', () => {
  const w = world();
  for (const bad of ['--print', '-x', '../etc', 'a b', '']) {
    assert.equal(w.run(['open', bad]).status, 2, bad);
    assert.equal(w.run(['copy-link', bad]).status, 2, bad);
  }
  assert.equal(w.calls().length, 0);
  assert.equal(w.run(['open', 'abcd1234']).status, 0);
  assert.deepEqual(w.calls().at(-1), ['open', 'abcd1234']);
});

test('copy-link puts the private link on the clipboard through a pipe, and on no command line', () => {
  const w = world();
  const r = w.run(['copy-link', 'abcd1234']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(w.clipboard(), LINK);
  assert.ok(!readFileSync(w.log, 'utf8').includes('secret-owner-token'), 'the token reached an argv');
  assert.equal(r.stdout, '');
});

test('copy puts stdin on the clipboard as it is, with no argument', () => {
  const w = world();
  const r = w.run(['copy'], { input: 'https://x/j/a - join this room' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(w.clipboard(), 'https://x/j/a - join this room');
  assert.ok(!existsSync(w.log) || !readFileSync(w.log, 'utf8').includes('ARG'));
});

test('copy says wl-copy is missing, with exit 4', () => {
  const r = world().run(['copy'], { input: 'x', withWl: false });
  assert.equal(r.status, 4);
  assert.match(r.stderr, /wl-clipboard/);
});

test('new opens a room with every seat free, its topic never read as a flag', () => {
  const w = world();
  const r = w.run(['new', '3', '--relay http://evil']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"roomId"/);
  assert.deepEqual(w.calls().at(-1), ['new', 'relay http://evil', '--no-seat', '--json', '--seats', '3']);
  w.run(['new', '2']);
  assert.deepEqual(w.calls().at(-1), ['new', '--no-seat', '--json', '--seats', '2']);
  assert.equal(w.run(['new', '1']).status, 2);
  assert.equal(w.run(['new', '13']).status, 2);
});

test('says crossroom is not installed, with exit 127', () => {
  const r = world().run(['watch', '20'], { withCrossroom: false });
  assert.equal(r.status, 127);
  assert.match(r.stderr, /npm install -g crossroom/);
});

test('which names the command it found', () => {
  const r = world().run(['which']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /crossroom\n$/);
});

test("view streams the room's readable lines, and open-seat opens a seat by its key, each checked first", () => {
  const w = world();
  assert.equal(w.run(['view', 'abcd1234']).status, 0);
  assert.deepEqual(w.calls().at(-1), ['watch', 'abcd1234', '--no-signals']);
  assert.equal(w.run(['open-seat', '0123456789ab']).status, 0);
  assert.deepEqual(w.calls().at(-1), ['seats', '--open', '0123456789ab']);
  const before = w.calls().length;
  for (const bad of ['--json', '0123456789AB', 'https://x/j/t', '']) {
    assert.equal(w.run(['open-seat', bad]).status, 2, bad);
    assert.equal(w.run(['view', bad === '' ? '' : `-${bad}`]).status, 2, bad);
  }
  assert.equal(w.calls().length, before);
});
