/**
 * Type-safe helpers for Notion property payloads (write) and property values (read).
 * Property names must match the workspace schema (docs/setup-notion.md).
 */
import type { PageObjectResponse } from "@notionhq/client";

export function title(text: string) {
  return { title: [{ type: "text" as const, text: { content: text } }] };
}

export function richText(text: string) {
  return { rich_text: [{ type: "text" as const, text: { content: text.slice(0, 2000) } }] };
}

export function select(name: string | null | undefined) {
  return { select: name ? { name } : null };
}

export function number(n: number | null | undefined) {
  return { number: n ?? null };
}

export function date(iso: string | null | undefined) {
  return { date: iso ? { start: iso } : null };
}

export function relation(ids: string[]) {
  return { relation: ids.map((id) => ({ id })) };
}

type PageProperty = PageObjectResponse["properties"][string];

export function textOf(prop: PageProperty | undefined): string {
  if (!prop) return "";
  if (prop.type === "title") return prop.title.map((r) => r.plain_text).join("");
  if (prop.type === "rich_text") return prop.rich_text.map((r) => r.plain_text).join("");
  return "";
}

export function selectOf(prop: PageProperty | undefined): string | null {
  if (!prop || prop.type !== "select") return null;
  return prop.select?.name ?? null;
}

export function numberOf(prop: PageProperty | undefined): number | null {
  if (!prop || prop.type !== "number") return null;
  return prop.number;
}
