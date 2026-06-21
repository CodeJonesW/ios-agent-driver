# accessibilityIdentifier naming convention

A stable, code-owned naming scheme for the controls and screens an agent
navigates. This is the **Identity layer** of
[power-user-navigation.md](power-user-navigation.md).

> ## ⚠️ Driver caveat: idb does not see SwiftUI identifiers
>
> There are **two** iOS accessibility trees: the **runtime UIAccessibility tree**
> (what `idb describe-all` snapshots) and the **XCUITest automation tree** (what
> WebDriverAgent / Appium read). They differ in one way that matters here:
>
> | hook | runtime tree (idb) | automation tree (WDA/Appium) |
> |---|---|---|
> | `accessibilityLabel` | ✅ visible | ✅ visible |
> | `accessibilityIdentifier` (UIKit) | ✅ visible | ✅ visible |
> | `accessibilityIdentifier` (**SwiftUI**) | ❌ **not visible** | ✅ visible |
>
> Verified empirically: a SwiftUI `.accessibilityIdentifier("nav.home.menu")` is
> compiled into the binary but `idb describe-all` reports `AXUniqueId: null` for it,
> while its `accessibilityLabel` shows up fine. (UIKit identifiers and SF-Symbol
> names do surface — it's specifically SwiftUI's identifier modifier that doesn't
> reach the runtime tree.)
>
> **Implication for the hook:**
> - Driving a **SwiftUI** app with **idb** → key navigation on **`accessibilityLabel`,
>   scoped to the current screen** (see below). This works today.
> - Driving with **WebDriverAgent / Appium**, or a **UIKit** app → the
>   `accessibilityIdentifier` scheme below is the primary, collision-free hook.
>
> Adding the identifier scheme anyway is good **forward-proofing** (it's free and
> inert under idb), but don't expect idb to navigate by it.

## Labels as the idb hook (screen-scoped)

When idb is the driver, treat a **stable, code-set `accessibilityLabel`** as the
hook. Two rules make this as robust as identifiers in practice:

- **Set the label in code**, semantically — `.accessibilityLabel("Menu")` on an
  icon button — so it doesn't drift with visible-text or layout edits. (It is also
  the VoiceOver string, so keep it human-meaningful.)
- **Uniqueness only needs to hold per screen.** "Calendar" can be both a Home
  top-bar button and a drawer row because the map matches labels *within the
  current screen* — they're never both candidates at once. Only disambiguate when
  two controls with the same label coexist on one screen.

The `screen.* / nav.* / action.*` identifier scheme below still applies (for
WDA/Appium and as documentation); the idb map just keys on labels.

## Why identifiers, not labels

| | `accessibilityLabel` | `accessibilityIdentifier` |
|---|---|---|
| Purpose | VoiceOver text for users | automation hook |
| Stability | changes with copy / localization | a contract you own |
| Uniqueness | often duplicated ("Start", "Add") | unique by scheme |
| In idb | `AXLabel` | `AXUniqueId` |

A UI map keyed on labels rots on every copy edit; keyed on identifiers it is
stable. `ios-agent-driver` exposes identifiers in `describe_ui` and taps them via
`tap { identifier }`.

## The scheme

Lowercase, dot-separated, three prefixes:

```
screen.<name>                 root container of a screen / sheet / cover
nav.<screen>.<target>         a control that NAVIGATES to another screen
action.<screen>.<verb>        a control that performs an in-screen action
```

Rules:

- **Stable & semantic** — name by role, not by current copy. `nav.home.history`,
  not `nav.home.clock-icon`.
- **Lowercase dotted**, words hyphenated: `action.workout.save-for-later`.
- **No data interpolation**, with one exception: list rows that need per-item
  targeting use a trailing id — `nav.calendar.session-row-<sessionId>`. Keep the
  prefix stable so the map can match on it.
- **One identifier per tappable node.** Put it on the actual button/row, not a
  wrapping container (otherwise idb reports it on the wrong frame — verify with
  `describe_ui` after adding).
- **Screen roots get `screen.<name>`** so the map can compute a reliable
  *signature* (which screen am I on) even when individual controls vary by data.

## Examples (SwiftUI)

```swift
// Screen root
SomeScreen()
  .accessibilityIdentifier("screen.history")

// Navigation control
Button { showCalendar = true } label: { Image(systemName: "calendar") }
  .accessibilityIdentifier("nav.home.calendar")

// In-screen action
Button("Finish") { finish() }
  .accessibilityIdentifier("action.workout.finish")

// List row with per-item id
ForEach(sessions) { s in
  SessionRow(s)
    .accessibilityIdentifier("nav.calendar.session-row-\(s.id)")
}
```

## A note on SF Symbols

SwiftUI auto-populates `AXUniqueId` for `Image(systemName:)` with the symbol name
(e.g. `clock`, `ellipsis`). These are *not* part of this scheme — they're
incidental. The dotted `screen.* / nav.* / action.*` namespace never collides with
them, and a map should only key on scheme identifiers. (They can still be handy as
a fallback tap target before you've added intentional ids.)

## Rollout

You don't need to identify every control — only the **navigation spine** plus the
controls a flow actually touches:

1. Every screen root → `screen.<name>`.
2. Every control that changes screen → `nav.<screen>.<target>`.
3. Action controls a flow asserts on → `action.<screen>.<verb>`.

Start with the spine (all screen roots + the menu/tab/drawer that reaches them),
then add deeper controls as flows need them. Make the scheme a convention new
screens follow going forward.
