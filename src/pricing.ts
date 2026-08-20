import { business } from "./business.config.js";

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

/**
 * Price AI-extracted items against the menu (rules, not AI).
 * Anything that matches nothing is reported, never silently priced.
 */
export function priceItems(items: Array<{ name: string; quantity: number }>): PricingResult {
  const lineItems: LineItem[] = [];
  const unknownItems: string[] = [];
  let total = 0;

  for (const item of items) {
    const n = normalize(item.name);
    const match = business.menu.find((m) => {
      const nn = normalize(m.name);
      if (n === nn) return true;
      if (m.aliases.some((a) => normalize(a) === n)) return true;
      if (n.length >= 3 && (n.includes(nn) || nn.includes(n))) return true;
      return false;
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