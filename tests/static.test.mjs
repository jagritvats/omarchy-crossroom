// What can be checked of the QML and the manifest without Quickshell: strings, commands, plain
// text, and the manifest's shape. The QML itself only runs on an Omarchy machine (AGENTS.md).
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { loadRooms, read, root } from './load.mjs';

const QML = readdirSync(root).filter((f) => f.endsWith('.qml'));
const src = Object.fromEntries(QML.map((f) => [f, read(f)]));
const en = JSON.parse(read('i18n/en.json'));
const manifest = JSON.parse(read('manifest.json'));

/** A double-quoted string literal. */
const QUOTED = /"(?:\\.|[^"\\])*"/g;

/** QML with comments and string contents blanked, for counting braces. */
function code(s) {
  return s
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/\/(?:\\.|[^/\\\n])+\/[gimsuy]*/g, '//');
}

/** Each `Type { ... }` block of a given type, with its body. */
function blocks(s, type) {
  const out = [];
  const re = new RegExp(`\\b${type}\\s*\\{`, 'g');
  let m;
  while ((m = re.exec(s))) {
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < s.length; i++) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}' && --depth === 0) {
        out.push(s.slice(m.index, i + 1));
        break;
      }
    }
  }
  return out;
}

test('every QML file balances its braces and brackets', () => {
  for (const [f, s] of Object.entries(src)) {
    const c = code(s);
    for (const [o, cl] of [['{', '}'], ['(', ')'], ['[', ']']]) assert.equal(c.split(o).length, c.split(cl).length, `${f}: ${o}${cl}`);
  }
});

test('every string the QML asks for is in i18n/en.json, and every string there is used', () => {
  const used = new Set();
  for (const s of Object.values(src)) for (const m of s.matchAll(/tr\.t\("([^"]+)"\s*[,)]/g)) used.add(m[1]);
  // Keys built in lib/rooms.js (reasons, notices) and from a room's state.
  for (const m of read('lib/rooms.js').matchAll(/"((?:room|notice|seat)\.[A-Za-z.]+)"/g)) used.add(m[1]);
  for (const st of ['live', 'open', 'ended', 'gone', 'unknown']) used.add(`state.${st}`);
  for (const k of used) assert.ok(k in en, `missing string: ${k}`);
  // Two section headings are kept for the next panel layout; nothing else may sit unused.
  const spare = new Set(['panel.needsYou', 'panel.rooms']);
  for (const k of Object.keys(en)) assert.ok(used.has(k) || spare.has(k), `unused string: ${k}`);
});

test('every command goes through bin/crossroom-bar with fixed words and room ids, or is the notice', () => {
  const all = Object.entries(src);
  for (const [f, s] of all) {
    for (const m of s.matchAll(/execDetached\(\s*\[([^\]]*)\]/g)) {
      const first = m[1].trim();
      assert.ok(first.startsWith('root.launcher') || first.startsWith('"notify-send"'), `${f}: execDetached(${first.slice(0, 40)})`);
    }
    for (const m of s.matchAll(/command(?:\s*:|\s*=)\s*(\[[^\]]*\]|args)/g)) {
      assert.ok(/^\[root\.launcher\b/.test(m[1]) || m[1] === 'args', `${f}: command ${m[1]}`);
    }
    for (const m of s.matchAll(/\brun\(\["([^"]+)"/g)) assert.ok(['open', 'copy-link', 'open-seat'].includes(m[1]), `${f}: run ${m[1]}`);
  }
  // `args` in the panel is built from the launcher, "new", a seat count and the cleaned topic.
  assert.match(src['RoomsPanel.qml'], /var args = \[root\.launcher, "new", String\(root\.seats\)\]/);
  assert.match(src['RoomsPanel.qml'], /var t = Rooms\.topicArg\(topic\)/);
  // A room id passes to a command only through safeShort.
  assert.match(src['BarWidget.qml'], /var s = Rooms\.safeShort\(short\)\s*\n\s*if \(s\) run\(\["open", s\]\)/);
  assert.match(src['BarWidget.qml'], /var s = Rooms\.safeShort\(short\)\s*\n\s*if \(s\) run\(\["copy-link", s\]\)/);
  // A seat passes only by its key, and a room's view only by its id.
  assert.match(src['BarWidget.qml'], /var k = Rooms\.safeSeatKey\(key\)\s*\n\s*if \(k\) run\(\["open-seat", k\]\)/);
  assert.match(src['RoomsPanel.qml'], /var s = Rooms\.safeShort\(r\.short\)[\s\S]{0,200}viewProc\.command = \[root\.launcher, "view", s\]/);
});

test('a notice says a fixed sentence and a count: no title, no id, no seat line', () => {
  const s = src['BarWidget.qml'];
  const calls = [...s.matchAll(/execDetached\(\["notify-send"([^\]]*)\]/g)].map((m) => m[1]);
  assert.equal(calls.length, 1);
  // Its arguments with every quoted string blanked: only the sentence's variable may be left.
  assert.doesNotMatch(calls[0].replace(QUOTED, '""'), /title|short|\.id|lines|modelData/);
  const body = s.slice(s.indexOf('var body ='), s.indexOf('Quickshell.execDetached(["notify-send"'));
  assert.match(body, /tr\.t\("notice\.one"/);
  assert.match(body, /\.arg\(n\.notice\.count\)/);
  assert.doesNotMatch(body, /title|short|\.id\b/);
});

test('nothing in the plugin handles an owner token or a private link', () => {
  for (const [f, s] of [...Object.entries(src), ['lib/rooms.js', read('lib/rooms.js')]]) {
    for (const bad of ['#k=', 'watchUrl', 'x-parley', 'ownerToken', 'ownerUrl', '--owner-token']) assert.ok(!s.includes(bad), `${f}: ${bad}`);
  }
});

test('a title or an agent-derived line is shown as plain text', () => {
  for (const [f, s] of Object.entries(src)) {
    for (const b of blocks(s, 'Label')) {
      if (/text:[^\n]*(\.title|\.short|modelData)/.test(b.replace(QUOTED, '""'))) assert.match(b, /textFormat:\s*Text\.PlainText/, `${f}: ${b.slice(0, 80)}`);
    }
  }
});

test('the manifest names files that exist, and its defaults are its schema\'s, each read by the widget', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.license, 'Apache-2.0');
  assert.match(read('LICENSE'), /Apache License\s+Version 2\.0/);
  assert.deepEqual(manifest.kinds, ['bar-widget']);
  for (const p of Object.values(manifest.entryPoints)) assert.ok(existsSync(new URL(p, root)), p);
  const schema = manifest.barWidget.schema;
  assert.deepEqual(Object.keys(manifest.barWidget.defaults).sort(), schema.map((x) => x.key).sort());
  const qml = Object.values(src).join('\n');
  for (const x of schema) {
    assert.deepEqual(manifest.barWidget.defaults[x.key], x.defaultValue, x.key);
    assert.ok(qml.includes(`setting("${x.key}"`), `${x.key} is never read`);
  }
  assert.ok(manifest.description.length <= 400);
});

// The shell's qs.Ui as Omarchy 4.5.0 ships it (/usr/share/omarchy/shell/Ui), and the QtQuick and
// Quickshell types the plugin uses. A type outside these must be defined inline (`component X: …`):
// `Label` and `ActionButton` are not qs.Ui types, which only the shell's log showed.
const QS_UI = ['BarIconButton', 'BarWidget', 'Button', 'ButtonGroup', 'Dropdown', 'KeyboardPanel', 'Panel', 'PanelActionButton',
  'PanelSectionHeader', 'PanelSeparator', 'PanelToolTip', 'TextField', 'Toggle', 'ToggleSwitch', 'WidgetButton', 'FilterInput', 'NumberField'];
const QT = ['Item', 'Rectangle', 'Text', 'Column', 'Row', 'Flow', 'Repeater', 'Flickable', 'FocusScope', 'Loader', 'Timer', 'MouseArea',
  'Process', 'SplitParser', 'StdioCollector', 'IpcHandler', 'FileView', 'Connections', 'PanelWindow'];

test('every QML type is the shell\'s, Qt\'s, Quickshell\'s, or defined in the file', () => {
  for (const [f, s] of Object.entries(src)) {
    const inline = new Set([...s.matchAll(/component\s+([A-Z]\w*)\s*:/g)].map((m) => m[1]));
    const c = code(s);
    for (const m of c.matchAll(/(?:^|[\s:;{])([A-Z][A-Za-z]*(?:\.[A-Z][A-Za-z]*)?)\s*\{/g)) {
      const t = m[1];
      if (t.startsWith('Compat.')) assert.ok(existsSync(new URL(`${t.slice(7)}.qml`, root)), `${f}: ${t}`);
      else if (t.startsWith('Ui.')) assert.ok(QS_UI.includes(t.slice(3)), `${f}: ${t} is not a known type`);
      else assert.ok(QS_UI.includes(t) || QT.includes(t) || inline.has(t), `${f}: ${t} is not a known type`);
    }
  }
});

test('the QML loads the files it names', () => {
  for (const [f, s] of Object.entries(src)) {
    for (const m of s.matchAll(/(?:Qt\.resolvedUrl\(|import )"([^"]+\.(?:qml|js))"/g)) assert.ok(existsSync(new URL(m[1], root)), `${f}: ${m[1]}`);
  }
  assert.ok(src['BarWidget.qml'].includes('Qt.resolvedUrl("RoomsPanel.qml")'));
});

test('the panel and the launcher agree on the crossroom version the bar needs', () => {
  const min = /MIN_VERSION="([0-9.]+)"/.exec(read('bin/crossroom-bar'))[1];
  assert.ok(en['panel.old'].includes(`crossroom ${min} or later`), `panel.old should name ${min}`);
});

test('lib/rooms.js is plain ES5 a QML .pragma library can load', () => {
  const s = read('lib/rooms.js');
  assert.doesNotMatch(code(s), /\b(?:let|const|class|import|export)\b|=>.*=>|`/);
  assert.ok(loadRooms().parseLine);
  for (const [i, c] of [...s].entries()) {
    const p = c.codePointAt(0);
    // The bar's mark (a Nerd Font glyph) and the middle dot the view puts between who and what;
    // nothing else above ASCII, so an escape the editor turned into its character shows up here.
    if (p > 0x7e) assert.ok(p === 0xf0b79 || p === 0xb7, `character U+${p.toString(16)} at ${i}`);
  }
});
