/** A normalized UI element, decoupled from idb's raw field names. */
export interface UIElement {
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
  return { x, y, width, height };
}

/**
 * Normalize idb's `describe-all` JSON into UIElement[]. idb field names have
 * drifted across versions (AXLabel/label, AXValue/value, role/type), so we read
 * each from its known aliases rather than assuming one shape.
 */
export function normalize(raw: unknown[]): UIElement[] {
  return raw.map((item) => {
    const e = item as Record<string, unknown>;
    const label = (e.AXLabel ?? e.label ?? e.title ?? null) as string | null;
    const type = (e.type ?? e.role ?? e.role_description ?? null) as string | null;
    const value = (e.AXValue ?? e.value ?? null) as string | null;
    return {
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
