/**
 * Builds the entire Day 1 Notion workspace via the API.
 *
 * Prereqs:
 *   - NOTION_TOKEN in .env (internal integration)
 *   - An empty page named "Tiffin Butler" exists and is shared with the
 *     integration (page menu -> Connections -> add the integration).
 *
 * Creates (idempotent — safe to re-run):
 *   - Orders database (full schema + select options) under the home page
 *   - Run Log database (full schema, Order relation -> Orders)
 *   - Inbox page with instructions
 *   - Home page content (how-it-works / status legend) if the page is empty
 *
 * Run: npm run bootstrap
 */
import "dotenv/config";
import { Client, type DatabaseObjectResponse, type DataSourceObjectResponse, type PageObjectResponse } from "@notionhq/client";
import type { PropertyConfigurationRequest } from "@notionhq/client/build/src/api-endpoints/common.js";
import { HOME_V2_MARKER, STATS_MARKER } from "../src/notion/constants.js";

function rt(text: string) {
  return { type: "text" as const, text: { content: text } };
}

function rtArray(...parts: string[]): Array<{ type: "text"; text: { content: string } }> {
  return parts.map(rt);
}

type Prop = PropertyConfigurationRequest;

const ORDERS_PROPERTIES: Record<string, PropertyConfigurationRequest> = {
  Summary: { type: "title", title: {} },
  Channel: { type: "rich_text", rich_text: {} },
  Status: {
    type: "select",
    select: {
      options: [
        { name: "New", color: "gray" },
        { name: "Draft", color: "brown" },
        { name: "Pending Approval", color: "orange" },
        { name: "Needs Human", color: "yellow" },
        { name: "Confirmed", color: "green" },
        { name: "Rejected", color: "red" },
        { name: "Action Failed", color: "purple" },
      ],
    },
  },
  Customer: { type: "rich_text", rich_text: {} },
  Phone: { type: "rich_text", rich_text: {} },
  "Customer Email": { type: "rich_text", rich_text: {} },
  "Action Sent": { type: "checkbox", checkbox: {} },
  Items: { type: "rich_text", rich_text: {} },
  Total: { type: "number", number: { format: "rupee" } },
  Delivery: { type: "date", date: {} },
  Room: { type: "rich_text", rich_text: {} },
  "AI Summary": { type: "rich_text", rich_text: {} },
  "Raw Message": { type: "rich_text", rich_text: {} },
  Confidence: {
    type: "select",
    select: {
      options: [
        { name: "high", color: "green" },
        { name: "low", color: "yellow" },
      ],
    },
  },
  Language: { type: "rich_text", rich_text: {} },
  Priority: {
    type: "select",
    select: {
      options: [
        { name: "normal", color: "gray" },
        { name: "urgent", color: "red" },
      ],
    },
  },
  "Dedupe Hash": { type: "rich_text", rich_text: {} },
};

const RUN_LOG_PROPERTIES: Record<string, PropertyConfigurationRequest> = {
  Run: { type: "title", title: {} },
  Timestamp: { type: "date", date: {} },
  Trigger: {
    type: "select",
    select: {
      options: [
        { name: "webhook", color: "blue" },
        { name: "cron", color: "gray" },
        { name: "manual", color: "green" },
        { name: "health", color: "pink" },
        { name: "whatsapp", color: "green" },
      ],
    },
  },
  Job: { type: "rich_text", rich_text: {} },
  Outcome: {
    type: "select",
    select: {
      options: [
        { name: "success", color: "green" },
        { name: "failed", color: "red" },
        { name: "skipped", color: "gray" },
        { name: "duplicate", color: "yellow" },
        { name: "needs_human", color: "yellow" },
        { name: "action", color: "blue" },
      ],
    },
  },
  Duration: { type: "number", number: { format: "number" } },
  Error: { type: "rich_text", rich_text: {} },
  Meta: { type: "rich_text", rich_text: {} },
};

const HOME_COVER_URL =
  "https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?ixlib=rb-4.0.3&q=80&w=1920&auto=format&fit=crop";

function block(type: string, value: Record<string, unknown>): Record<string, unknown> {
  return { object: "block", type, [type]: value };
}

/** Home v2 showcase, with live links to the real child pages/databases. */
function homeShowcaseBlocks(ordersBlockId: string, runLogBlockId: string, inboxBlockId: string): Record<string, unknown>[] {
  return [
    block("heading_1", { rich_text: rtArray(HOME_V2_MARKER) }),
    block("quote", {
      rich_text: rtArray(
        "What would take your junior 5 minutes per message — code does in 3 seconds, and ",
        "the final yes/no stays a human decision in Notion.",
      ),
    }),
    block("divider", {}),
    block("callout", {
      rich_text: rtArray("⚡ HOW IT WORKS"),
      icon: { type: "emoji", emoji: "⚡" },
      children: [
        block("bulleted_list_item", {
          rich_text: rtArray("📲  A customer's order message arrives — webhook, a paste in the Inbox, or WhatsApp."),
        }),
        block("bulleted_list_item", {
          rich_text: rtArray("🤖  AI parses it (Groq), rules price it, a fingerprint dedupes it."),
        }),
        block("bulleted_list_item", {
          rich_text: rtArray("✅  You decide inside Notion in the ", "Needs You", " view — Approve or Reject."),
        }),
        block("bulleted_list_item", {
          rich_text: rtArray("📧  Real action outside Notion: confirmation email + PDF receipt to the customer."),
        }),
        block("bulleted_list_item", {
          rich_text: rtArray("📋  Every run is written to Run Log by code — timestamps prove it ran without you."),
        }),
      ],
    }),
    block("divider", {}),
    block("heading_2", { rich_text: rtArray("🔍 Live systems") }),
    block("link_to_page", { database_id: ordersBlockId }),
    block("link_to_page", { database_id: runLogBlockId }),
    block("link_to_page", { page_id: inboxBlockId }),
    block("divider", {}),
    block("heading_2", { rich_text: rtArray("📊 Status legend") }),
    block("table", {
      table_width: 2,
      has_column_header: true,
      has_row_header: false,
      children: [
        block("table_row", { cells: [rtArray("Status"), rtArray("Meaning")] }),
        block("table_row", {
          cells: [rtArray("🟠 Pending Approval"), rtArray("Owner must decide — live in the Needs You view")],
        }),
        block("table_row", {
          cells: [rtArray("🟡 Needs Human"), rtArray("AI unsure / off-menu — raw message is preserved")],
        }),
        block("table_row", {
          cells: [rtArray("🟢 Confirmed"), rtArray("Approval done — receipt email + PDF sent")],
        }),
        block("table_row", {
          cells: [rtArray("🔴 Rejected"), rtArray("Owner declined — decline email sent")],
        }),
        block("table_row", {
          cells: [rtArray("🟣 Action Failed"), rtArray("Automation crashed — Run Log row says why")],
        }),
      ],
    }),
    block("divider", {}),
    block("bookmark", { url: "https://tiffin-butler.onrender.com" }),
    block("callout", {
      rich_text: rtArray("📮 TRY IT", "  —  open the Inbox (link above), paste an order message, wait ~60s."),
      icon: { type: "emoji", emoji: "📮" },
    }),
    block("paragraph", { rich_text: rtArray(STATS_MARKER + " loading…") }),
  ];
}

function check(label: string, passed: boolean, detail = ""): void {
  console.log(`  ${passed ? "\u2714" : "\u2718"} ${label}${detail ? "  -> " + detail : ""}`);
}

async function findPageByTitle(client: Client, title: string): Promise<string | null> {
  const search = await client.search({
    filter: { property: "object", value: "page" },
    query: title,
    page_size: 20,
  });
  for (const r of search.results) {
    if (r.object !== "page" || !("properties" in r)) continue;
    const page = r as PageObjectResponse;
    const titleProp = page.properties.title;
    if (titleProp && titleProp.type === "title") {
      const name = titleProp.title.map((t) => t.plain_text).join("");
      if (name.toLowerCase() === title.toLowerCase()) return page.id;
    }
  }
  return null;
}

async function findDataSourceByTitle(client: Client, title: string): Promise<string | null> {
  const search = await client.search({
    filter: { property: "object", value: "data_source" },
    query: title,
    page_size: 20,
  });
  const found = search.results.find(
    (r) =>
      r.object === "data_source" &&
      "title" in r &&
      r.title[0]?.plain_text?.toLowerCase() === title.toLowerCase(),
  ) as DataSourceObjectResponse | undefined;
  return found ? found.id : null;
}

async function main(): Promise<number> {
  console.log("Tiffin Butler — workspace bootstrap\n");

  const token = process.env.NOTION_TOKEN;
  if (!token || token.startsWith("ntn_") === false) {
    check("NOTION_TOKEN", false, "not set in .env. See docs/setup-notion.md section 2.");
    return 1;
  }
  const client = new Client({ auth: token });

  // 1. Home page
  let homeId = process.env.NOTION_HOME_PAGE_ID?.trim() || null;
  if (!homeId) homeId = await findPageByTitle(client, "Tiffin Butler");
  if (!homeId) {
    check("home page 'Tiffin Butler'", false, "not found. Create the page and share it with the integration (section 7 of the guide).");
    return 1;
  }
  check("home page 'Tiffin Butler' resolves", true, homeId.slice(0, 8) + "\u2026");

  // 2. Orders database
  let ordersDs = await findDataSourceByTitle(client, "Orders");
  if (!ordersDs) {
    const created = await client.databases.create({
      parent: { type: "page_id", page_id: homeId },
      title: rtArray("Orders"),
      initial_data_source: { properties: ORDERS_PROPERTIES },
    });
    const full = await client.databases.retrieve({ database_id: created.id });
    ordersDs = ((full as DatabaseObjectResponse).data_sources ?? [])[0]?.id ?? null;
    if (!ordersDs) ordersDs = await findDataSourceByTitle(client, "Orders");
    check("Orders database created", Boolean(ordersDs), ordersDs ? ordersDs.slice(0, 8) + "\u2026" : "data source id not found after creation");
  } else {
    check("Orders database exists", true, ordersDs.slice(0, 8) + "\u2026");
  }
  if (!ordersDs) return 1;

  // Orders: backfill any props the live database is missing (idempotent add).
  {
    const current = await client.dataSources.retrieve({ data_source_id: ordersDs });
    const missing = Object.entries(ORDERS_PROPERTIES).filter(([name]) => !current.properties[name]);
    if (missing.length > 0) {
      const merged: Record<string, unknown> = { ...current.properties };
      for (const [name, def] of Object.entries(ORDERS_PROPERTIES)) {
        if ("select" in def || "checkbox" in def) merged[name] = def;
        else if (!merged[name]) merged[name] = def;
      }
      await client.dataSources.update({ data_source_id: ordersDs, properties: merged as never });
      check("Orders schema backfilled", true, missing.map(([n]) => n).join(", "));
    } else {
      check("Orders schema up to date", true);
    }
  }

  // 3. Run Log database (relation points at Orders data source)
  let runLogDs = await findDataSourceByTitle(client, "Run Log");
  if (!runLogDs) {
    const created = await client.databases.create({
      parent: { type: "page_id", page_id: homeId },
      title: rtArray("Run Log"),
      initial_data_source: {
        properties: {
          ...RUN_LOG_PROPERTIES,
          Order: {
            type: "relation",
            relation: { data_source_id: ordersDs, type: "single_property", single_property: {} },
          },
        },
      },
    });
    const full = await client.databases.retrieve({ database_id: created.id });
    runLogDs = ((full as DatabaseObjectResponse).data_sources ?? [])[0]?.id ?? null;
    if (!runLogDs) runLogDs = await findDataSourceByTitle(client, "Run Log");
    check("Run Log database created", Boolean(runLogDs), runLogDs ? runLogDs.slice(0, 8) + "\u2026" : "data source id not found after creation");
  } else {
    check("Run Log database exists", true, runLogDs.slice(0, 8) + "\u2026");
  }
  if (!runLogDs) return 1;

  // Run Log: backfill missing props + select options (idempotent add).
  {
    const current = await client.dataSources.retrieve({ data_source_id: runLogDs });
    const merged: Record<string, unknown> = { ...current.properties };
    let touched: string[] = [];
    for (const [name, def] of Object.entries(RUN_LOG_PROPERTIES)) {
      if ("select" in def || "checkbox" in def) {
        if (JSON.stringify(merged[name]) !== JSON.stringify(def)) touched.push(name);
        merged[name] = def;
      } else if (!merged[name]) {
        merged[name] = def;
        touched.push(name);
      }
    }
    if (touched.length > 0) {
      await client.dataSources.update({ data_source_id: runLogDs, properties: merged as never });
      check("Run Log schema backfilled", true, touched.join(", "));
    } else {
      check("Run Log schema up to date", true);
    }
  }

  // 4. Inbox page
  const existingInbox = await findPageByTitle(client, "Inbox");
  if (!existingInbox) {
    const created = await client.pages.create({
      parent: { type: "page_id", page_id: homeId },
      properties: { title: { title: rtArray("Inbox") } },
      icon: { type: "emoji", emoji: "📥" },
      content: [
        {
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: rtArray("Paste a customer's order message here, one per line. The service will create the order draft automatically. Do not edit lines you did not write."),
          },
        },
      ],
    });
    check("Inbox page created", true, created.id.slice(0, 8) + "\u2026");
  } else {
    check("Inbox page exists", true, existingInbox.slice(0, 8) + "\u2026");
    await client.pages.update({ page_id: existingInbox, icon: { type: "emoji", emoji: "📥" } });
  }

  // 5. Home page dressing: icon + cover.
  await client.pages.update({
    page_id: homeId,
    icon: { type: "emoji", emoji: "🍛" },
    cover: { type: "external", external: { url: HOME_COVER_URL } },
  });
  check("home page icon + cover set", true);

  // 6. Home page content v2 (idempotent: marker heading_1 identifies v2).
  const children = await client.blocks.children.list({ block_id: homeId });
  const isV2 = children.results.some(
    (b) => "type" in b && b.type === "heading_1" && (b as { [k: string]: unknown }).heading_1
      ? ((b as { heading_1: { rich_text: Array<{ plain_text: string }> } }).heading_1.rich_text ?? []).some((r) => r.plain_text === HOME_V2_MARKER)
      : false,
  );

  if (!isV2) {
    // Remove old text blocks, keep embedded people/pages/databases.
    for (const b of children.results) {
      if (!("type" in b)) continue;
      const t = b.type;
      if (t === "child_page" || t === "child_database") continue;
      await client.blocks.delete({ block_id: b.id }).catch(() => {});
    }
    check("old home content removed", true);

    let ordersBlockId = "";
    let runLogBlockId = "";
    let inboxBlockId = "";
    const fresh = await client.blocks.children.list({ block_id: homeId });
    for (const b of fresh.results) {
      if (!("type" in b)) continue;
      if (b.type === "child_database") {
        if (!ordersBlockId) ordersBlockId = b.id;
        else if (!runLogBlockId) runLogBlockId = b.id;
      } else if (b.type === "child_page" && !inboxBlockId) {
        inboxBlockId = b.id;
      }
    }

    await client.blocks.children.append({
      block_id: homeId,
      children: homeShowcaseBlocks(ordersBlockId, runLogBlockId, inboxBlockId) as never,
    });
    check("home page v2 content written", true);
  } else {
    check("home page already v2, skipped", true);
  }

  console.log("");
  console.log("Bootstrap done. Two manual touches (2 minutes, see guide section 4-5):");
  console.log("  1. Orders: add a board view grouped by Status.");
  console.log("  2. Orders: add a 'Needs You' view filtered to Pending Approval / Needs Human / Action Failed.");
  console.log("Then verify with: npm run check-setup");
  return 0;
}

main().then((code) => process.exit(code));