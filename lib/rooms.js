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
  return { at: typeof o.at === "string" ? o.at : "", rooms: rooms, live: live, needsYou: needs, seats: seatsOf(o) }
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

// Whether the panel still shows the lines of the room New room just opened, under the form: only
// until the room is in the list, whose row has the same Seat buttons (and drops them once it ends).
function showMade(made, listed) {
  if (!made) return false
  for (var i = 0; i < listed.length; i++) if (listed[i].id === made.id) return false
  return true
}

// ---- seats agents on this computer took (`seats` in each line, crossroom 0.3.1 and later)

var SEAT_KEY = /^[0-9a-f]{12}$/
var SEAT_ROOM = ["live", "ended", "unreachable"]

// One seat, kept to the fields the panel shows. Null for anything else. A seat is named by its key,
// a digest of its link: the link itself never reaches the bar.
function cleanSeat(s) {
  if (!s || typeof s !== "object" || typeof s.key !== "string" || !SEAT_KEY.test(s.key)) return null
  return {
    key: s.key,
    title: typeof s.title === "string" ? s.title.slice(0, 120) : "",
    letter: typeof s.letter === "string" && LETTER.test(s.letter) ? s.letter : "",
    name: typeof s.name === "string" ? s.name.slice(0, 60) : "",
    room: SEAT_ROOM.indexOf(s.room) >= 0 ? s.room : "unreachable",
    pending: count(s.pending),
    dir: typeof s.dir === "string" ? s.dir.slice(0, 80) : "",
    held: s.held === true,
    at: typeof s.at === "string" ? s.at : ""
  }
}

// The seats in a line, live first, then by when they were taken. Empty from an older crossroom.
function seatsOf(o) {
  if (!o || !Array.isArray(o.seats)) return []
  var out = []
  for (var i = 0; i < o.seats.length && out.length < 12; i++) {
    var s = cleanSeat(o.seats[i])
    if (s) out.push(s)
  }
  return out.sort(function (a, b) {
    var d = (a.room === "live" ? 0 : 1) - (b.room === "live" ? 0 : 1)
    if (d) return d
    return a.at < b.at ? 1 : a.at > b.at ? -1 : 0
  })
}

// What a seat's row says under its title, as keys and arguments.
function seatReasons(s) {
  var out = []
  if (s.room === "live" && s.pending) out.push({ key: s.pending === 1 ? "seat.pending.one" : "seat.pending.other", args: [String(s.pending)] })
  if (s.room === "live" && !s.held) out.push({ key: "seat.unheld", args: [] })
  return out
}

// A seat's key, if it is one the bar may pass to a command; otherwise empty.
function safeSeatKey(k) {
  return typeof k === "string" && SEAT_KEY.test(k) ? k : ""
}

// ---- a room's own view in the panel: the readable lines `crossroom watch <room>` prints

var VIEW_KEPT = 150

// The view's lines after one more: the newest last, at most VIEW_KEPT, blank lines dropped.
function viewAppend(lines, text) {
  var t = String(text || "").replace(CONTROLS, " ").trim()
  if (!t) return lines
  var out = lines.concat([t.slice(0, 400)])
  return out.length > VIEW_KEPT ? out.slice(out.length - VIEW_KEPT) : out
}

// One line of `crossroom watch` (`#<seq> <hh:mm:ss UTC> <type> (<who>)[: <gist>]`) as a person reads
// it in the panel: local time, who, and what they did. Null for bookkeeping a person needn't see.
// A line in any other shape is kept as it came. `offsetMin` is the local offset from UTC in
// minutes (`-new Date().getTimezoneOffset()`).
var VIEW_LINE = /^#\d+ (\d\d):(\d\d):\d\d ([a-z_]+) \(([^)]*)\)(?:: ([\s\S]*))?$/
var VIEW_SKIP = ["brief_set", "session_started", "participant_state", "participant_attention", "board_updated", "lane_settings"]
var VIEW_VERB = {
  participant_joined: "joined",
  participant_left: "left",
  participant_finished: "finished",
  context_requested: "asked",
  context_shared: "shared",
  context_declined: "declined"
}

function viewLine(text, offsetMin) {
  var t = String(text || "")
  var m = VIEW_LINE.exec(t)
  if (!m) return t
  var type = m[3]
  if (VIEW_SKIP.indexOf(type) >= 0) return null
  var mins = ((Number(m[1]) * 60 + Number(m[2]) + (Number(offsetMin) || 0)) % 1440 + 1440) % 1440
  var hh = Math.floor(mins / 60), mm = mins % 60
  var time = (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm
  var who = m[4] === "owner" ? "You" : m[4] === "crossroom" ? "Crossroom" : m[4]
  var gist = m[5] || ""
  var what
  if (type === "message") what = who + ": " + gist
  else if (type === "session_created") what = "Room opened" + (gist ? ": " + gist : "")
  else if (type === "session_ended") what = "Room ended" + (gist ? ": " + gist : "")
  else if (VIEW_VERB[type]) what = who + " " + VIEW_VERB[type] + (gist ? ": " + gist : "")
  else what = who + " · " + type.replace(/_/g, " ") + (gist ? ": " + gist : "")
  return time + "  " + what
}

// ---- paging: the panel shows a few of a list and says how many more there are

// The first `limit` of a list, and how many it leaves out.
function paged(items, limit) {
  var n = Math.max(0, limit | 0)
  return { items: items.slice(0, n), more: Math.max(0, items.length - n) }
}

// The rooms that are live or wait for a seat, what needs you first; and the ended ones, newest first.
function activeRooms(rooms) {
  return sorted(rooms).filter(function (r) { return r.state === "live" || r.state === "open" })
}
function recentRooms(rooms, kept) {
  return sorted(rooms).filter(function (r) { return r.state === "ended" }).slice(0, kept === undefined ? 10 : kept)
}

// ---- herdr: Omarchy's workspace for coding agents (`crossroom-bar herdr agents`)

var PANE = /^w\d{1,6}:p\d{1,6}$/
var HERDR_STATUS = ["idle", "working", "blocked", "done", "unknown"]
var HERDR_KINDS = ["claude", "codex", "opencode", "gemini"]

// What `crossroom-bar herdr agents` printed, kept to the fields the panel shows.
function parseHerdr(text) {
  var o
  try { o = JSON.parse(String(text)) } catch (e) { return { available: false, agents: [] } }
  if (!o || o.available !== true || !Array.isArray(o.agents)) return { available: false, agents: [] }
  var out = []
  for (var i = 0; i < o.agents.length && out.length < 40; i++) {
    var a = o.agents[i]
    if (!a || typeof a.pane !== "string" || !PANE.test(a.pane)) continue
    out.push({
      pane: a.pane,
      name: typeof a.name === "string" ? a.name.slice(0, 80) : "",
      kind: typeof a.kind === "string" ? a.kind.slice(0, 20) : "",
      status: HERDR_STATUS.indexOf(a.status) >= 0 ? a.status : "unknown",
      dir: typeof a.dir === "string" ? a.dir.slice(0, 60) : "",
      room: typeof a.room === "string" && SHORT.test(a.room) ? a.room : "",
      letter: typeof a.letter === "string" && LETTER.test(a.letter) ? a.letter : ""
    })
  }
  return { available: true, agents: out }
}

// Whether an agent's room (an id, or its start in lowercase from a herdr agent's name) is this room.
function sameRoom(id, agentRoom) {
  return !!agentRoom && (id === agentRoom || id.toLowerCase().indexOf(agentRoom.toLowerCase()) === 0)
}

// The herdr agents in a room: named for it by `crossroom launch`, or brought into it from the panel.
function herdrIn(agents, room) {
  if (!room) return []
  return agents.filter(function (a) { return a.room && sameRoom(room.id, a.room) })
}

// The herdr agents in no room this computer knows: the ones the panel can bring into a room.
function herdrFree(agents, rooms) {
  return agents.filter(function (a) {
    if (!a.room) return true
    for (var i = 0; i < rooms.length; i++) if (sameRoom(rooms[i].id, a.room)) return rooms[i].state === "ended" || rooms[i].state === "gone"
    return false
  })
}

// One herdr agent as the panel says it: its seat when known, what runs, what it is doing.
function herdrLabel(a) {
  var who = a.letter ? "Seat " + a.letter + " · " + (a.kind || "agent") : (a.kind || "agent")
  return who + (a.dir ? "  ·  " + a.dir : "")
}

// A herdr agent kind the panel may ask for; otherwise empty.
function safeKind(k) {
  return HERDR_KINDS.indexOf(k) >= 0 ? k : ""
}

// A herdr pane id, if it is one the bar may pass to a command; otherwise empty.
function safePane(p) {
  return typeof p === "string" && PANE.test(p) ? p : ""
}

// A room's name in a few characters, for a button: its title cut at a word where it can, never
// ending on punctuation; its short id when it has no title.
var ELLIPSIS = String.fromCharCode(0x2026)
function shortTitle(r, n) {
  var t = String(r && r.title || "").trim()
  if (!t) return r && r.short || ""
  var trim = function (x) { return x.replace(/[\s:;,.\-]+$/, "") }
  if (t.length <= n) return trim(t)
  var cut = t.slice(0, n)
  // Cut back to a word's end only when the cut falls inside a word.
  if (/\w/.test(t.charAt(n)) && /\w/.test(cut.charAt(n - 1))) {
    var space = cut.lastIndexOf(" ")
    if (space > n / 2) cut = cut.slice(0, space)
  }
  return trim(cut) + ELLIPSIS
}
