import { getClient, getOrdersDataSource, getRunLogDataSource } from "../notion/client.js";
import { selectOf, textOf, numberOf } from "../notion/schema.js";
import { loadMenu } from "../menu.js";
import { business } from "../business.config.js";

/** Read-only aggregation for the public landing page and /stats endpoint. */
export type Stats = {
  ok: true;
  time: string;
  today: { orders: number; revenue: number; pending: number; needsHuman: number; actionFailed: number };
  allTimeOrders: number;
  menu: { name: string; price: number }[];
  menuSource: "notion" | "config";
  recentRuns: { run: string; outcome: string }[];
};

function istDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: business.timezone });
}

export async function collectStats(): Promise<Stats> {
  const today = istDay(new Date().toISOString());
  const stats: Stats = {
    ok: true,
    time: new Date().toISOString(),
    today: { orders: 0, revenue: 0, pending: 0, needsHuman: 0, actionFailed: 0 },
    allTimeOrders: 0,
    menu: [],
    menuSource: "config",
    recentRuns: [],
  };

  let cursor: string | undefined;
  do {
    const res = await getClient().dataSources.query({
      data_source_id: await getOrdersDataSource(),
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const page of res.results) {
      if (!("properties" in page) || !("created_time" in page)) continue;
      const props = page.properties as Record<string, Parameters<typeof textOf>[0]>;
      stats.allTimeOrders += 1;
      if (istDay((page as { created_time: string }).created_time) !== today) continue;
      stats.today.orders += 1;
      const status = selectOf(props.Status);
      if (status === "Confirmed") stats.today.revenue += numberOf(props.Total) ?? 0;
      else if (status === "Pending Approval") stats.today.pending += 1;
      else if (status === "Needs Human") stats.today.needsHuman += 1;
      else if (status === "Action Failed") stats.today.actionFailed += 1;
    }
    cursor = res.has_more ? (res as { next_cursor?: string | null }).next_cursor ?? undefined : undefined;
  } while (cursor);

  try {
    const runs = await getClient().dataSources.query({
      data_source_id: await getRunLogDataSource(),
      sorts: [{ timestamp: "created_time", direction: "descending" }],
      page_size: 6,
    });
    for (const page of runs.results) {
      if (!("properties" in page)) continue;
      const props = page.properties as Record<string, Parameters<typeof textOf>[0]>;
      stats.recentRuns.push({
        run: textOf(props.Run),
        outcome: selectOf(props.Outcome) ?? "",
      });
    }
  } catch {
    // Run Log hiccups must not take down the dashboard
  }

  const menu = await loadMenu();
  stats.menuSource = menu.source;
  stats.menu = menu.entries.map((e) => ({ name: e.name, price: e.price }));
  return stats;
}
