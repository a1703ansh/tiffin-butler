import { getClient, getOrdersDataSource, getInboxPage } from "../notion/client.js";
import { writeRunLog, type RunLogEntry } from "../runlog.js";
import { date, number, richText, select, title } from "../notion/schema.js";
import { parseOrder, ParseError } from "../ai/parseOrder.js";
import { formatLineItems, priceItems, type LineItem } from "../pricing.js";
import { findOrderByFingerprint, orderFingerprint } from "../dedupe.js";
import { business } from "../business.config.js";

export type ProcessResult = {
  status: "created" | "skipped" | "duplicate" | "needs_human";
  orderId?: string;
  existingOrderId?: string;
};

function short(text: string, max = 80): string {
  const flat = text.replace(/[\n\r]+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max - 1) + "\u2026";
}

function humanSummary(
  lineItems: LineItem[],
  total: number,
  unknownItems: string[],
  deliveryDate: string | null | undefined,
  deliveryTime: string | null | undefined,
  room: string | null | undefined,
): string {
  const parts: string[] = [];
  if (lineItems.length > 0) {
    parts.push(formatLineItems(lineItems));
    if (total > 0) parts.push(`= ${business.currency}${total}`);
  }
  const when = [deliveryDate, deliveryTime].filter(Boolean).join(" ");
  if (when) parts.push(when);
  if (room) parts.push(`room ${room}`);
  if (unknownItems.length > 0) parts.push(`\u26A0\uFE0F off-menu: ${unknownItems.join(", ")}`);
  return parts.join(" \u00B7 ");
}

type OrderCreate = {
  summary: string;
  status: "Pending Approval" | "Needs Human";
  channel: string;
  raw: string;
  aiSummary: string;
  confidence: "high" | "low";
  customerName?: string;
  phone?: string;
  email?: string;
  items?: string;
  total?: number;
  deliveryDate?: string;
  room?: string;
  language?: string;
  fingerprint?: string;
};

async function createOrder(input: OrderCreate): Promise<string> {
  const properties: Record<string, unknown> = {
    Summary: title(input.summary || "Order"),
    Status: select(input.status),
    Channel: richText(input.channel),
    "Raw Message": richText(input.raw),
    "AI Summary": richText(input.aiSummary),
    Confidence: select(input.confidence),
  };
  if (input.customerName) properties.Customer = richText(input.customerName);
  if (input.phone) properties.Phone = richText(input.phone);
  if (input.email) properties["Customer Email"] = richText(input.email);
  if (input.items) properties.Items = richText(input.items);
  if (input.total !== undefined) properties.Total = number(input.total);
  if (input.deliveryDate) properties.Delivery = date(input.deliveryDate);
  if (input.room) properties.Room = richText(input.room);
  if (input.language) properties.Language = richText(input.language);
  if (input.fingerprint) properties["Dedupe Hash"] = richText(input.fingerprint);

  const page = await getClient().pages.create({
    parent: { data_source_id: await getOrdersDataSource() },
    properties: properties as never,
  });
  return page.id;
}

/**
 * The Day 3 intake: AI parse -> dedupe -> price -> create.
 * Clean orders pause at "Pending Approval" (human gate).
 * Anything unclear lands at "Needs Human" with the raw message preserved.
 */
export async function processMessage(
  raw: string,
  trigger: RunLogEntry["trigger"],
  channel?: string,
): Promise<ProcessResult> {
  const text = raw.trim();
  if (!text) {
    await writeRunLog({ trigger, job: "processInbox", outcome: "failed", error: "empty message" });
    return { status: "skipped" };
  }

  const source = channel ?? (trigger === "cron" ? "inbox" : trigger);

  // 1. AI parse (messy text -> structured order)
  let parsed;
  try {
    parsed = await parseOrder(text);
  } catch (err) {
    const reason = err instanceof ParseError ? err.message : String(err);
    const orderId = await createOrder({
      summary: `Needs human \u2014 unparseable`,
      status: "Needs Human",
      channel: source,
      raw: text,
      aiSummary: `\u2753 Could not parse: ${short(reason, 60)}. Raw message preserved below.`,
      confidence: "low",
    });
    await writeRunLog({
      trigger,
      job: "processInbox",
      outcome: "needs_human",
      orderId,
      error: reason,
      meta: short(text, 80),
    });
    return { status: "needs_human", orderId };
  }

  // 2. Dedupe gate (same message + phone + date = duplicate)
  const fingerprint = orderFingerprint(text, parsed.phone, parsed.deliveryDate);
  const existing = await findOrderByFingerprint(fingerprint);
  if (existing) {
    await writeRunLog({
      trigger,
      job: "processInbox",
      outcome: "duplicate",
      orderId: existing,
      meta: "fingerprint match \u2014 skipped",
    });
    return { status: "duplicate", existingOrderId: existing };
  }

  // 3. Price it (rules, not AI)
  const pricing = priceItems(parsed.items);
  const needsHuman =
    parsed.confidence === "low" ||
    pricing.unknownItems.length > 0 ||
    !parsed.deliveryDate ||
    pricing.lineItems.length === 0;

  const status: "Pending Approval" | "Needs Human" = needsHuman ? "Needs Human" : "Pending Approval";
  const aiSummary = humanSummary(
    pricing.lineItems,
    pricing.total,
    pricing.unknownItems,
    parsed.deliveryDate,
    parsed.deliveryTime,
    parsed.room,
  );

  const customerPrefix = parsed.customerName ? `${parsed.customerName} \u2014 ` : "";
  const orderId = await createOrder({
    summary: `${customerPrefix}${formatLineItems(pricing.lineItems) || short(text, 60)}`,
    status,
    channel: source,
    raw: text,
    aiSummary,
    confidence: parsed.confidence === "low" ? "low" : needsHuman ? "low" : "high",
    customerName: parsed.customerName ?? undefined,
    phone: parsed.phone ?? undefined,
    email: parsed.email ?? undefined,
    items: pricing.lineItems.length > 0 ? formatLineItems(pricing.lineItems) : undefined,
    total: pricing.total > 0 ? pricing.total : undefined,
    deliveryDate: parsed.deliveryDate ?? undefined,
    room: parsed.room ?? undefined,
    language: parsed.language ?? undefined,
    fingerprint,
  });

  await writeRunLog({
    trigger,
    job: "processInbox",
    outcome: status === "Pending Approval" ? "success" : "needs_human",
    orderId,
    meta: short(aiSummary, 90),
  });

  return { status: needsHuman ? "needs_human" : "created", orderId };
}

/**
 * Scan the Inbox page for unprocessed message lines and intake each one.
 * Processed lines get a "[done]" prefix inside Notion.
 */
export async function scanInbox(trigger: RunLogEntry["trigger"]): Promise<{ processed: number }> {
  const inboxId = await getInboxPage();
  const children = await getClient().blocks.children.list({ block_id: inboxId });

  let processed = 0;
  for (const block of children.results) {
    if (!("type" in block)) continue;

    let rawText: string;
    if (block.type === "paragraph") {
      rawText = block.paragraph.rich_text.map((r) => r.plain_text).join("");
    } else if (block.type === "bulleted_list_item") {
      rawText = block.bulleted_list_item.rich_text.map((r) => r.plain_text).join("");
    } else if (block.type === "numbered_list_item") {
      rawText = block.numbered_list_item.rich_text.map((r) => r.plain_text).join("");
    } else {
      continue;
    }

    const text = rawText.trim();
    if (!text) continue;
    if (text.startsWith("[done]") || text.toLowerCase().startsWith("paste a customer")) continue;

    try {
      await processMessage(text, trigger);
      const newContent = { rich_text: [{ type: "text" as const, text: { content: `[done] ${text}` } }] };
      const updateBody =
        block.type === "paragraph"
          ? { paragraph: newContent }
          : block.type === "bulleted_list_item"
            ? { bulleted_list_item: newContent }
            : { numbered_list_item: newContent };
      await getClient().blocks.update({ block_id: block.id, ...updateBody } as never);
      processed += 1;
    } catch (err) {
      await writeRunLog({
        trigger,
        job: "scanInbox",
        outcome: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (processed > 0) {
    await writeRunLog({ trigger, job: "scanInbox", outcome: "success", meta: `processed ${processed} line(s)` });
  }
  return { processed };
}