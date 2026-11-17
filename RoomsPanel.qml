import QtQuick
import QtQuick.Window
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "." as Compat
import "lib/rooms.js" as Rooms

// The Crossroom panel under the bar button.
//
// What needs you first (a question for you, a seat waiting on its user, a seat gone quiet), then
// the live rooms, then the last few that ended. Each row opens the room's page in the browser or
// copies its private link (through a pipe into wl-copy: the link never passes through this file).
// Below them, New room opens a room with every seat free and shows a line per seat to paste into
// each agent; those lines are kept in memory for this session only.
//
// Room titles may have been written by an agent (a quick room takes its first line), so every
// one is shown as plain text.
Panel {
  id: root
  moduleName: "io.github.jagritvats.crossroom"
  ipcTarget: "io.github.jagritvats.crossroom"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root
  readonly property string launcher: hostWidget ? hostWidget.launcher : ""

  Compat.CrossroomTranslations { id: tr; directory: Qt.resolvedUrl("i18n") }

  readonly property color fg: bar ? bar.foreground : Commons.Color.foreground
  readonly property color accent: Commons.Color.accent
  readonly property color urgent: Commons.Color.urgent
  readonly property color dim: Qt.rgba(fg.r, fg.g, fg.b, 0.6)
  readonly property string ff: bar ? bar.fontFamily : Style.font.family

  readonly property string status: hostWidget ? hostWidget.status : "starting"
  readonly property var listed: hostWidget ? Rooms.shown(hostWidget.rooms, 10) : []
  readonly property var active: hostWidget ? Rooms.activeRooms(hostWidget.rooms) : []
  readonly property var recent: hostWidget ? Rooms.recentRooms(hostWidget.rooms, 10) : []
  property int activeShown: 6         // rooms shown before "Show more"
  property bool recentOpen: false
  readonly property var activePage: Rooms.paged(root.active, root.activeShown)
  readonly property var herdr: hostWidget ? hostWidget.herdr : ({ available: false, agents: [] })
  readonly property var herdrFree: Rooms.herdrFree(root.herdr.agents, hostWidget ? hostWidget.rooms : [])
  property string herdrKind: ""       // New room: "" gives paste lines; a kind starts that agent in each seat in herdr
  readonly property var newLines: hostWidget ? hostWidget.newLines : ({})

  property int seats: hostWidget ? Math.max(2, Math.min(6, Number(hostWidget.setting("seats", 2)) || 2)) : 2
  property string newState: ""        // "", "opening", "failed"
  property var made: null             // the room New room just opened: {id, short, title, lines}
  property string copied: ""          // what was copied last, to say so on its button
  property string topicText: ""       // the topic field, cleared once its room opens
  readonly property string herdrNote: hostWidget ? hostWidget.herdrNote : ""

  function open() { root.controller.show(); if (hostWidget) hostWidget.retryWatch() }
  function close() { root.controller.hide(); root.activeShown = 6 }
  function toggle() { root.opened ? close() : open() }

  function reasonText(r) {
    return Rooms.reasons(r).map(function(x) {
      var s = tr.t(x.key)
      for (var i = 0; i < x.args.length; i++) s = s.arg(x.args[i])
      return s
    })
  }
  function stateText(r) { return tr.t("state." + r.state) }

  function startRoom(topic) {
    if (newProc.running || !root.launcher) return
    root.newState = "opening"
    root.made = null
    var kind = Rooms.safeKind(root.herdrKind)
    var args = kind ? [root.launcher, "herdr", "start", String(root.seats), kind] : [root.launcher, "new", String(root.seats)]
    var t = Rooms.topicArg(topic)
    if (t) args.push(t)
    newProc.started = kind
    newProc.command = args
    newProc.running = true
  }
  function copyLine(key, text) {
    if (hostWidget) hostWidget.copyText(text)
    root.copied = key
    copiedReset.restart()
  }
  function copyLink(r) {
    if (hostWidget) hostWidget.copyLink(r.short)
    root.copied = "link:" + r.id
    copiedReset.restart()
  }

  Timer { id: copiedReset; interval: 2000; onTriggered: root.copied = "" }

  // ---- one room's own view: its events as `crossroom watch` prints them, one line each
  property var viewing: null          // the room being read, or null for the list
  property var viewLines: []
  property string viewState: ""       // "reading", "done" (the room ended), "failed"
  function viewRoom(r) {
    var s = Rooms.safeShort(r.short)
    if (!s || !root.launcher) return
    viewProc.running = false
    root.viewLines = []
    root.viewState = "reading"
    root.viewing = r
    viewProc.command = [root.launcher, "view", s]
    viewProc.running = true
  }
  function stopView() {
    viewProc.running = false
    root.viewing = null
    root.viewLines = []
    root.viewState = ""
  }
  onOpenedChanged: if (!root.opened) stopView()

  Process {
    id: viewProc
    stdout: SplitParser {
      onRead: function(data) {
        var shown = Rooms.viewLine(data, -new Date().getTimezoneOffset())
        if (shown !== null) root.viewLines = Rooms.viewAppend(root.viewLines, shown)
      }
    }
    onExited: function(code) { if (root.viewing) root.viewState = code === 0 ? "done" : "failed" }
  }

  // ---- seats agents on this computer took in rooms, anyone's
  readonly property var joined: hostWidget && hostWidget.state ? hostWidget.state.seats : []
  function seatReasonText(s) {
    return Rooms.seatReasons(s).map(function(x) {
      var t = tr.t(x.key)
      for (var i = 0; i < x.args.length; i++) t = t.arg(x.args[i])
      return t
    })
  }
  function seatMeta(s) {
    var parts = []
    if (s.letter) parts.push(tr.t("panel.copyLine").arg(s.letter) + (s.name ? " · " + s.name : ""))
    if (s.dir) parts.push(s.dir)
    parts.push(tr.t(s.room === "unreachable" ? "state.unknown" : "state." + s.room))
    return parts.join("  ·  ")
  }

  Process {
    id: newProc
    property string started: ""     // the herdr agent kind this run starts, or ""
    stdout: StdioCollector { id: newOut }
    onExited: function(code) {
      if (newProc.started) {
        // In herdr the agents took every seat: nothing to paste, the room shows once listed.
        root.newState = code === 0 ? "" : "failed"
        if (code === 0) { root.topicText = ""; root.herdrNote = tr.t("panel.herdrStarted").arg(root.seats) }
        if (hostWidget) hostWidget.refreshHerdr()
        return
      }
      var room = code === 0 ? Rooms.parseNewRoom(newOut.text) : null
      if (!room) { root.newState = "failed"; return }
      root.newState = ""
      root.made = room
      root.topicText = ""
      if (hostWidget) hostWidget.rememberNewRoom(room)
    }
  }

  // qs.Ui has no Label or ActionButton: they are this panel's own, as in Dolly's. A Label is plain
  // text unless it says otherwise, so a title an agent wrote can never render as markup.
  component Label: Text {
    textFormat: Text.PlainText
    color: root.fg
    font.family: root.ff
    font.pixelSize: Style.font.bodySmall
    elide: Text.ElideRight
  }
  component ActionButton: Button { focusable: true }

  // One room in the list: what it is, why it needs you, its herdr agents, and what you can do with it.
  component RoomRow: Column {
    id: row
    property var r: ({ id: "", short: "", title: "", host: "", state: "unknown", yourTurn: 0, approval: [], asking: [], away: [], stalled: [], needsYou: false })
    width: parent ? parent.width : 0
    spacing: Style.space(3)

    Label {
      width: parent.width
      text: row.r.title || row.r.short
      textFormat: Text.PlainText
      font.bold: row.r.needsYou
      color: row.r.needsYou ? root.urgent : root.fg
    }
    Label {
      width: parent.width
      text: row.r.short + "  ·  " + root.stateText(row.r) + (row.r.host ? "  ·  " + row.r.host : "")
      textFormat: Text.PlainText
      color: root.dim; font.pixelSize: Style.font.caption
    }
    Repeater {
      model: root.reasonText(row.r)
      delegate: Label {
        required property var modelData
        width: row.width; wrapMode: Text.Wrap
        text: modelData; textFormat: Text.PlainText
        color: root.urgent
      }
    }
    // Its agents running in herdr: what each is doing, and Focus to jump to its pane.
    Repeater {
      model: Rooms.herdrIn(root.herdr.agents, row.r)
      delegate: Row {
        required property var modelData
        spacing: Style.space(6)
        Label {
          anchors.verticalCenter: parent.verticalCenter
          text: Rooms.herdrLabel(modelData) + "  ·  " + tr.t("herdr." + modelData.status)
          textFormat: Text.PlainText
          color: modelData.status === "blocked" ? root.urgent : root.accent
          font.pixelSize: Style.font.caption
        }
        ActionButton {
          text: tr.t("panel.focus"); iconText: "󰋱"; bordered: true; foreground: root.fg; fontFamily: root.ff
          onClicked: { root.close(); if (hostWidget) hostWidget.focusAgent(modelData.pane) }
        }
      }
    }
    Flow {
      visible: row.r.state !== "gone" && row.r.state !== "unknown"
      width: parent.width; spacing: Style.space(4)
      ActionButton {
        objectName: "crossroom-view"
        text: tr.t("panel.view"); iconText: "󰈈"; bordered: true
        foreground: root.fg; fontFamily: root.ff
        onClicked: root.viewRoom(row.r)
      }
      ActionButton {
        text: tr.t("panel.open"); iconText: "󰏌"; bordered: true
        foreground: root.fg; fontFamily: root.ff
        onClicked: { root.close(); if (hostWidget) hostWidget.openRoom(row.r.short) }
      }
      ActionButton {
        text: root.copied === "link:" + row.r.id ? tr.t("panel.copied") : tr.t("panel.copyLink")
        iconText: "󰆏"; bordered: true; foreground: root.fg; fontFamily: root.ff
        onClicked: root.copyLink(row.r)
      }
    }
    // Seat lines of a room opened from this panel in this session.
    Flow {
      visible: !!root.newLines[row.r.id] && row.r.state !== "ended"
      width: parent.width; spacing: Style.space(4)
      Repeater {
        model: root.newLines[row.r.id] ? root.newLines[row.r.id].lines : []
        delegate: ActionButton {
          required property var modelData
          required property int index
          readonly property string key: row.r.id + ":" + index
          text: root.copied === key ? tr.t("panel.copied") : tr.t("panel.copyLine").arg(String.fromCharCode(65 + index))
          iconText: "󰆏"; bordered: true; foreground: root.fg; fontFamily: root.ff
          onClicked: root.copyLine(key, modelData)
        }
      }
    }
  }


  Compat.CrossroomKeyboardPanel {
    id: panel
    objectName: "crossroom-panel"
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: false
    focusTarget: panel.bodyItem
    contentWidth: panel.fittedContentWidth(Style.space(400))
    contentHeight: panel.fittedContentHeight(panel.bodyHeight)

    body: FocusScope {
      id: body
      objectName: "crossroom-panel-body"
      anchors.fill: parent
      implicitHeight: col.implicitHeight
      clip: true
      focus: true
      Keys.onPressed: function(event) {
        if (event.key === Qt.Key_Escape) { root.close(); event.accepted = true }
      }

      Flickable {
        id: viewport
        anchors.fill: parent
        contentHeight: col.implicitHeight
        boundsBehavior: Flickable.StopAtBounds
        clip: true

        Column {
          id: col
          width: viewport.width
          spacing: Style.space(10)

          Label {
            visible: !root.viewing
            text: tr.t("panel.title", "Crossroom")
            font.pixelSize: Style.font.title; font.bold: true
          }

          // ---------------- one room, read here
          Column {
            visible: !!root.viewing
            width: parent.width; spacing: Style.space(6)
            Label {
              width: parent.width
              text: root.viewing ? (root.viewing.title || root.viewing.short) : ""
              textFormat: Text.PlainText
              font.pixelSize: Style.font.subtitle; font.bold: true
            }
            Label {
              width: parent.width
              text: root.viewing ? root.viewing.short + "  ·  " + root.stateText(root.viewing) + (root.viewing.host ? "  ·  " + root.viewing.host : "") : ""
              textFormat: Text.PlainText
              color: root.dim; font.pixelSize: Style.font.caption
            }
            Flow {
              width: parent.width; spacing: Style.space(4)
              ActionButton {
                objectName: "crossroom-back"
                text: tr.t("panel.back"); iconText: "󰁍"; bordered: true; foreground: root.fg; fontFamily: root.ff
                onClicked: root.stopView()
              }
              ActionButton {
                text: tr.t("panel.open"); iconText: "󰏌"; bordered: true; foreground: root.fg; fontFamily: root.ff
                onClicked: { var r = root.viewing; root.close(); if (hostWidget && r) hostWidget.openRoom(r.short) }
              }
              ActionButton {
                text: root.viewing && root.copied === "link:" + root.viewing.id ? tr.t("panel.copied") : tr.t("panel.copyLink")
                iconText: "󰆏"; bordered: true; foreground: root.fg; fontFamily: root.ff
                onClicked: if (root.viewing) root.copyLink(root.viewing)
              }
            }
            Repeater {
              model: root.viewing ? Rooms.herdrIn(root.herdr.agents, root.viewing) : []
              delegate: Row {
                required property var modelData
                spacing: Style.space(6)
                Label {
                  anchors.verticalCenter: parent.verticalCenter
                  text: Rooms.herdrLabel(modelData) + "  ·  " + tr.t("herdr." + modelData.status)
                  textFormat: Text.PlainText
                  color: modelData.status === "blocked" ? root.urgent : root.accent
                  font.pixelSize: Style.font.caption
                }
                ActionButton {
                  text: tr.t("panel.focus"); iconText: "󰋱"; bordered: true; foreground: root.fg; fontFamily: root.ff
                  onClicked: { root.close(); if (hostWidget) hostWidget.focusAgent(modelData.pane) }
                }
              }
            }
            Label {
              visible: root.viewLines.length === 0
              width: parent.width; wrapMode: Text.Wrap; color: root.dim
              text: root.viewState === "failed" ? tr.t("panel.viewFailed") : tr.t("panel.viewReading")
            }
            Repeater {
              model: root.viewLines
              delegate: Label {
                required property var modelData
                width: col.width; wrapMode: Text.Wrap; elide: Text.ElideNone
                text: modelData; textFormat: Text.PlainText
                font.pixelSize: Style.font.caption
              }
            }
          }

          Column {
            visible: !root.viewing
            width: parent.width; spacing: Style.space(10)

          // ---------------- the crossroom command is missing or too old
          Column {
            visible: root.status === "missing" || root.status === "old"
            width: parent.width; spacing: Style.space(6)
            Label {
              width: parent.width; wrapMode: Text.Wrap; color: root.fg
              text: root.status === "old" ? tr.t("panel.old") : tr.t("panel.missing")
            }
            Label {
              objectName: "crossroom-install"
              text: tr.t("panel.missingCommand", "npm install -g crossroom")
              font.family: "monospace"; color: root.accent
            }
          }
          Label {
            visible: root.status === "stopped"
            width: parent.width; wrapMode: Text.Wrap; color: root.dim
            text: tr.t("panel.stopped")
          }

          // ---------------- the rooms
          Label {
            visible: root.status === "ok" && root.listed.length === 0
            width: parent.width; wrapMode: Text.Wrap; color: root.dim
            text: tr.t("panel.empty")
          }
          // ---------------- rooms that are live or wait for an agent, what needs you first
          Repeater {
            model: root.activePage.items
            delegate: RoomRow {
              required property var modelData
              r: modelData
            }
          }
          ActionButton {
            visible: root.activePage.more > 0
            text: tr.t("panel.showMore").arg(root.activePage.more); iconText: "󰅀"; bordered: true; foreground: root.fg; fontFamily: root.ff
            onClicked: root.activeShown += 6
          }

          // ---------------- rooms that ended, folded
          ActionButton {
            visible: root.recent.length > 0
            text: tr.t("panel.recent").arg(root.recent.length); iconText: root.recentOpen ? "󰅀" : "󰅂"
            bordered: false; foreground: root.dim; fontFamily: root.ff
            onClicked: root.recentOpen = !root.recentOpen
          }
          Repeater {
            model: root.recentOpen ? root.recent : []
            delegate: RoomRow {
              required property var modelData
              r: modelData
            }
          }

          // ---------------- seats agents on this computer took
          PanelSectionHeader {
            visible: root.joined.length > 0
            text: tr.t("panel.joined"); foreground: root.fg; fontFamily: root.ff
          }
          Repeater {
            model: root.joined
            delegate: Column {
              id: seatRow
              required property var modelData
              readonly property var s: modelData
              width: col.width
              spacing: Style.space(3)
              Label {
                width: parent.width
                text: seatRow.s.title || tr.t("panel.untitled")
                textFormat: Text.PlainText
                color: seatRow.s.room === "live" ? root.fg : root.dim
              }
              Label {
                width: parent.width
                text: root.seatMeta(seatRow.s)
                textFormat: Text.PlainText
                color: root.dim; font.pixelSize: Style.font.caption
              }
              Repeater {
                model: root.seatReasonText(seatRow.s)
                delegate: Label {
                  required property var modelData
                  width: col.width; wrapMode: Text.Wrap
                  text: modelData; textFormat: Text.PlainText
                  color: root.accent
                }
              }
              ActionButton {
                visible: seatRow.s.room !== "unreachable"
                text: tr.t("panel.openSeat"); iconText: "󰏌"; bordered: true; foreground: root.fg; fontFamily: root.ff
                onClicked: { root.close(); if (hostWidget) hostWidget.openSeat(seatRow.s.key) }
              }
            }
          }

          // ---------------- agents running in herdr that are in no room yet
          PanelSectionHeader {
            visible: root.herdr.available && root.herdrFree.length > 0
            text: tr.t("panel.herdrAgents"); foreground: root.fg; fontFamily: root.ff
          }
          Label {
            visible: root.herdrNote !== ""
            width: parent.width; wrapMode: Text.Wrap; color: root.accent
            text: root.herdrNote; textFormat: Text.PlainText
          }
          Repeater {
            model: root.herdr.available ? Rooms.paged(root.herdrFree, 6).items : []
            delegate: Column {
              id: freeRow
              required property var modelData
              width: col.width
              spacing: Style.space(3)
              Label {
                width: parent.width
                text: Rooms.herdrLabel(freeRow.modelData) + "  ·  " + tr.t("herdr." + freeRow.modelData.status)
                textFormat: Text.PlainText
              }
              Flow {
                width: parent.width; spacing: Style.space(4)
                ActionButton {
                  text: tr.t("panel.focus"); iconText: "󰋱"; bordered: true; foreground: root.fg; fontFamily: root.ff
                  onClicked: { root.close(); if (hostWidget) hostWidget.focusAgent(freeRow.modelData.pane) }
                }
                Repeater {
                  model: Rooms.paged(root.active, 3).items
                  delegate: ActionButton {
                    required property var modelData
                    text: tr.t("panel.into").arg(Rooms.shortTitle(modelData, 18))
                    iconText: "󰁔"; bordered: true; foreground: root.fg; fontFamily: root.ff
                    enabled: freeRow.modelData.status === "idle" || freeRow.modelData.status === "done" || freeRow.modelData.status === "unknown"
                    onClicked: if (hostWidget) hostWidget.bringAgent(modelData.id, freeRow.modelData.pane)
                  }
                }
              }
            }
          }

          // ---------------- a new room
          PanelSectionHeader {
            visible: root.status === "ok" || root.status === "stopped"
            text: tr.t("panel.newRoom"); foreground: root.fg; fontFamily: root.ff
          }
          Column {
            visible: root.status === "ok" || root.status === "stopped"
            width: parent.width; spacing: Style.space(6)
            TextField {
              id: topic
              objectName: "crossroom-topic"
              width: parent.width
              placeholderText: tr.t("panel.topicPlaceholder")
              text: root.topicText
              onTextEdited: root.topicText = text
              onAccepted: root.startRoom(text)
            }
            Row {
              spacing: Style.space(4)
              Label { anchors.verticalCenter: parent.verticalCenter; text: tr.t("panel.seats"); color: root.dim }
              Repeater {
                model: [2, 3, 4, 5, 6]
                delegate: ActionButton {
                  required property var modelData
                  text: String(modelData); bordered: true; fontFamily: root.ff
                  foreground: root.fg; selected: root.seats === modelData
                  onClicked: root.seats = modelData
                }
              }
            }
            Flow {
              visible: root.herdr.available
              width: parent.width
              spacing: Style.space(4)
              Label { height: Style.space(30); verticalAlignment: Text.AlignVCenter; text: tr.t("panel.herdrStart"); color: root.dim }
              Repeater {
                model: ["", "claude", "codex", "opencode"]
                delegate: ActionButton {
                  required property var modelData
                  text: modelData ? tr.t("herdr.kind." + modelData) : tr.t("panel.herdrOff")
                  bordered: true; fontFamily: root.ff; foreground: root.fg
                  selected: root.herdrKind === modelData
                  onClicked: root.herdrKind = modelData
                }
              }
            }
            ActionButton {
              objectName: "crossroom-start"
              text: root.newState === "opening" ? tr.t("panel.starting") : tr.t("panel.start")
              iconText: "󰐕"; bordered: true; foreground: root.accent; fontFamily: root.ff
              enabled: root.newState !== "opening"
              onClicked: root.startRoom(topic.text)
            }
            Label {
              visible: root.newState === "failed"
              width: parent.width; wrapMode: Text.Wrap; color: root.urgent
              text: tr.t("panel.newFailed")
            }
            Label {
              visible: Rooms.showMade(root.made, root.listed)
              width: parent.width; wrapMode: Text.Wrap; color: root.fg
              text: tr.t("panel.newDone")
            }
            Flow {
              visible: Rooms.showMade(root.made, root.listed)
              width: parent.width; spacing: Style.space(4)
              Repeater {
                model: root.made ? root.made.lines : []
                delegate: ActionButton {
                  required property var modelData
                  required property int index
                  readonly property string key: (root.made ? root.made.id : "") + ":" + index
                  text: root.copied === key ? tr.t("panel.copied") : tr.t("panel.copyLine").arg(String.fromCharCode(65 + index))
                  iconText: "󰆏"; bordered: true; foreground: root.fg; fontFamily: root.ff
                  onClicked: root.copyLine(key, modelData)
                }
              }
            }
          }
          }
        }
      }
    }
  }
}
