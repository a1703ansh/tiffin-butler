import { getClient, getOrdersDataSource } from "../notion/client.js";
import { sendDigestEmail } from "../actions/email.js";
import { writeRunLog } from "../runlog.js";
import { business } from "../business.config.js";

/**
 * Evening owner digest: what happened today, what needs a human tomorrow.
 * Always sends (a quiet day is still proof the system is watching), and every
 * run lands in the Run Log like everything else.
 */
export type DigestResult = {
  orders: number;
  revenue: number;
  pending: string[];
  needsHuman: string[];
  actionFailed: string[];
  emailed: boolean;
};

type PropValue = { type?: string } & Record<string, unknown>;
type Props = Record<string, PropValue | undefined>;

function istDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: business.timezone });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function titleText(p: PropValue | undefined): string {
  if (!p || p.type !== "title") return "";
  return ((p.title as Array<{ plain_text?: string }> | undefined) ?? [])
    .map((r) => r.plain_text ?? "")
    .join("")
    .trim();
}

function statusName(p: PropValue | undefined): string | null {
  if (!p || p.type !== "select") return null;
  return (p.select as { name?: string } | null)?.name ?? null;
}

function totalOf(p: PropValue | undefined): number {
  if (!p || p.type !== "number") return 0;
  return (p.number as number | null) ?? 0;
}

export async function dailyDigest(): Promise<DigestResult> {
  const today = istDay(new Date().toISOString());
  const result: DigestResult = {
    orders: 0,
    revenue: 0,
    pending: [],
    needsHuman: [],
    actionFailed: [],
    emailed: false,
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
      if (istDay(page.created_time) !== today) continue;

      const props = page.properties as Props;
      const summary = titleText(props["Summary"]);
      const status = statusName(props["Status"]);
      const total = totalOf(props["Total"]);

      result.orders += 1;
      if (status === "Confirmed") result.revenue += total;
      if (status === "Pending Approval") result.pending.push(summary);
      if (status === "Needs Human") result.needsHuman.push(summary);
      if (status === "Action Failed") result.actionFailed.push(summary);
    }
    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);

  const rupee = (n: number) => `${business.currency}${n}`;
  const section = (t: string, color: string, items: string[]) =>
    items.length === 0
      ? ""
      : `<h3 style="color:${color};margin-bottom:4px;">${esc(t)} (${items.length})</h3><ul style="margin-top:0;">${items
          .map((i) => `<li>${esc(i)}</li>`)
          .join("")}</ul>`;

  const html = [
    `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;">`,
    `<h2 style="color:#d97b19;">📊 Tiffin Butler — day ${esc(today)}</h2>`,
    `<p><strong>${result.orders}</strong> order(s) today · <strong>${rupee(result.revenue)}</strong> confirmed revenue</p>`,
    section("🟠 Waiting on your approval", "#d97b19", result.pending),
    section("🟡 Needs human review", "#c9a227", result.needsHuman),
    section("🟣 Automation failed — check Run Log", "#8e44ad", result.actionFailed),
    result.orders === 0 ? `<p style="color:#777;">Quiet day — no new orders came in.</p>` : "",
    `<p style="color:#777;font-size:12px;">Tiffin Butler · written by code at ${new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: business.timezone })} IST · Notion hackathon</p>`,
    `</div>`,
  ].join("");

  try {
    const sent = await sendDigestEmail(
      `Tiffin Butler digest — ${today}: ${result.orders} order(s), ${rupee(result.revenue)}`,
      html,
    );
    result.emailed = sent.ok;
    await writeRunLog({
      trigger: "cron",
      job: "dailyDigest",
      outcome: sent.ok ? "success" : "failed",
      error: sent.ok ? undefined : sent.error,
      meta: `${result.orders} orders · ${rupee(result.revenue)} · pending=${result.pending.length} nh=${result.needsHuman.length} fail=${result.actionFailed.length}`,
    });
  } catch (err) {
    await writeRunLog({
      trigger: "cron",
      job: "dailyDigest",
      outcome: "failed",
      error: err instanceof Error ? err.message : String(err),
      meta: `${result.orders} orders`,
    });
  }

  return result;
}
