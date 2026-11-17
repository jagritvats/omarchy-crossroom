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

  Process {
    id: newProc
    stdout: StdioCollector { id: newOut }
    onExited: function(code) {
      var room = code === 0 ? Rooms.parseNewRoom(newOut.text) : null
      if (!room) { root.newState = "failed"; return }
      root.newState = ""
      root.made = room
      if (hostWidget) hostWidget.rememberNewRoom(room)
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
            text: tr.t("panel.title", "Crossroom")
            font.pixelSize: Style.font.title; font.bold: true
          }

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

              Item {
                width: parent.width
                height: Math.max(title.implicitHeight, openBtn.implicitHeight)
                Label {
                  id: title
                  anchors.left: parent.left; anchors.right: actions.left; anchors.rightMargin: Style.space(6)
                  anchors.verticalCenter: parent.verticalCenter
                  text: row.r.title || row.r.short
                  textFormat: Text.PlainText
                  elide: Text.ElideRight
                  font.bold: row.r.needsYou
                  color: row.r.needsYou ? root.urgent : root.fg
                }
                Row {
                  id: actions
                  anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter
                  spacing: Style.space(4)
                  ActionButton {
                    id: openBtn
                    visible: row.r.state !== "gone" && row.r.state !== "unknown"
                    text: tr.t("panel.open"); iconText: "󰏌"; bordered: true
                    foreground: root.fg; fontFamily: root.ff
                    onClicked: { root.close(); if (hostWidget) hostWidget.openRoom(row.r.short) }
                  }
                  ActionButton {
                    visible: row.r.state !== "gone" && row.r.state !== "unknown"
                    text: root.copied === "link:" + row.r.id ? tr.t("panel.copied") : tr.t("panel.copyLink")
                    iconText: "󰆏"
                    bordered: true; foreground: root.fg; fontFamily: root.ff
                    onClicked: root.copyLink(row.r)
                  }
                }
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
                  foreground: root.seats === modelData ? root.accent : root.dim
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
              visible: !!root.made
              width: parent.width; wrapMode: Text.Wrap; color: root.fg
              text: tr.t("panel.newDone")
            }
            Flow {
              visible: !!root.made
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
