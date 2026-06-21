# The navigate-and-learn loop

The **Behavior layer** of [power-user-navigation.md](power-user-navigation.md):
how an agent uses a [ui-map.json](ui-map-schema.md) to reach a destination with
minimal perception, and how it keeps the map current when the UI drifts.

## navigate(goal)

```
navigate(goal):
  dest    = map.goals[goal]            # alias → screen id
  here    = whichScreen(describe_ui()) # match current tree against screen signatures
  route   = bfs(map.edges, from=here, to=dest)   # shortest tap sequence
  if no route: → LEARN (explore from `here` toward dest), then retry

  for edge in route:
    tap { identifier: edge.tap }
    state = settle()                   # re-read until the tree stabilizes (no fixed sleep)
    if signature(state) != map.screens[edge.to].signature:
        → DRIFT at edge → REPAIR, then re-plan from the current screen
  return arrived at dest
```

Key properties:

- **One tap per edge, one cheap signature check between** — not a full
  read-reason-act model round-trip per step. The route came from the map, so the
  model isn't re-deciding each move.
- **`whichScreen`** matches the live tree's identifiers against each screen's
  `signature` (a set-containment test). The `screen.<name>` root id makes this
  reliable even when data-dependent controls vary.
- **`settle()`** polls `describe_ui` until the identifier set stops changing
  (handles transitions/animation) instead of guessing a sleep duration.

## Detecting drift

Drift is any mismatch between prediction and reality:

- **Wrong arrival** — after tapping `edge.tap`, the new screen's signature isn't
  `edge.to`'s signature.
- **Missing control** — `edge.tap` isn't present on the current screen (the
  identifier was renamed/removed). `tap { identifier }` already fails loudly with
  the nearest identifiers on screen — feed that into repair.
- **No route** — the goal's destination has no path from here in the map.

## REPAIR / LEARN

When drift or a missing route occurs, fall back to the slow-but-general
perceive-and-explore loop, then write back what you learned:

```
repair(from, goal):
  explore: from the current screen, describe_ui, try the most likely nav control
           toward `goal` (by id/label/semantics), settle, record (from, tappedId, arrivedScreen)
  until you reach `goal` or exhaust a step budget
  update the in-memory map: add/fix the edge(s) and the screen signature(s) you saw
  stamp screens[arrived].lastVerifiedVersion = app version
  PERSIST: write the delta back to ui-map.json as an explicit, reviewable commit
```

Persisting as a **commit** (not a silent in-place mutation) matters: the map is a
versioned contract, so its changes should be visible in review and tied to the app
version — not a hidden recovery path that quietly diverges from the code.

## Why this converges

- **Stable identifiers** (Identity layer) mean most of the map survives a UI change
  — only the screens that actually moved drift, so repair is local and rare.
- **Per-screen `lastVerifiedVersion`** lets the map age gracefully: a version bump
  doesn't invalidate everything, it just lowers confidence until each screen is
  re-verified on next visit.
- **Learn-on-drift** means the map gets *more* accurate with use, and a UI change
  surfaces as a small reviewable map diff rather than a broken run.

## Minimal first version

You don't need the full loop on day one:

1. Hand-seed `ui-map.json` for the navigation spine (one guided exploration run).
2. Implement `navigate(goal)` (lookup + tap-by-identifier + signature verify).
3. On any drift, **stop and report** with the live `describe_ui` — repair manually,
   commit the map fix.
4. Automate REPAIR/LEARN later once the spine is trustworthy.

This gives the speed win immediately; the self-healing is an enhancement on top.
