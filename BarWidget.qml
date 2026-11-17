import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "." as Compat
import "lib/rooms.js" as Rooms

// The Crossroom bar widget.
//
// The mark, and beside it how many rooms need you when any do (the button is lit then). Left
// click opens the panel (RoomsPanel.qml); middle click opens the room that needs you, or the
// latest live one, in the browser.
//
// State comes from one long-running process, `bin/crossroom-bar watch <s>`, which runs
// `crossroom rooms --watch --json`: the crossroom command reads the rooms this computer holds keys
// for and prints a line each time one changes. That process is the only one that ever holds an
// owner token; what reaches this file is ids, states, counts, seat letters and titles
// (lib/rooms.js keeps each line to those fields). Commands this widget starts take room ids and
// fixed words only, and a notice says a fixed sentence and a count, because the command line of
// any process (notify-send's included) is readable by every account on the machine.
BarWidget {
  id: root
  moduleName: "io.github.jagritvats.crossroom"

  readonly property string pluginDir: {
    var u = String(Qt.resolvedUrl("."))
    return u.indexOf("file://") === 0 ? decodeURIComponent(u.slice(7)).replace(/\/$/, "") : u
  }
  readonly property string launcher: pluginDir + "/bin/crossroom-bar"

  // The last state read (lib/rooms.js parseLine), or null before the first.
  property var state: null
  // "starting" until the first line, "ok", "missing" (no crossroom), "old" (too old for the bar),
  // or "stopped" (the watch ended; it starts again after a pause).
  property string status: "starting"
  property int failures: 0
  property bool reloading: false
  property var noticeKeys: null
  // Seat lines of rooms opened from the panel in this session, by room id. In memory only.
  property var newLines: ({})
  // herdr (Omarchy's agent workspace): its agents, each matched to a room where it holds a seat.
  property var herdr: ({ available: false, agents: [] })
  property string herdrNote: ""       // what the last "bring into a room" did, in a line

  readonly property int needsYou: state ? state.needsYou : 0
  readonly property int live: state ? state.live : 0
  readonly property var rooms: state ? state.rooms : []

  Compat.CrossroomTranslations { id: tr; directory: Qt.resolvedUrl("i18n") }

  function intervalS() {
    var n = Number(setting("interval", 20))
    return isFinite(n) ? Math.max(5, Math.min(600, Math.round(n))) : 20
  }

  function run(args) { Quickshell.execDetached([root.launcher].concat(args)) }
  function openRoom(short) {
    var s = Rooms.safeShort(short)
    if (s) run(["open", s])
  }
  // ---- herdr
  function refreshHerdr() { if (!herdrProc.running) herdrProc.running = true }
  function focusAgent(pane) {
    var p = Rooms.safePane(pane)
    if (p) run(["herdr", "focus", p])
  }
  // A new seat in a room opened here, and the agent in that pane told to take it.
  function bringAgent(roomId, pane) {
    var r = Rooms.safeShort(roomId), p = Rooms.safePane(pane)
    if (!r || !p || bringProc.running) return
    root.herdrNote = ""
    bringProc.command = [root.launcher, "herdr", "bring", r, p]
    bringProc.running = true
  }

  // A seat an agent here took, by its key (a digest of its link: the link stays in crossroom).
  function openSeat(key) {
    var k = Rooms.safeSeatKey(key)
    if (k) run(["open-seat", k])
  }
  function copyLink(short) {
    var s = Rooms.safeShort(short)
    if (s) run(["copy-link", s])
  }
  // A line the panel holds goes to the clipboard through stdin, never as an argument.
  function copyText(text) {
    copyProc.pending = String(text)
    if (!copyProc.running) copyProc.running = true
  }
  function rememberNewRoom(room) {
    var lines = Object.assign({}, root.newLines)
    lines[room.id] = room
    root.newLines = lines
  }

  function readLine(data) {
    var s = Rooms.parseLine(data)
    if (!s) return
    root.state = s
    root.status = "ok"
    root.failures = 0
    var n = Rooms.notice(root.noticeKeys, s)
    root.noticeKeys = n.keys
    if (n.notice && setting("notices", true) !== false) {
      var body = n.notice.key === "notice.one" ? tr.t("notice.one", "A room needs you.")
                                              : tr.t("notice.other", "%1 rooms need you.").arg(n.notice.count)
      Quickshell.execDetached(["notify-send", "--app-name=Crossroom", "--icon=mail-message-new", tr.t("notice.title", "Crossroom"), body])
    }
  }

  // The panel opened while the watch was down: try again now rather than at the end of its pause.
  function retryWatch() {
    if (watchProc.running || root.status === "ok" || root.status === "starting") return
    restart.stop()
    startWatch()
  }
  function startWatch() {
    watchProc.command = [root.launcher, "watch", String(root.intervalS())]
    watchProc.running = true
  }

  // ---- panel contract (Bar.findPanelWidget needs open/close/opened)
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false
  function open() { if (panelLoader.item) panelLoader.item.open() }
  function close() { if (panelLoader.item) panelLoader.item.close() }
  function toggle() { if (panelLoader.item) panelLoader.item.toggle() }
  function closeForPopoutSwitch() { if (panelLoader.item) panelLoader.item.closeForPopoutSwitch() }

  function injectPanel() {
    var t = panelLoader.item
    if (!t) return
    t.bar = root.bar
    t.settings = root.settings
    t.anchorItem = button
    t.hostWidget = root
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight
  onBarChanged: injectPanel()
  onSettingsChanged: {
    injectPanel()
    // A new interval takes effect when the watch starts again.
    if (watchProc.running && watchProc.command.length && watchProc.command[2] !== String(root.intervalS())) {
      root.reloading = true
      watchProc.running = false
    }
  }
  Component.onCompleted: startWatch()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("RoomsPanel.qml")
    visible: false
    onLoaded: { root.injectPanel(); Qt.callLater(root.injectPanel) }
  }

  Process {
    id: watchProc
    stdout: SplitParser { onRead: function(data) { root.readLine(data) } }
    stderr: StdioCollector { id: watchErr }
    onExited: function(code) {
      if (root.reloading) { root.reloading = false; root.startWatch(); return }
      if (code === 127) root.status = "missing"
      else if (code === 3) root.status = "old"
      else root.status = "stopped"
      root.failures++
      // Missing or too old: look again each minute (and at once when the panel opens), so an install shows soon.
      restart.interval = (code === 127 || code === 3) ? 60000 : Rooms.backoffMs(root.failures)
      restart.restart()
    }
  }
  Timer { id: restart; repeat: false; onTriggered: root.startWatch() }

  Process {
    id: herdrProc
    command: [root.launcher, "herdr", "agents"]
    stdout: StdioCollector { id: herdrOut; onStreamFinished: root.herdr = Rooms.parseHerdr(herdrOut.text) }
  }
  // Often while the panel is open, seldom otherwise: herdr's state is a local socket, cheap to ask.
  Timer {
    interval: root.opened ? 4000 : 30000
    repeat: true; running: true; triggeredOnStart: true
    onTriggered: root.refreshHerdr()
  }
  Process {
    id: bringProc
    stdout: StdioCollector { id: bringOut }
    stderr: StdioCollector { id: bringErr }
    onExited: function(code) {
      root.herdrNote = code === 0 ? tr.t("panel.herdrBrought")
                                  : tr.t("panel.herdrBringFailed").arg(String(bringErr.text || "").split("\n")[0].slice(0, 160))
      root.refreshHerdr()
    }
  }

  Process {
    id: copyProc
    property string pending: ""
    command: [root.launcher, "copy"]
    stdinEnabled: true
    onStarted: { write(pending); stdinEnabled = false; pending = "" }
    onExited: stdinEnabled = true
  }

  readonly property var ipcRegistry: typeof Commons.IpcRegistry !== "undefined" ? Commons.IpcRegistry : null
  IpcHandler {
    id: ipc
    target: "io.github.jagritvats.crossroom"
    enabled: root.ipcRegistry && typeof root.ipcRegistry.leads === "function"
             ? root.ipcRegistry.leads(ipc, root.ipcRegistry.revision) : true
    onTargetChanged: if (root.ipcRegistry && typeof root.ipcRegistry.touch === "function") root.ipcRegistry.touch()
    Component.onCompleted: if (root.ipcRegistry) root.ipcRegistry.register(ipc)
    Component.onDestruction: if (root.ipcRegistry) root.ipcRegistry.unregister(ipc)
    function open(): void { root.open() }
    function toggle(): void { root.toggle() }
    function needsYou(): int { return root.needsYou }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: Rooms.barText(root.status === "ok" ? root.state : null)
    active: root.needsYou > 0
    horizontalMargin: root.needsYou > 0 ? 8.75 : 6
    tooltipText: root.status === "missing" ? tr.t("bar.tooltip.missing")
               : root.status === "old" ? tr.t("bar.tooltip.old")
               : root.status === "starting" ? tr.t("bar.tooltip.starting")
               : root.needsYou > 0 ? tr.t("bar.tooltip.needs").arg(root.live).arg(root.needsYou)
               : root.live > 0 ? tr.t("bar.tooltip.rooms").arg(root.live)
               : tr.t("bar.tooltip.idle")
    onPressed: function(b) {
      if (b === Qt.MiddleButton) {
        // The room that needs you (else the latest live one), read right in the panel.
        var first = Rooms.activeRooms(root.rooms)[0]
        if (first && panelLoader.item) { panelLoader.item.open(); panelLoader.item.viewRoom(first) }
        return
      }
      root.toggle()
    }
  }
}
