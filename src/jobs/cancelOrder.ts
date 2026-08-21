import { getClient, getOrdersDataSource } from "../notion/client.js";
import { dateOf, numberOf, select, selectOf, textOf } from "../notion/schema.js";
import { writeRunLog } from "../runlog.js";
import { sendCancellationEmail } from "../actions/email.js";
import { normalizePhone } from "../customers.js";

/**
 * Cancellation flow: a customer message like "cancel my order, room 214" is
 * matched against recent live orders (phone first, then room) and flipped to
 * Cancelled — with its own email and Run Log trail. No-match / ambiguous
 * requests are logged and fall through to normal intake so a human sees them.
 */

const CANCEL_RE = /\b(cancel|cancell|cancelation|cancellation)\b/i;
const PHONE_RE = /(\+?\d[\d\s\-]{7,14}\d)/;
const ROOM_RE = /\broom\s*(?:no\.?|number|#)?\s*([a-z0-9][a-z0-9\-]*)/i;

export function looksLikeCancellation(text: string): boolean {
  return CANCEL_RE.test(text);
}

export type CancelResult = {
  status: "cancelled" | "already_cancelled" | "ambiguous" | "no_match" | "failed";
  orderId?: string;
};

type Candidate = {
  id: string;
  status: string | null;
  phone: string;
  room: string;
  customer: string;
  summary: string;
  email: string | null;
  deliveryDate: string | null;
  total: number | null;
};

async function recentCandidates(): Promise<Candidate[]> {
  const res = await getClient().dataSources.query({
    data_source_id: await getOrdersDataSource(),
    filter: {
      or: [
        { property: "Status", select: { equals: "Pending Approval" } },
        { property: "Status", select: { equals: "Confirmed" } },
        { property: "Status", select: { equals: "Cancelled" } },
      ],
    },
    sorts: [{ timestamp: "created_time", direction: "descending" }],
    page_size: 50,
  });

  const out: Candidate[] = [];
  for (const page of res.results) {
    if (!("properties" in page)) continue;
    const p = page.properties as Record<string, Parameters<typeof textOf>[0]>;
    out.push({
      id: page.id,
      status: selectOf(p.Status),
      phone: textOf(p.Phone),
      room: textOf(p.Room),
      customer: textOf(p.Customer),
      summary: textOf(p.Summary),
      email: textOf(p["Customer Email"]) || null,
      deliveryDate: dateOf(p.Delivery),
      total: numberOf(p.Total),
    });
  }
  return out;
}

function pick(cands: Candidate[], phone: string, room: string): CancelResult {
  const alive = cands.filter((c) => c.status !== "Cancelled");
  let source = phone ? alive.filter((c) => normalizePhone(c.phone) === phone) : [];
  if (source.length === 0 && room) {
    source = alive.filter((c) => c.room.trim().toLowerCase() === room.toLowerCase());
  }

  if (source.length === 1) return { status: "cancelled", orderId: source[0].id };
  if (source.length > 1) {
    // Several live orders — only unambiguous when exactly one still awaits approval.
    const pendings = source.filter((c) => c.status === "Pending Approval");
    if (pendings.length === 1) return { status: "cancelled", orderId: pendings[0].id };
    return { status: "ambiguous" };
  }

  const done = cands.filter(
    (c) =>
      c.status === "Cancelled" &&
      ((phone && normalizePhone(c.phone) === phone) ||
        (!!room && c.room.trim().toLowerCase() === room.toLowerCase())),
  );
  if (done.length > 0) return { status: "already_cancelled", orderId: done[0].id };
  return { status: "no_match" };
}

export async function processCancellation(
  raw: string,
  trigger: Parameters<typeof writeRunLog>[0]["trigger"],
): Promise<CancelResult | null> {
  const phoneMatch = raw.match(PHONE_RE);
  const phone = normalizePhone(phoneMatch?.[1] ?? "");
  const room = (raw.match(ROOM_RE)?.[1] ?? "").trim();
  if (!phone && !room) return null; // nothing to match on -> normal intake

  try {
    const cands = await recentCandidates();
    const result = pick(cands, phone, room);

    if (result.status === "cancelled") {
      const order = cands.find((c) => c.id === result.orderId)!;
      await getClient().pages.update({
        page_id: order.id,
        properties: { Status: select("Cancelled") } as never,
      });
      const sent = await sendCancellationEmail({
        id: order.id,
        summary: order.summary || "Order",
        email: order.email,
        customerName: order.customer || null,
        items: "",
        total: order.total,
        deliveryDate: order.deliveryDate,
        room: order.room || null,
      });
      await writeRunLog({
        trigger,
        job: "cancelOrder",
        outcome: sent.ok ? "action" : "failed",
        orderId: order.id,
        error: sent.ok ? undefined : sent.error,
        meta: sent.ok ? `cancelled · email to ${sent.to}` : `cancel email failed · ${sent.error}`,
      });
      return result;
    }

    if (result.status === "already_cancelled") {
      await writeRunLog({
        trigger,
        job: "cancelOrder",
        outcome: "skipped",
        orderId: result.orderId,
        meta: "cancel request — order was already cancelled",
      });
      return result;
    }

    await writeRunLog({
      trigger,
      job: "cancelOrder",
      outcome: "needs_human",
      error: result.status === "ambiguous" ? "multiple live orders match this cancel request" : undefined,
      meta: `cancel request — ${result.status}${room ? ` · room ${room}` : ""}`,
    });
    return result;
  } catch (err) {
    await writeRunLog({
      trigger,
      job: "cancelOrder",
      outcome: "failed",
      error: err instanceof Error ? err.message : String(err),
      meta: "cancel flow crashed",
    });
    return null; // fall through to intake so the request is never lost
  }
}
