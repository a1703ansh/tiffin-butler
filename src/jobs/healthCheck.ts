import { writeRunLog } from "../runlog.js";
import { getClient, getHomePage, getOrdersDataSource, getRunLogDataSource } from "../notion/client.js";
import { STATS_MARKER } from "../notion/constants.js";
import { business } from "../business.config.js";

async function countPages(dsId: string): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  do {
    const q = await getClient().dataSources.query({
      data_source_id: dsId,
      page_size: 100,
      start_cursor: cursor,
    });
    total += q.results.length;
    cursor = q.has_more ? (q.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return total;
}

/** Refresh the "live stats" line on the Home page (code writes to the interface). */
async function updateHomeStats(): Promise<void> {
  const [orders, runs] = await Promise.all([
    countPages(await getOrdersDataSource()),
    countPages(await getRunLogDataSource()),
  ]);
  const homeId = await getHomePage();
  const blocks = await getClient().blocks.children.list({ block_id: homeId, page_size: 100 });

  const stats = blocks.results.find((b) => {
    if (!("type" in b) || b.type !== "paragraph") return false;
    const text = (b as { paragraph: { rich_text: Array<{ plain_text: string }> } }).paragraph.rich_text;
    return text.some((r) => r.plain_text.startsWith(STATS_MARKER));
  });

  if (!stats || !("type" in stats)) return; // page not on v2 content yet

  const time = new Date().toLocaleString("en-IN", { hour12: false, timeZone: business.timezone });
  await getClient().blocks.update({
    block_id: stats.id,
    paragraph: {
      rich_text: [
        {
          type: "text",
          text: {
            content: `${STATS_MARKER} 📊 ${orders} orders · ${runs} run log entries · updated ${time} · next check in 1h`,
          },
        },
      ],
    },
  } as never);
}

/** Hourly heartbeat — guarantees Run Log rows spread across the event days. */
export async function healthCheck(): Promise<void> {
  await writeRunLog({
    trigger: "health",
    job: "healthCheck",
    outcome: "success",
    meta: "heartbeat · service is up",
  });

  try {
    await updateHomeStats();
  } catch (err) {
    await writeRunLog({
      trigger: "health",
      job: "healthCheck",
      outcome: "failed",
      error: err instanceof Error ? err.message : String(err),
      meta: "home stats refresh failed",
    }).catch(() => {});
  }
}