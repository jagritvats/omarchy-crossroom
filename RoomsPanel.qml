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
  readonly property var listed: hostWidget ? Rooms.shown(hostWidget.rooms, 5) : []
  readonly property var newLines: hostWidget ? hostWidget.newLines : ({})

  property int seats: hostWidget ? Math.max(2, Math.min(6, Number(hostWidget.setting("seats", 2)) || 2)) : 2
  property string newState: ""        // "", "opening", "failed"
  property var made: null             // the room New room just opened: {id, short, title, lines}
  property string copied: ""          // what was copied last, to say so on its button
  property string topicText: ""       // the topic field, cleared once its room opens

  function open() { root.controller.show() }
  function close() { root.controller.hide() }
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
    var args = [root.launcher, "new", String(root.seats)]
    var t = Rooms.topicArg(topic)
    if (t) args.push(t)
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
    stdout: SplitParser { onRead: function(data) { root.viewLines = Rooms.viewAppend(root.viewLines, data) } }
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
    stdout: StdioCollector { id: newOut }
    onExited: function(code) {
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
          Repeater {
            model: root.listed
            delegate: Column {
              id: row
              required property var modelData
              readonly property var r: modelData
              width: col.width
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
                  width: col.width; wrapMode: Text.Wrap
                  text: modelData; textFormat: Text.PlainText
                  color: root.urgent
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
