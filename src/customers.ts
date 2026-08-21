import { getClient, getOrdersDataSource } from "./notion/client.js";
import { textOf } from "./notion/schema.js";

/**
 * Customer memory: match an incoming phone number against past orders so
 * returning customers don't have to repeat their name/room every message.
 * Pure read — never writes; the intake still records exactly what was said.
 */
export function normalizePhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export type RememberedCustomer = { name?: string; room?: string };

export async function findRecentCustomer(
  phone: string | null | undefined,
): Promise<RememberedCustomer | null> {
  const last10 = normalizePhone(phone);
  if (last10.length < 10) return null;

  try {
    const res = await getClient().dataSources.query({
      data_source_id: await getOrdersDataSource(),
      filter: { property: "Phone", rich_text: { contains: last10 } },
      sorts: [{ timestamp: "created_time", direction: "descending" }],
      page_size: 5,
    });

    for (const page of res.results) {
      if (!("properties" in page)) continue;
      const p = page.properties as Record<string, Parameters<typeof textOf>[0]>;
      const name = textOf(p.Customer).trim();
      const room = textOf(p.Room).trim();
      if (name || room) return { name: name || undefined, room: room || undefined };
    }
  } catch {
    return null; // memory is best-effort; never block intake
  }
  return null;
}

/** True when this phone had orders before the given one (welcome-back greeting). */
export async function hasPriorOrders(
  phone: string | null | undefined,
  excludeOrderId: string,
): Promise<boolean> {
  const last10 = normalizePhone(phone);
  if (last10.length < 10) return false;

  try {
    const res = await getClient().dataSources.query({
      data_source_id: await getOrdersDataSource(),
      filter: { property: "Phone", rich_text: { contains: last10 } },
      sorts: [{ timestamp: "created_time", direction: "descending" }],
      page_size: 3,
    });
    return res.results.some((page) => "properties" in page && page.id !== excludeOrderId);
  } catch {
    return false;
  }
}
