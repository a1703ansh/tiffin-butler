import { business } from "./business.config.js";
import type { MenuEntry } from "./menu.js";

export type LineItem = { name: string; quantity: number; unitPrice: number; lineTotal: number };
export type PricingResult = {
  lineItems: LineItem[];
  total: number;
  unknownItems: string[];
};

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when two words are identical or one edit apart (idly/idli, dose/dosa). */
function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 1) return false;
  if (Math.max(m, n) < 4) return false;

  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (m > n) i += 1;
    else if (n > m) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  if (i < m || j < n) edits += 1;
  return edits <= 1;
}

/**
 * Match the normalized customer phrase against one menu candidate:
 * exact phrase, containment (either direction), or all-tokens-fuzzy
 * (every candidate token has a lookalike token in the phrase).
 */
function phraseMatches(n: string, candidate: string): boolean {
  const c = normalize(candidate);
  if (!c) return false;
  if (n === c) return true;
  if (c.length >= 3 && (n.includes(c) || c.includes(n))) return true;

  const phraseTokens = n.split(" ");
  const candidateTokens = c.split(" ");
  return (
    candidateTokens.length > 0 &&
    candidateTokens.every((t) => phraseTokens.some((x) => x === t || editDistanceAtMost1(x, t)))
  );
}

/**
 * Price AI-extracted items against the menu (rules, not AI).
 * Anything that matches nothing is reported, never silently priced.
 */
export function priceItems(
  items: Array<{ name: string; quantity: number }>,
  menu: MenuEntry[],
): PricingResult {
  const lineItems: LineItem[] = [];
  const unknownItems: string[] = [];
  let total = 0;

  for (const item of items) {
    const n = normalize(item.name);
    const match = menu.find((m) => {
      if (phraseMatches(n, m.name)) return true;
      return m.aliases.some((a) => phraseMatches(n, a));
    });

    if (!match) {
      unknownItems.push(item.name);
      continue;
    }

    const lineTotal = match.price * item.quantity;
    total += lineTotal;
    lineItems.push({ name: match.name, quantity: item.quantity, unitPrice: match.price, lineTotal });
  }

  return { lineItems, total, unknownItems };
}

/** Human-readable line-item string, e.g. "2× Idli set (₹40) · 1× Dosa (₹60)". */
export function formatLineItems(lineItems: LineItem[]): string {
  return lineItems.map((l) => `${l.quantity}\u00D7 ${l.name} (${business.currency}${l.unitPrice})`).join(" \u00B7 ");
}