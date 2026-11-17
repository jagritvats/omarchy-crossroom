// Loads lib/rooms.js as QML does: a `.pragma library` script whose functions are its exports.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const root = new URL('..', import.meta.url);
// Read as LF whatever the checkout did, so the tests hold on a Windows clone too.
export const read = (rel) => readFileSync(new URL(rel, root), 'utf8').replace(/\r\n/g, '\n');

export function loadRooms() {
  const src = read('lib/rooms.js');
  if (!src.startsWith('.pragma library\n')) throw new Error('lib/rooms.js must start with .pragma library');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src.replace(/^\.pragma library\n/, ''), ctx, { filename: 'lib/rooms.js' });
  return ctx;
}
