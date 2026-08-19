import { getClient, getOrdersDataSource, getInboxPage } from "../notion/client.js";
import { writeRunLog, type RunLogEntry } from "../runlog.js";
import { richText, select, title } from "../notion/schema.js";

export type ProcessResult = {
  status: "created" | "skipped";
  orderId?: string;
};

function headline(text: string): string {
  const flat = text.replace(/[\n\r]+/g, " ").trim();
  return flat.length <= 80 ? flat : flat.slice(0, 77) + "\u2026";
}

/**
 * Day 2 intake: create a draft order in Notion from a raw message.
 * Day 3 upgrades this to AI parsing + pricing; the shape stays the same.
 */
export async function processMessage(raw: string, trigger: RunLogEntry["trigger"]): Promise<ProcessResult> {
  const text = raw.trim();
  if (!text) {
    await writeRunLog({ trigger, job: "processInbox", outcome: "failed", error: "empty message" });
    return { status: "skipped" };
  }

  const summary = headline(text);

  const orderPage = await getClient().pages.create({
    parent: { data_source_id: await getOrdersDataSource() },
    properties: {
      Summary: title(summary),
      Status: select("Draft"),
      "Raw Message": richText(text),
    } as never,
  });

  await writeRunLog({
    trigger,
    job: "processInbox",
    outcome: "success",
    orderId: orderPage.id,
    meta: summary,
  });

  return { status: "created", orderId: orderPage.id };
}

/**
 * Scan the Inbox page for unprocessed message lines and intake each one.
 * Processed lines get a "[done]" prefix inside Notion — visible audit trail.
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