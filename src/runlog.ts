import { getClient, getRunLogDataSource } from "./notion/client.js";
import { env } from "./config.js";
import { business } from "./business.config.js";
import { date, number, richText, select, title, relation } from "./notion/schema.js";

export type RunLogEntry = {
  trigger: "webhook" | "cron" | "manual" | "health" | "whatsapp" | "voice";
  job: string;
  outcome: "success" | "failed" | "skipped" | "duplicate" | "needs_human" | "action";
  orderId?: string;
  error?: string;
  meta?: string;
};

/**
 * Every run of the system funnels through here. The row is written by the
 * integration (never by hand) with a real timestamp from the server clock.
 * Returns the created Run Log page id, or null when logging is disabled.
 */
export async function writeRunLog(entry: RunLogEntry): Promise<string | null> {
  if (!env.runLogEnabled) return null;

  const startedAt = Date.now();
  const now = new Date();
  const timeLabel = now.toLocaleTimeString("en-IN", {
    hour12: false,
    timeZone: business.timezone,
  });

  const properties = {
    Run: title(`${entry.trigger} · ${entry.job} · ${timeLabel}`),
    Timestamp: date(now.toISOString()),
    Trigger: select(entry.trigger),
    Job: richText(entry.job),
    Outcome: select(entry.outcome),
    Duration: number(0),
    Error: richText(entry.error ?? ""),
    Meta: richText(entry.meta ?? ""),
  } as Record<string, unknown>;

  if (entry.orderId) {
    properties.Order = relation([entry.orderId]);
  }

  const page = await getClient().pages.create({
    parent: { data_source_id: await getRunLogDataSource() },
    properties: properties as never,
  });

  // Patch in the measured duration after creation.
  await getClient().pages.update({
    page_id: page.id,
    properties: { Duration: number(Date.now() - startedAt) } as never,
  });

  return page.id;
}