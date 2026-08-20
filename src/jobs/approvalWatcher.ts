import type { PageObjectResponse } from "@notionhq/client";
import { getClient, getOrdersDataSource } from "../notion/client.js";
import { checkbox, checkboxOf, dateOf, numberOf, select, selectOf, textOf } from "../notion/schema.js";
import { writeRunLog, type RunLogEntry } from "../runlog.js";
import { sendReceiptEmail, sendRejectionEmail } from "../actions/email.js";

type OrderRow = {
  id: string;
  summary: string;
  customerName: string | null;
  email: string | null;
  items: string;
  total: number | null;
  deliveryDate: string | null;
  deliveryTime: string | null;
  room: string | null;
  status: string | null;
};

function toRow(page: PageObjectResponse): OrderRow {
  const p = page.properties;
  return {
    id: page.id,
    summary: textOf(p.Summary),
    customerName: textOf(p.Customer) || null,
    email: textOf(p["Customer Email"]) || null,
    items: textOf(p.Items),
    total: numberOf(p.Total),
    deliveryDate: dateOf(p.Delivery),
    deliveryTime: null,
    room: textOf(p.Room) || null,
    status: selectOf(p.Status),
  };
}

/**
 * The Day 4 action loop. The human decides inside Notion by flipping Status:
 *   Confirmed -> send confirmation email + PDF receipt, mark Action Sent.
 *   Rejected  -> send decline email, mark Action Sent.
 * On failure the order moves to "Action Failed" and the Run Log records why.
 * Action Sent (checkbox) makes this idempotent under the 1-minute cron.
 */
export async function approvalWatcher(trigger: RunLogEntry["trigger"]): Promise<{ acted: number }> {
  const dsId = await getOrdersDataSource();
  const client = getClient();

  const pendingFilter = (status: string) => ({
    and: [
      { property: "Status", select: { equals: status } },
      { property: "Action Sent", checkbox: { equals: false } },
    ],
  });

  const confirmed = await client.dataSources.query({
    data_source_id: dsId,
    filter: pendingFilter("Confirmed"),
    page_size: 25,
  });
  const rejected = await client.dataSources.query({
    data_source_id: dsId,
    filter: pendingFilter("Rejected"),
    page_size: 25,
  });

  const candidates = [...confirmed.results, ...rejected.results].filter(
    (r): r is PageObjectResponse => r.object === "page" && "properties" in r,
  );

  let acted = 0;
  for (const page of candidates) {
    const order = toRow(page);
    const isConfirmed = order.status === "Confirmed";

    const emailResult = isConfirmed
      ? await sendReceiptEmail({
          id: order.id,
          summary: order.summary || "Order",
          email: order.email,
          customerName: order.customerName,
          items: order.items,
          total: order.total,
          deliveryDate: order.deliveryDate,
          room: order.room,
        })
      : await sendRejectionEmail({
          id: order.id,
          summary: order.summary || "Order",
          email: order.email,
          customerName: order.customerName,
          items: order.items,
          total: order.total,
          deliveryDate: order.deliveryDate,
          room: order.room,
        });

    if (emailResult.ok) {
      await client.pages.update({
        page_id: order.id,
        properties: {
          "Action Sent": checkbox(true),
        } as never,
      });
      await writeRunLog({
        trigger,
        job: "approvalWatcher",
        outcome: "action",
        orderId: order.id,
        meta: `${isConfirmed ? "receipt" : "decline"} sent to ${emailResult.to}`,
      });
      acted += 1;
    } else {
      await client.pages.update({
        page_id: order.id,
        properties: { Status: select("Action Failed") } as never,
      });
      await writeRunLog({
        trigger,
        job: "approvalWatcher",
        outcome: "failed",
        orderId: order.id,
        error: emailResult.error,
        meta: `${isConfirmed ? "confirm" : "reject"} action failed`,
      });
    }
  }

  return { acted };
}