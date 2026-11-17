.pragma library

// What the bar and the panel show, worked out from the lines `crossroom rooms --watch --json`
// prints. Pure functions over plain objects: no QML, no process, no clock unless passed in, so
// `node --test` runs them on any machine (tests/rooms.test.mjs loads this file as it stands).
//
// A line is one state of every room this computer holds keys for (packages/cli
// src/commands/rooms-watch.ts in the crossroom client):
//   { type: "rooms", at, live, needsYou,
//     rooms: [{ id, short, title, host, state, yourTurn, approval[], asking[], away[], stalled[],
//               lastActivityAt, needsYou }] }
// Nothing in it is a credential. The title is the one piece a participant may have written, and
// the client has already made it one line with no control characters; the QML still shows it as
// plain text.

var STATES = ["live", "open", "ended", "gone", "unknown"]
var LETTER = /^[A-L]$/
// Room ids are alphanumeric; never one that starts like a flag.
var SHORT = /^[A-Za-z0-9][A-Za-z0-9_-]{3,79}$/
// C0 and C1 controls, DEL, and the line and paragraph separators, built from code points.
var CONTROLS = new RegExp("[\u0000-\u001f\u007f-\u009f\u2028\u2029]+", "g")

function letters(v) {
  if (!Array.isArray(v)) return []
  var out = []
  for (var i = 0; i < v.length && out.length < 12; i++) if (typeof v[i] === "string" && LETTER.test(v[i])) out.push(v[i])
  return out
}

function count(v) {
  var n = Number(v)
  return isFinite(n) && n > 0 ? Math.min(999, Math.floor(n)) : 0
}

// One room, kept to the fields and shapes the bar knows. Null for anything that is not a room.
function cleanRoom(r) {
  if (!r || typeof r !== "object" || typeof r.id !== "string" || !SHORT.test(r.id)) return null
  var short = typeof r.short === "string" && SHORT.test(r.short) ? r.short : r.id.slice(0, 8)
  var room = {
    id: r.id,
    short: short,
    title: typeof r.title === "string" ? r.title.slice(0, 120) : "",
    host: typeof r.host === "string" ? r.host.slice(0, 120) : "",
    state: STATES.indexOf(r.state) >= 0 ? r.state : "unknown",
    yourTurn: count(r.yourTurn),
    approval: letters(r.approval),
    asking: letters(r.asking),
    away: letters(r.away),
    stalled: letters(r.stalled),
    lastActivityAt: typeof r.lastActivityAt === "string" ? r.lastActivityAt : ""
  }
  room.needsYou = room.yourTurn > 0 || room.approval.length > 0 || room.asking.length > 0 || room.stalled.length > 0
  return room
}

// One printed line, read. Null for a line that is not a state (a warning, half a line, junk).
function parseLine(line) {
  var o
  try { o = JSON.parse(String(line)) } catch (e) { return null }
  if (!o || o.type !== "rooms" || !Array.isArray(o.rooms)) return null
  var rooms = []
  for (var i = 0; i < o.rooms.length && rooms.length < 200; i++) {
    var r = cleanRoom(o.rooms[i])
    if (r) rooms.push(r)
  }
  var live = 0, needs = 0
  for (var j = 0; j < rooms.length; j++) {
    if (rooms[j].state === "live" || rooms[j].state === "open") live++
    if (rooms[j].needsYou) needs++
  }
  return { at: typeof o.at === "string" ? o.at : "", rooms: rooms, live: live, needsYou: needs }
}

// The order the panel lists them in: what needs you, then live, then waiting for a seat, then the
// rest, each newest first.
function sorted(rooms) {
  var rank = function (r) { return r.needsYou ? 0 : r.state === "live" ? 1 : r.state === "open" ? 2 : r.state === "ended" ? 3 : 4 }
  return rooms.slice().sort(function (a, b) {
    var d = rank(a) - rank(b)
    if (d) return d
    return a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0
  })
}

// The rooms the panel shows: every one that is live or waiting, and the latest few ended.
function shown(rooms, endedKept) {
  var keep = endedKept === undefined ? 5 : endedKept
  var out = [], ended = 0
  var all = sorted(rooms)
  for (var i = 0; i < all.length; i++) {
    var r = all[i]
    if (r.state === "live" || r.state === "open") out.push(r)
    else if (r.state === "ended" && ended < keep) { out.push(r); ended++ }
  }
  return out
}

// The reasons a room needs you, as translation keys and their arguments, in the order the panel
// prints them. `t(key, fallback)` turns each into words; the arguments are counts and seat letters.
function reasons(r) {
  var out = []
  if (r.yourTurn) out.push({ key: r.yourTurn === 1 ? "room.yourTurn.one" : "room.yourTurn.other", args: [String(r.yourTurn)] })
  if (r.approval.length) out.push({ key: "room.approval", args: [r.approval.join(", ")] })
  if (r.asking.length) out.push({ key: "room.asking", args: [r.asking.join(", ")] })
  if (r.stalled.length) out.push({ key: "room.stalled", args: [r.stalled.join(", ")] })
  if (r.away.length) out.push({ key: "room.away", args: [r.away.join(", ")] })
  return out
}

// What the bar button says: the mark, and how many rooms need you when any do.
function barText(state, icon) {
  var mark = icon || "󰭹"
  if (!state) return mark
  return state.needsYou ? mark + " " + state.needsYou : mark
}

// The facts a notice is about, one key per room and reason. A notice is raised when a key appears
// that the last state did not have, so a question answered and another asked raises one, and a
// room that stays waiting raises nothing more.
function noticeKeys(state) {
  var keys = []
  if (!state) return keys
  for (var i = 0; i < state.rooms.length; i++) {
    var r = state.rooms[i]
    if (r.state !== "live" && r.state !== "open") continue
    if (r.yourTurn) keys.push(r.id + ":turn:" + r.yourTurn)
    for (var a = 0; a < r.approval.length; a++) keys.push(r.id + ":approval:" + r.approval[a])
    for (var b = 0; b < r.asking.length; b++) keys.push(r.id + ":asking:" + r.asking[b])
    for (var c = 0; c < r.stalled.length; c++) keys.push(r.id + ":stalled:" + r.stalled[c])
  }
  return keys
}

// Whether to raise a notice, and with which words. `before` is the keys of the last state, or null
// for the first state read (which raises nothing: what was waiting when the bar started shows in
// the bar). The words are a fixed sentence and a count, never a title or an id: a notice program's
// command line is readable by every account on the machine.
function notice(before, state) {
  var keys = noticeKeys(state)
  if (before === null || before === undefined) return { keys: keys, notice: null }
  var fresh = false
  for (var i = 0; i < keys.length; i++) if (before.indexOf(keys[i]) < 0) { fresh = true; break }
  if (!fresh || !state.needsYou) return { keys: keys, notice: null }
  return { keys: keys, notice: { key: state.needsYou === 1 ? "notice.one" : "notice.other", count: state.needsYou } }
}

// A room's short id, if it is one the bar may pass to a command; otherwise empty.
function safeShort(s) {
  return typeof s === "string" && SHORT.test(s) ? s : ""
}

// A topic for `crossroom new`, as one line: no line breaks or controls, and never read as a flag.
function topicArg(text) {
  var s = String(text || "").replace(CONTROLS, " ").replace(/\s+/g, " ").trim()
  s = s.replace(/^-+\s*/, "")
  return s.slice(0, 300)
}

// What `crossroom new --no-seat --json` printed, kept to what the panel needs: the room and each
// seat's line. Null when it is not that.
function parseNewRoom(text) {
  var o
  try { o = JSON.parse(String(text)) } catch (e) { return null }
  if (!o || typeof o.roomId !== "string" || !SHORT.test(o.roomId) || !Array.isArray(o.pasteLines)) return null
  var lines = []
  for (var i = 0; i < o.pasteLines.length && i < 12; i++) if (typeof o.pasteLines[i] === "string" && /^https?:\/\//.test(o.pasteLines[i])) lines.push(o.pasteLines[i])
  if (lines.length < 2) return null
  return { id: o.roomId, short: o.roomId.slice(0, 8), title: typeof o.title === "string" ? o.title.slice(0, 120) : "", lines: lines }
}

// How long to wait before starting the watch again after it stopped: quickly at first, then less
// often, at most five minutes.
function backoffMs(failures) {
  var n = Math.max(0, Math.min(8, failures | 0))
  return Math.min(300000, 2000 * Math.pow(2, n))
}
