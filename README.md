# ios-agent-driver

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent **drive the
iOS Simulator in a loop** — so an agent can actually *use* your app: tap, type,
swipe, read the screen, and verify what happened.

It bridges the gap between iOS development and agentic testing. The primitives to
control a simulator exist (`xcrun simctl`, Meta's [`idb`](https://fbidb.io)), but
nothing packages them into tools an agent can call to close the
**perceive → decide → act → observe** loop. This does.

- **Accessibility-tree-first perception.** The agent reasons over labeled UI
  elements (`describe_ui`) and taps **by label**, not by guessing pixel
  coordinates — far more robust to layout changes.
- **Screenshot fallback.** For custom-drawn views that don't expose
  accessibility, `screenshot` gives a vision fallback and a way to verify state.
- **Loud failures.** A tap on a missing label returns the nearest labels on
  screen, not a silent no-op.

## How it works

```
Agent (Claude / any MCP client)
   goal: "log a leg workout, confirm it appears in History"
        observe → decide → act → observe  (loop)
        │  MCP (stdio)
   ios-agent-driver
        │                         │
   xcrun simctl              idb (+ companion)
   lifecycle, screenshots    accessibility tree,
   deeplinks, permissions    tap / type / swipe by element
```

## Requirements

- macOS with **Xcode** (provides `xcrun simctl`)
- **[idb](https://fbidb.io)** for UI perception and actions:
  ```sh
  brew tap facebook/fb && brew trust facebook/fb
  brew install facebook/fb/idb-companion   # source build — needs current Xcode Command Line Tools
  pip3 install fb-idb                       # the `idb` CLI; use pipx/venv if pip is externally-managed
  idb list-targets                          # confirm it sees your booted sim
  ```
  If the companion build errors with “Command Line Tools are too outdated”, update
  them (System Settings › Software Update, or `xcode-select --install`).
  Lifecycle tools work without idb; `describe_ui` / `tap` / `type_text` / `swipe`
  require it and will tell you how to install it if it's missing.
- **Node.js ≥ 18**

## Install

```sh
git clone https://github.com/CodeJonesW/ios-agent-driver.git
cd ios-agent-driver
npm install      # builds via the prepare script
```

## Register with Claude Code

Add to your MCP config (user-level `~/.claude.json`, or a project `.mcp.json`):

```json
{
  "mcpServers": {
    "ios-agent-driver": {
      "command": "node",
      "args": ["/absolute/path/to/ios-agent-driver/dist/server.js"]
    }
  }
}
```

Or with the Claude Code CLI:

```sh
claude mcp add ios-agent-driver -- node /absolute/path/to/ios-agent-driver/dist/server.js
```

## Tools

| Tool | Backend | Purpose |
|---|---|---|
| `list_sims` | simctl | List devices (udid, name, state, runtime). |
| `boot_sim` | simctl | Boot a sim (defaults to booted, else first iPhone). |
| `install_app` | simctl | Install a built `.app` bundle. |
| `launch` | simctl | Launch an app by bundle id. |
| `terminate` | simctl | Terminate a running app. |
| `reset_app` | simctl | Uninstall + reinstall for a clean state. |
| `deeplink` | simctl | Open a URL / universal link. |
| `set_permission` | simctl | Grant/revoke/reset a privacy permission. |
| `describe_ui` | idb | **Primary perception** — accessibility tree as JSON (incl. `identifier`). |
| `screenshot` | simctl | PNG of the current screen (vision fallback). |
| `tap` | idb | Tap by `identifier` (most stable), `label`, or x,y. |
| `type_text` | idb | Type into the focused field. |
| `swipe` | idb | Swipe/scroll by direction or coordinates. |
| `press_button` | idb | Hardware buttons (HOME, LOCK, …). |

## The loop, by example

A typical agent goal runs as a bounded loop:

```
GOAL: "open Settings and confirm Notifications is enabled"
1. boot_sim
2. launch { bundle_id: "com.apple.Preferences" }
3. describe_ui            → see "Notifications" cell
4. tap { label: "Notifications" }
5. describe_ui            → assert the toggle state
   (re-read after each action; stop when the goal predicate holds
    or a step budget is exhausted)
```

The agent owns the loop and the success predicate; this server provides the
primitives. That keeps the tool simple and the test logic where it belongs.

## Power-user navigation (navigate by a map, not by re-reading every step)

Perceiving every step is correct but slow: the wall-clock cost of a loop is
*model round-trips × steps*, not idb. Once an app is more than a couple of screens
deep, an agent can instead navigate by a **precomputed UI map** — execute a known
tap sequence with minimal perception, and only re-read the tree when something has
drifted. The pattern has three layers, each documented so any app can adopt it:

- [docs/power-user-navigation.md](docs/power-user-navigation.md) — the problem and the
  three-layer solution (Identity → Map → Behavior); when to use it.
- [docs/accessibility-identifier-convention.md](docs/accessibility-identifier-convention.md)
  — the `screen.* / nav.* / action.*` naming contract for stable, code-owned ids.
- [docs/ui-map-schema.md](docs/ui-map-schema.md) — the `ui-map.json` schema
  (nodes / edges / goals / versioning), with [examples/ui-map.example.json](examples/ui-map.example.json).
- [docs/navigate-and-learn-loop.md](docs/navigate-and-learn-loop.md) — the
  `navigate(goal)` + drift-repair algorithm that self-heals the map.

`describe_ui` surfaces each element's `identifier` (the accessibilityIdentifier),
and `tap` accepts `{ identifier }` — together these make map-based navigation
deterministic instead of guessing from labels or pixels.

## Development

```sh
npm run build     # compile TypeScript → dist/
npm start         # run the server on stdio
```

## License

MIT © Will Jones ([CodeJonesW](https://github.com/CodeJonesW))
