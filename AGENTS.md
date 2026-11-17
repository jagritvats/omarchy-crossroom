# Crossroom for Omarchy: notes for contributors and coding agents

The working brief for anyone (a person or a coding agent) who picks this plugin up. It was written
on Windows and first run on Omarchy 4.5.0 in a VirtualBox VM on 2026-11-17 ("Verified on Omarchy
4.5.0" below). The logic, the launcher and the shape of the QML are also tested headlessly.

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

## Verified on Omarchy 4.5.0 (VirtualBox VM, Hyprland 0.56.2, 2026-11-17)

Against app.crossroom.dev, with crossroom built from the branch that adds `rooms --watch`:

- `omarchy plugin validate .` passes (category `Productivity` accepted); `omarchy plugin add
  "file://$PWD" --enable --yes` puts the mark in the bar's right section.
- `bin/crossroom-bar which` finds a mise-installed crossroom through `~/.local/share/mise/shims`.
- Two agents played with curl: a question to the owner turned the bar to `󰭹 1`, lit, within one
  pass; the row read "Your turn: an agent asked you a question". A permission prompt reported
  through `/api/hook/attention/<token>` added "Seat B: waiting for its user to approve a step", and
  two minutes later "Seat A: quiet, with something waiting for it" (the stall rule).
- The notice, read with `dbus-monitor` on `org.freedesktop.Notifications.Notify`: app "Crossroom",
  summary "Crossroom", body "A room needs you.", nothing else.
- Real clicks: Copy link put the private link on the clipboard; Open opened Chromium on the room as
  its owner; New room (typed topic, 3 agents) opened a room and its Seat A/B/C buttons each copied
  that seat's own line, repeatedly; the IPC `open` and `needsYou` answer.
- `omarchy bar set io.github.jagritvats.crossroom interval 30` restarted the watch at once with
  `--interval 30`. Ending the rooms cleared the bar; ended rows keep Open and Copy link.

Second pass, the same day, with crossroom built from the branch that adds `seats` to each line and
`seats --open`:

- **View** on a room opened the room in the panel: its history as "18:04  A Payments: …",
  "… joined", local time, the bookkeeping events left out (`viewLine`). A message seat B said while
  it was open appeared within seconds. Back returned to the list.
- **Joined from this computer** listed a seat recorded with `crossroom seat <link>`: "Seat B ·
  Checkout · crossroom-test · Live", "1 new for its agent", "No session holds it: /crossroom:resume
  takes it up". Open on it opened the seat's own page (`/seat#t=`, "You are Agent B").
- The room's own row read "Seat B: quiet, with something waiting for it" at the same time: the
  stall rule and the joined seat's count agree.

Third pass (herdr 0.9.1, crossroom built with `launch --in herdr`):

- `crossroom launch <links> --in herdr --with claude` made a workspace with a pane per seat and
  started Claude Code in each with its seat line; `herdr agent list` listed both.
- From the panel, New room > Start in herdr > Claude Code opened a room whose row showed "Seat A ·
  claude · idle" and "Seat B · claude · idle" with Focus; Focus moved herdr's focus to that agent
  (`herdr agent list` reported `focused=true`). Agents in no room were listed under Agents in herdr
  with Into <room>. Live rooms came first; Ended (8) folded the rest.
- Not run live: Into (bringing a running agent in). The VM's Claude Code had never been set up, so a
  prompt would have answered its first-run theme screen; `tests/herdr.test.mjs` covers the steps.
  With a signed-in agent: press Into, and the room should gain a seat and the agent join it.

Learned there:
- **herdr takes agent names of lowercase letters, digits, `-` and `_`, 1 to 32 characters.** The
  first start named an agent `crossroom-OUL6glYY-a` and herdr refused it after the room was open.
  crossroom names them in lowercase now, and the plugin matches a name to a room ignoring case.
- A start that fails part way leaves the room open with no agent and a herdr workspace with an
  empty pane: end the room and close the workspace (`herdr workspace close <id>`).
- herdr calls an agent `idle` and `interactive_ready` while it sits on its own first-run screen: its
  state says the agent is running, not that it joined the room. The room's own state (Waiting for an
  agent, Live) says that.
- `omarchy-launch-terminal-herdr` opens herdr's TUI; herdr panes carry `HERDR_PANE_ID`.
- With crossroom missing for a moment the watch waited five minutes before trying again; it tries
  each minute now, and at once when the panel opens.
- A long one-line `guestcontrol run` failed with `VERR_NOT_SUPPORTED`; the same commands as a
  script copied in (`guestcontrol copyto`) ran. Keep scenes in a script file.
- `qs.Ui` has no `Label` or `ActionButton`; Dolly defines both inline. The shell logged
  "Label is not a type" and the panel never opened. `tests/static.test.mjs` now holds every type to
  the shell's, Qt's, Quickshell's or an inline component.
- **`omarchy plugin update` can leave the old compile running**: the shell kept reporting an error
  from the previous file. `omarchy-restart-shell` loads the new one. (`omarchy-refresh-shell`
  also resets shell.json: don't.)
- `omarchy-shell <id> open` opens the panel; `omarchy-shell shell summon <id> {}` answers `ok` but
  did not always open it.
- The panel's layout moves as the list changes: a script that clicks must take its coordinates from
  a fresh screenshot.
- `crossroom open` hands the private link to `xdg-open` as an argument, and a browser it starts
  keeps it in its own command line for as long as it runs (`/proc/<pid>/cmdline`). That is the
  client's behaviour, not the plugin's; it is raised in the Crossroom repository.

How it was driven, for next time (no SSH into the VM): `VBoxManage guestcontrol omarchy run
--username <user> --passwordfile <file> --exe /bin/bash -- -lc '<cmd>'` from Git Bash with
`MSYS_NO_PATHCONV=1`, the session's variables taken from `/proc/$(pgrep -x quickshell)/environ`;
`VBoxManage controlvm omarchy screenshotpng`; pointer with
`hyprctl dispatch "hl.dsp.cursor.move({ x = X, y = Y })"` plus a 1 px `ydotool mousemove` so the
panel sees motion, clicks with `ydotool click 0xC0` (start `ydotoold` as root with
`--socket-own=1000:1000`, and stop it after), keys with `wtype`. A command that runs `wl-copy`
must redirect its output, or the forked clipboard owner holds guestcontrol open.

## Needs a real Omarchy machine (still open)

Rows 1, 2, 5 to 8, 10, 11, 13 and 14 below are done (above). Left: 3 and 4 (no or an old crossroom,
covered headlessly by `tests/launcher.test.mjs`), 9 with a real agent, 12, 15 to 17.

| # | what | how | expect |
|---|------|-----|--------|
| 1 | Manifest | `omarchy plugin validate .` | passes. `category: "Productivity"` is a guess and may need to be a value the shell knows |
| 2 | Install | commit, then `omarchy plugin add "file://$PWD" --enable --yes` | the mark appears in the bar's right section; `qs log` shows no QML errors |
| 3 | No crossroom | uninstall the CLI, reload the shell | tooltip and panel say to install it; the watch tries again each minute, and at once when the panel opens; never in a loop |
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

Process stdin (the Seat buttons), the panel geometry and `SplitParser` on the long-running watch all ran fine in the VM.

## Next

- A notice whose click opens the panel (`notify-send --action`, then the IPC `open`).
- Hearing attention at once instead of on the next pass: a watch that follows each live room's event
  stream (`crossroom watch` already reads it, and `RoomSignals` already works out approval and questions).
- Recaps of ended rooms (`crossroom memory`), and the agent sessions on this computer to reopen in a
  room (`crossroom sessions`).
- Copying a seat's line for rooms not opened from the panel: the server keeps only a hash of each
  seat token, so that would mean replacing the link, which needs its own confirmation.
