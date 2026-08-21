import { getClient, getMenuDataSource } from "./notion/client.js";
import { business } from "./business.config.js";

/**
 * The live menu lives in Notion so the owner can edit items and prices without
 * touching code. Loaded per order (60s cache); falls back to business.config
 * when the Menu database is missing, empty, or unreadable — a pricing outage
 * must never block intake.
 */
export type MenuEntry = { name: string; aliases: string[]; price: number };
export type LoadedMenu = { entries: MenuEntry[]; source: "notion" | "config" };

const CACHE_TTL_MS = 60_000;
let cache: { at: number; menu: LoadedMenu } | null = null;

function configMenu(): LoadedMenu {
  return { entries: business.menu.map((m) => ({ name: m.name, aliases: [...m.aliases], price: m.price })), source: "config" };
}

export async function loadMenu(force = false): Promise<LoadedMenu> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.menu;

  let loaded: LoadedMenu;
  try {
    const dsId = await getMenuDataSource();
    const entries: MenuEntry[] = [];
    let cursor: string | undefined;
    do {
      const res = await getClient().dataSources.query({
        data_source_id: dsId,
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      for (const page of res.results) {
        if (!("properties" in page)) continue;
        const props = page.properties as Record<string, unknown>;
        const name = titleText(props["Item"]);
        if (!name) continue;

        const available = availableOf(props["Available"]);
        if (!available) continue;

        const price = number_(props["Price"]) ?? 0;
        const aliases = aliasList(text_(props["Aliases"]));
        entries.push({ name, aliases, price });
      }
      cursor = res.has_more ? (res as { next_cursor?: string | null }).next_cursor ?? undefined : undefined;
    } while (cursor);

    loaded = entries.length > 0 ? { entries, source: "notion" } : configMenu();
  } catch {
    loaded = configMenu();
  }

  cache = { at: Date.now(), menu: loaded };
  return loaded;
}

function titleText(prop: unknown): string {
  const p = prop as { type?: string; title?: Array<{ plain_text?: string }> } | undefined;
  if (!p || p.type !== "title") return "";
  return (p.title ?? []).map((r) => r.plain_text ?? "").join("").trim();
}

function text_(prop: unknown): string {
  const p = prop as { type?: string; rich_text?: Array<{ plain_text?: string }> } | undefined;
  if (!p || p.type !== "rich_text") return "";
  return (p.rich_text ?? []).map((r) => r.plain_text ?? "").join("");
}

function number_(prop: unknown): number | null {
  const p = prop as { type?: string; number?: number | null } | undefined;
  if (!p || p.type !== "number") return null;
  return p.number ?? null;
}

/** Missing/unset Available counts as available; only an explicit false hides an item. */
function availableOf(prop: unknown): boolean {
  const p = prop as { type?: string; checkbox?: boolean } | undefined;
  if (!p || p.type !== "checkbox") return true;
  return p.checkbox !== false;
}

function aliasList(raw: string): string[] {
  return raw
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
}

export function menuNames(menu: LoadedMenu): string[] {
  return menu.entries.map((e) => e.name);
}
