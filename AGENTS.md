# Crossroom for Omarchy: notes for contributors and coding agents

The working brief for anyone (a person or a coding agent) who picks this plugin up. It was written
on Windows, with no Wayland, Hyprland or Quickshell, so **the QML has never run**. The logic, the
launcher and the shape of the QML are tested headlessly (below). Everything in "Needs a real Omarchy
machine" still needs doing on Omarchy 4.x, in a VM or on hardware.

## What this is

An Omarchy 4.x shell plugin (`bar-widget`) for Crossroom, built on the public `crossroom` client
(npm `crossroom`, Apache-2.0, github.com/jagritvats/crossroom-cli). It needs nothing else: no
Crossroom server on this machine, and no route the hosted instance doesn't already serve.

```
manifest.json            plugin id io.github.jagritvats.crossroom, one bar widget
BarWidget.qml            the button; runs the watch, keeps the state, raises notices, IPC (open, toggle, needsYou)
RoomsPanel.qml           the panel: rooms and what each needs, Open, Copy link, New room and its seat lines
CrossroomTranslations.qml, CrossroomKeyboardPanel.qml
                         stand-ins for shells older than 4.5 (no translation catalog, no lazy panel),
                         taken from the Dolly plugin; on 4.5+ they pass through to the shell's own
lib/rooms.js             every decision, as plain ES5 (.pragma library): reading a line, ordering,
                         reasons, the bar text, when to notify, cleaning a topic and an id
bin/crossroom-bar        the one program the QML runs: finds `crossroom`, then watch | open |
                         copy-link | copy | new | which
i18n/en.json             every string
tests/                   node --test, no dependencies
```

### How it reads the rooms

`crossroom rooms --watch --json --interval <s>` (added to the client for this plugin, in
packages/cli/src/commands/rooms-watch.ts of the Crossroom repository) prints one JSON line whenever
a room changes:

```json
{"type":"rooms","at":"…","live":2,"needsYou":1,
 "rooms":[{"id":"…","short":"…","title":"…","host":"app.crossroom.dev","state":"live",
           "yourTurn":1,"approval":["B"],"asking":[],"away":[],"stalled":[],
           "lastActivityAt":"…","needsYou":true}]}
```

It covers the rooms whose owner keys the client keeps (`cli-rooms.json` in its data folder). On each
pass it asks the lookup route for every room, and the liveness and owner snapshot for each live room
(at most 12). A seat is **stalled** by the web app's rule: something waits for it, it isn't
listening, and it has been quiet for two minutes. Attention marks (`approval`, `asking`, `away`)
come from the liveness, so they show within one interval, 20 s by default.

New room runs `crossroom new [<topic>] --no-seat --json --seats <n>`, which takes no seat and prints
each seat's paste line and no private link. The panel keeps those lines in memory for the session.

## Rules (each has a test)

- **Owner keys stay in `crossroom`.** Nothing in the plugin reads `cli-rooms.json`, a private link,
  or `x-parley-owner`. Copy link runs `crossroom open <id> --print | wl-copy` inside the launcher, so
  the link passes through a pipe and never through the QML or an argv
  (`tests/static.test.mjs`, `tests/launcher.test.mjs`).
- **Commands take fixed words and room ids.** Every process the QML starts is `bin/crossroom-bar`
  or `notify-send`. A room id reaches a command only through `Rooms.safeShort` (alphanumeric first,
  so never a flag), and a topic only through `Rooms.topicArg`, which leaves one line with no leading
  dash.
- **A notice is a fixed sentence and a count.** "A room needs you." / "%1 rooms need you." It has
  no title, id or seat line, because a process's command line is readable by every account. It is
  raised when a room and its reason appear that weren't there before, never for the first state
  after the bar starts, and never twice for the same thing.
- **Titles are plain text.** An agent may have written a room's title (a quick room takes its first
  line), so every `Label` showing one sets `textFormat: Text.PlainText`.
- **Copy says what you bring**, as in the Crossroom repository: your agents under your own logins,
  a recap kept from the record.
- **Installs nothing.** The plugin names `npm install -g crossroom` and never runs a package manager.

## Tests

`make test` = `node --test tests/*.test.mjs` (Node 22+). On Windows it needs Git Bash's `bash` on
PATH, or `BASH_FOR_TESTS` set.

- `rooms.test.mjs`: lib/rooms.js loaded as QML loads it (`vm`, the `.pragma` line stripped).
- `launcher.test.mjs`: bin/crossroom-bar under bash, with a fake `crossroom` and `wl-copy` that
  record their argv and stdin: version gate, id and topic checks, the link only on stdin.
- `static.test.mjs`: braces balance, every `tr.t` key exists and every string is used, every
  command's shape, the notice's arguments, plain-text titles, the manifest against its schema and
  files, ES5 only in lib/rooms.js, and that the launcher and the panel agree on the minimum version.

The client side (`rooms --watch`, `new --no-seat`) is tested in the Crossroom repository, against a
real server in process (`apps/server/src/commands/rooms-watch.test.ts`, `new-output.test.ts`).

## Needs a real Omarchy machine

| # | what | how | expect |
|---|------|-----|--------|
| 1 | Manifest | `omarchy plugin validate .` | passes. `category: "Productivity"` is a guess and may need to be a value the shell knows |
| 2 | Install | commit, then `omarchy plugin add "file://$PWD" --enable --yes` | the mark appears in the bar's right section; `qs log` shows no QML errors |
| 3 | No crossroom | uninstall the CLI, reload the shell | tooltip and panel say to install it; the watch retries every 5 min, not in a loop |
| 4 | Old crossroom | install 0.3.0 | "update the crossroom command"; exit 3 path |
| 5 | Shell PATH | install crossroom with npm under mise | `bin/crossroom-bar which` from the shell finds it (`~/.local/share/mise/shims`); if not, add the dir to the launcher's list |
| 6 | Rooms show | `crossroom new "test" --seats 2` in a terminal, paste a line into Claude Code | the room appears live in the panel; Open opens it in the browser with its key |
| 7 | Your turn | have an agent `request_context to=human` | within one interval the bar shows `󰭹 1`, lit; one notice "A room needs you."; the row says "Your turn" |
| 8 | Approval | a Claude Code seat with the Crossroom plugin hits a permission prompt | "Seat X: waiting for its user to approve a step" within one interval |
| 9 | Stalled | an attached agent ends its turn with a message waiting for it | after 2 min plus one interval: "quiet, with something waiting for it" |
| 10 | Copy link | press Copy link, paste into the browser | the room opens; `ps -ef` during the copy never shows the link |
| 11 | New room | type a topic, choose 3, Open room | three Seat buttons; each copies a paste line; the room is listed |
| 12 | `copyProc` | Seat button twice quickly | both copies land (the Process stdin open/close path is untested) |
| 13 | Settings | `omarchy bar set io.github.jagritvats.crossroom interval 60` | the watch restarts at once with `--interval 60` (`ps`) |
| 14 | IPC | `omarchy-shell io.github.jagritvats.crossroom toggle` | the panel opens under the bar in front |
| 15 | Theme | `omarchy theme set <another>` | colours follow (Commons.Color) |
| 16 | Long titles, 12+ rooms | many rooms | rows elide, the panel scrolls, nothing overflows the screen |
| 17 | Notice daemon | the shell's notifications | title "Crossroom", body only the count; DND respected |

Things modelled on Dolly but never run here: `Panel` / `KeyboardPanel` geometry (`fittedContentWidth`,
`fittedContentHeight`), `ActionButton` without `iconText` content, `Process.stdinEnabled` with
`write()` in `onStarted`, and `SplitParser` on a long-running process.

## Next

- A notice whose click opens the panel (`notify-send --action`, then the IPC `open`).
- Hearing attention at once instead of on the next pass: a watch that follows each live room's event
  stream (`crossroom watch` already reads it, and `RoomSignals` already works out approval and questions).
- Recaps of ended rooms (`crossroom memory`), and the agent sessions on this computer to reopen in a
  room (`crossroom sessions`).
- Copying a seat's line for rooms not opened from the panel: the server keeps only a hash of each
  seat token, so that would mean replacing the link, which needs its own confirmation.
