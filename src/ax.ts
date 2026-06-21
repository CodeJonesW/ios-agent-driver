/** A normalized UI element, decoupled from idb's raw field names. */
export interface UIElement {
  /** accessibilityIdentifier (idb's AXUniqueId) — a stable, code-owned id. */
  identifier: string | null;
  label: string | null;
  type: string | null;
  value: string | null;
  enabled: boolean;
  frame: { x: number; y: number; width: number; height: number } | null;
}

function toFrame(raw: unknown): UIElement["frame"] {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const x = Number(f.x), y = Number(f.y), width = Number(f.width), height = Number(f.height);
  if ([x, y, width, height].some((n) => Number.isNaN(n))) return null;
  // Round to whole points — sub-pixel noise (e.g. 434.00000000000006) only
  // bloats the tree the agent reads and never changes a tap target.
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/**
 * Normalize idb's `describe-all` JSON into UIElement[]. idb field names have
 * drifted across versions (AXLabel/label, AXValue/value, role/type), so we read
 * each from its known aliases rather than assuming one shape.
 */
export function normalize(raw: unknown[]): UIElement[] {
  return raw.map((item) => {
    const e = item as Record<string, unknown>;
    const identifier = (e.AXUniqueId ?? e.identifier ?? null) as string | null;
    const label = (e.AXLabel ?? e.label ?? e.title ?? null) as string | null;
    const type = (e.type ?? e.role ?? e.role_description ?? null) as string | null;
    const value = (e.AXValue ?? e.value ?? null) as string | null;
    return {
      identifier: identifier && String(identifier).length > 0 ? String(identifier) : null,
      label: label && String(label).length > 0 ? String(label) : null,
      type: type ? String(type) : null,
      value: value != null ? String(value) : null,
      enabled: e.enabled !== false,
      frame: toFrame(e.frame ?? e.AXFrame),
    };
  });
}

export interface LabelMatch {
  element: UIElement;
  center: { x: number; y: number };
}

/**
 * Find a tappable element by accessibility label. Tries, in order:
 * exact match, case-insensitive equality, case-insensitive substring.
 * Prefers enabled elements with a usable frame. Returns null if none match.
 */
export function findByLabel(elements: UIElement[], query: string): LabelMatch | null {
  const withFrame = elements.filter((e) => e.frame && e.label);
  const exact = withFrame.filter((e) => e.label === query);
  const ciEqual = withFrame.filter((e) => e.label!.toLowerCase() === query.toLowerCase());
  const ciIncludes = withFrame.filter((e) => e.label!.toLowerCase().includes(query.toLowerCase()));

  for (const bucket of [exact, ciEqual, ciIncludes]) {
    const pick = bucket.find((e) => e.enabled) ?? bucket[0];
    if (pick) return { element: pick, center: center(pick) };
  }
  return null;
}

/**
 * Find a tappable element by accessibilityIdentifier. Identifiers are stable,
 * code-owned codes, so matching is EXACT (then case-insensitive exact as a
 * lenient fallback) — never substring, so "screen.home" can't match
 * "screen.home.menu". Prefers enabled elements with a usable frame.
 */
export function findByIdentifier(elements: UIElement[], id: string): LabelMatch | null {
  const withFrame = elements.filter((e) => e.frame && e.identifier);
  const exact = withFrame.filter((e) => e.identifier === id);
  const ciEqual = withFrame.filter((e) => e.identifier!.toLowerCase() === id.toLowerCase());

  for (const bucket of [exact, ciEqual]) {
    const pick = bucket.find((e) => e.enabled) ?? bucket[0];
    if (pick) return { element: pick, center: center(pick) };
  }
  return null;
}

/** Identifiers closest to a failed query, for actionable "did you mean" errors. */
export function nearestIdentifiers(elements: UIElement[], id: string, limit = 8): string[] {
  const q = id.toLowerCase();
  const ids = elements.map((e) => e.identifier).filter((i): i is string => !!i);
  const unique = Array.from(new Set(ids));
  return unique
    .map((i) => ({ i, score: i.toLowerCase().includes(q) || q.includes(i.toLowerCase()) ? 0 : 1 }))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.i);
}

export function center(e: UIElement): { x: number; y: number } {
  if (!e.frame) throw new Error("element has no frame; cannot compute tap point");
  return {
    x: Math.round(e.frame.x + e.frame.width / 2),
    y: Math.round(e.frame.y + e.frame.height / 2),
  };
}

/** Labels closest to a failed query, for actionable "did you mean" errors. */
export function nearestLabels(elements: UIElement[], query: string, limit = 8): string[] {
  const q = query.toLowerCase();
  const labels = elements
    .map((e) => e.label)
    .filter((l): l is string => !!l);
  const unique = Array.from(new Set(labels));
  return unique
    .map((l) => ({ l, score: l.toLowerCase().includes(q) || q.includes(l.toLowerCase()) ? 0 : 1 }))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.l);
}
