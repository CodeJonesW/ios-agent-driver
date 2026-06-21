# ui-map.json schema

The **Map layer** of [power-user-navigation.md](power-user-navigation.md): a small,
versioned description of an app's navigable screens and how to move between them.
Live it in *your app's* repo so it versions in lockstep with the UI. A runnable
template is in [../examples/ui-map.example.json](../examples/ui-map.example.json).

> **What the string values are — labels vs identifiers.** The `signature` and
> `edges[].tap` values are whatever **hook your driver can read** (see the
> [convention's driver caveat](accessibility-identifier-convention.md)). With
> **idb** driving a SwiftUI app, use **`accessibilityLabel`s** (e.g. `"Menu"`,
> `"History"`) — idb can't see SwiftUI identifiers. With **WebDriverAgent/Appium**
> or a UIKit app, use **identifiers** (e.g. `"nav.home.menu"`). The example below
> uses identifiers; a label-based map is identical with label strings instead.
> Add `"hook": "label"` or `"hook": "identifier"` at the top so a reader knows
> which channel the strings are, and so `tap` is called with the right argument.

## Shape

```jsonc
{
  "app": "com.example.app",        // bundle id this map describes
  "appVersion": "1.27.4",          // app MARKETING_VERSION the map was verified against
  "entry": "home",                 // screen id you land on after launch + auth
  "screens": {
    "<screenId>": {
      "signature": ["screen.home", "nav.home.menu"],  // ids that prove "you are here"
      "controls": {                 // optional: notable controls on this screen
        "nav.home.menu": "opens the drawer",
        "nav.home.calendar": "opens calendar"
      },
      "lastVerifiedVersion": "1.27.4"  // per-screen freshness (drift repair updates this)
    }
  },
  "edges": [
    { "from": "home",   "tap": "nav.home.menu",      "to": "drawer" },
    { "from": "drawer", "tap": "nav.drawer.history", "to": "history" }
  ],
  "goals": {                        // human aliases → destination screen
    "view history": "history",
    "open my plan": "plan"
  }
}
```

## Fields

- **`app` / `appVersion`** — what this map describes and when it was last fully
  verified. `appVersion` should track the app's `MARKETING_VERSION`.
- **`entry`** — the screen id the app rests on after launch (post-auth). Routes
  are computed from the *current* screen, but `entry` is the default start.
- **`screens[id].signature`** — the set of identifiers whose presence uniquely
  identifies this screen. Used both to **detect which screen you're on** and to
  **verify arrival** after a tap. Prefer the `screen.<name>` root id plus 1–2
  stable controls; avoid data-dependent ids.
- **`screens[id].controls`** — optional human-readable index of useful controls
  (documentation + hints for exploration). Not required for routing.
- **`screens[id].lastVerifiedVersion`** — per-screen freshness stamp. Drift repair
  re-verifies a screen and bumps this; lets the map age gracefully screen-by-screen
  instead of invalidating wholesale on a version bump.
- **`edges[]`** — directed: from screen, `tap` this identifier, arrive at `to`
  screen. This is the graph the router walks. For modal dismissals, model a
  `back`/`close` edge (e.g. `action.calendar.close`).
- **`goals`** — named destinations so a skill can say `navigate("view history")`
  without knowing screen ids.

## Routing

Finding a path is a breadth-first search over `edges` from the current screen
(detected by matching `signature`s) to the goal's destination — the shortest tap
sequence wins. Because the graph is tiny (tens of nodes), this is instant and needs
no library.

## Sub-states (tabs within a screen)

Segmented controls / in-screen tabs are **not** separate screens. Model them as
edges whose `from` and `to` are the same screen id but that record the tap, or as a
`subStates` list on the screen. Keep the node count to genuine navigations.

## Versioning & drift

- The map is committed with the app, so a UI PR that moves navigation updates the
  map in the same change.
- At runtime, an arrival whose actual signature ≠ the map's expected signature is
  **drift**. The navigate-and-learn loop
  ([navigate-and-learn-loop.md](navigate-and-learn-loop.md)) repairs the affected
  screen/edge and re-stamps `lastVerifiedVersion`, rather than throwing the whole
  map away.
