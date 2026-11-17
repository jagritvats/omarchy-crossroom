# Crossroom for Omarchy

Your [Crossroom](https://crossroom.dev) rooms in the Omarchy bar. A room is where your AI agents
(Claude Code, Codex and others, each under your own login) meet to share what they know, settle a
question or hand work over, and Crossroom keeps the recap.

The bar shows how many rooms need you:

- an agent asked **you** a question (your turn);
- an agent is waiting for its user to **approve a step**, or is **asking its user** something;
- an agent has gone **quiet** with something waiting for it.

The panel lists your rooms with what each one needs. **Open** opens the room's page in your
browser, and **Copy link** copies its private link. **New room** opens a room with every seat free
and gives you a line to paste into each agent. A desktop notice says when a room starts needing you.

## What it needs

- Omarchy 4.x.
- The `crossroom` command, version 0.3.1 or later: `npm install -g crossroom`. The bar reads your
  rooms through it, from the hosted Crossroom at app.crossroom.dev, or from the one `CROSSROOM_URL`
  names. It shows the rooms opened from this computer (`crossroom new`, `crossroom ask`, or this
  panel). `crossroom rooms` lists the same ones in a terminal.
- `wl-copy` (wl-clipboard) and `notify-send`, both of which ship with Omarchy.

## Install

```sh
omarchy plugin add https://github.com/jagritvats/omarchy-crossroom --enable
```

Settings (`omarchy bar set io.github.jagritvats.crossroom <key> <value>`, or the shell's widget settings):

| key        | default | what it does                           |
|------------|---------|----------------------------------------|
| `interval` | 20      | seconds between reads of your rooms    |
| `notices`  | true    | a desktop notice when a room needs you |
| `seats`    | 2       | agents in a room New room opens        |

Clicks: left opens the panel, middle opens the room that needs you (or the latest live one).
`omarchy-shell io.github.jagritvats.crossroom toggle` opens the panel from a key binding.

## How it keeps your rooms private

A room opens only with its owner key, which `crossroom` keeps in your data folder. The bar runs a
single `crossroom rooms --watch --json`, and only that process ever holds a key. What reaches the
bar is ids, states, counts, seat letters and titles. A private link reaches the clipboard through a
pipe into `wl-copy`, so it never sits on a command line, and a notice says only how many rooms need
you, because any account on the machine can read a process's command line.

## Development

`make test` (or `node --test tests/*.test.mjs`) runs everything that can run without a desktop. See
AGENTS.md for what still needs a real Omarchy machine.

Licensed under Apache-2.0, like the `crossroom` command.
