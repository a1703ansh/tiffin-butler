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

function rt(text: string) {
  return { type: "text" as const, text: { content: text } };
}

function rtArray(...parts: string[]): Array<{ type: "text"; text: { content: string } }> {
  return parts.map(rt);
}

type Prop = PropertyConfigurationRequest;

const ORDERS_PROPERTIES: Record<string, PropertyConfigurationRequest> = {
  Summary: { type: "title", title: {} },
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

const HOME_CONTENT_BLOCKS = [
  {
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: rtArray("How it works") },
  },
  {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: rtArray("A customer's order message arrives (webhook, cron scan, or pasted in Inbox).") },
  },
  {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: rtArray("Code parses it with AI, prices it, and creates an order draft.") },
  },
  {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: rtArray("The owner reviews it — Approve, Edit, or Reject — all inside Notion.") },
  },
  {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: rtArray("On approval, code emails the customer a confirmation + PDF receipt.") },
  },
  {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: rtArray("Every run is logged in the Run Log database with a timestamp.") },
  },
  {
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: rtArray("Status legend") },
  },
  {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: rtArray("Pending Approval", " — the owner must decide (see the ", "Needs You", " view)"),
    },
  },
  {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: rtArray("Needs Human", " — the AI couldn't parse it; raw message is in ", "Raw Message"),
    },
  },
  {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: rtArray("Confirmed", " — approval done, confirmation email sent") },
  },
  {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: rtArray("Rejected", " — owner declined") },
  },
  {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: rtArray("Action Failed", " — something crashed; a Run Log row explains what") },
  },
  {
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: rtArray("Who does what") },
  },
  {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: rtArray("The owner decides via the ", "Needs You", " view (Pending Approval / Needs Human / Action Failed)."),
    },
  },
  {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: rtArray("The code writes Run Log rows and status transitions — never hand-edit the Run Log."),
    },
  },
];

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

  // 4. Inbox page
  const existingInbox = await findPageByTitle(client, "Inbox");
  if (!existingInbox) {
    await client.pages.create({
      parent: { type: "page_id", page_id: homeId },
      properties: { title: { title: rtArray("Inbox") } },
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
    check("Inbox page created", true);
  } else {
    check("Inbox page exists", true, existingInbox.slice(0, 8) + "\u2026");
  }

  // 5. Home page content (only if the page has no written content yet)
  const children = await client.blocks.children.list({ block_id: homeId });
  const hasWrittenContent = children.results.some((b) => "type" in b && (b.type === "heading_2" || b.type === "paragraph"));
  if (!hasWrittenContent) {
    await client.blocks.children.append({ block_id: homeId, children: HOME_CONTENT_BLOCKS as never });
    check("home page content written", true);
  } else {
    check("home page already has content, skipped", true);
  }

  console.log("");
  console.log("Bootstrap done. Two manual touches (2 minutes, see guide section 4-5):");
  console.log("  1. Orders: add a board view grouped by Status.");
  console.log("  2. Orders: add a 'Needs You' view filtered to Pending Approval / Needs Human / Action Failed.");
  console.log("Then verify with: npm run check-setup");
  return 0;
}

main().then((code) => process.exit(code));