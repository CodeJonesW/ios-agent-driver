# Power-user navigation

> Make an agent navigate your app by a map it already knows, instead of
> re-reading the whole screen at every step.

This is a reusable pattern built on `ios-agent-driver`. It is **app-agnostic** —
nothing here is specific to any one app. Adopt it in your own project by following
the three layers below.

## The problem

The straightforward way to drive an app is the perceive-every-step loop:

```
describe_ui → reason → tap → describe_ui → reason → tap → …
```

This is correct and robust, but **slow** — and the slowness is not in the device.
With `ios-agent-driver`, a `describe_ui` is ~0.2s and a `tap` is ~0.1s. The real
cost is the **model round-trip on every step**: each `describe_ui` returns the
whole accessibility tree, the model reads it, decides one tap, and repeats.
Reaching a screen five taps deep means five full read-reason-act cycles.

So the wall-clock cost of a flow is roughly:

```
total ≈ (model latency + tokens-read) × number of steps
```

The lever is **fewer, smaller steps** — which is exactly what a precomputed map buys.

## The solution: three layers

### 1. Identity — stable, code-owned ids

Give the controls and screens you navigate a stable `accessibilityIdentifier`
following a naming contract (see
[accessibility-identifier-convention.md](accessibility-identifier-convention.md)).
Labels are user-facing text — they change with copy edits and localization, and
they collide. Identifiers are a contract you own in code, so a map keyed on them
doesn't churn.

`ios-agent-driver` surfaces each element's `identifier` in `describe_ui` and lets
`tap` target `{ identifier }` directly.

### 2. Map — a precomputed screen graph

Capture the app's navigation as a small graph (see
[ui-map-schema.md](ui-map-schema.md)):

- **nodes** = screens, each with a *signature* (a set of identifiers that
  uniquely says "you are here") and its key controls;
- **edges** = "from screen A, tapping id X takes you to screen B";
- **goals** = human aliases ("view history") → a destination screen.

The map is tiny compared to the live tree — a route is a few lines, not a
30-element dump. It is **versioned with the app** so it stays in lockstep with the UI.

### 3. Behavior — navigate, verify, and self-heal

Given a goal, the agent looks up the shortest route in the map and executes the
tap sequence **by identifier** with only a cheap signature check between steps —
no full tree read per step. It verifies arrival by signature. If a step doesn't
land where the map predicted (the UI drifted), it falls back to the
perceive-and-explore loop, finds the real path, and **proposes a map update**.
See [navigate-and-learn-loop.md](navigate-and-learn-loop.md).

This is the synthesis that makes it durable: **stable ids keep the learned map
from rotting, and the learn-on-drift loop keeps it current** as the app changes.

## When to use it

- ✅ Multi-screen apps where the agent repeatedly navigates to the same places
  (testing, demos, repetitive flows).
- ✅ Flows more than ~2 taps deep, where step count dominates wall-clock.
- ⚠️ For a one-off exploration of an unknown screen, plain perceive-every-step is
  fine — there's nothing to look up yet. The map pays off on *repeated* navigation.

## What you implement vs. what the MCP gives you

| You provide | The MCP provides |
|---|---|
| `accessibilityIdentifier`s in your app (Identity) | `identifier` in `describe_ui`; `tap { identifier }` |
| `ui-map.json` for your app (Map) | `describe_ui` signatures to build/verify it |
| the `navigate`/learn procedure in your skill (Behavior) | `tap` / `describe_ui` / `screenshot` primitives |

The MCP stays a thin set of primitives; the map and the navigation policy live in
your app's repo and your agent skill.
