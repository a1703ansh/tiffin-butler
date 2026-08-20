import { createHash } from "node:crypto";
import { getClient, getOrdersDataSource } from "./notion/client.js";

/** Deterministic fingerprint of an incoming order message. */
export function orderFingerprint(
  text: string,
  phone: string | null | undefined,
  date: string | null | undefined,
): string {
  const parts = [
    text.replace(/\s+/g, " ").trim().toLowerCase(),
    phone?.replace(/\D/g, "") ?? "",
    date ?? "",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/** Returns an existing order page id with the same fingerprint, or null. */
export async function findOrderByFingerprint(hash: string): Promise<string | null> {
  const result = await getClient().dataSources.query({
    data_source_id: await getOrdersDataSource(),
    filter: { property: "Dedupe Hash", rich_text: { equals: hash } },
    page_size: 1,
  });
  const page = result.results.find((p) => p.object === "page");
  return page?.object === "page" ? page.id : null;
}