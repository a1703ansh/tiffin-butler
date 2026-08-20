/**
 * Day 1 verification script.
 *
 * Checks that the Notion workspace is wired for Tiffin Butler:
 *   1. NOTION_TOKEN is present
 *   2. "Orders" and "Run Log" databases resolve (by title, or via env overrides)
 *   3. Every required property exists on each database
 *
 * Run: npm run check-setup
 */
import "dotenv/config";
import { Client, type DataSourceObjectResponse } from "@notionhq/client";

type PropertyKind = "title" | "rich_text" | "select" | "number" | "date" | "relation" | "checkbox";

const REQUIRED_ORDERS: Record<string, PropertyKind> = {
  Summary: "title",
  Channel: "rich_text",
  Status: "select",
  Customer: "rich_text",
  Phone: "rich_text",
  "Customer Email": "rich_text",
  "Action Sent": "checkbox",
  Items: "rich_text",
  Total: "number",
  Delivery: "date",
  Room: "rich_text",
  "AI Summary": "rich_text",
  "Raw Message": "rich_text",
  Confidence: "select",
  Language: "rich_text",
  Priority: "select",
  "Dedupe Hash": "rich_text",
};

const REQUIRED_RUN_LOG: Record<string, PropertyKind> = {
  Run: "title",
  Timestamp: "date",
  Trigger: "select",
  Job: "rich_text",
  Outcome: "select",
  Duration: "number",
  Error: "rich_text",
  Meta: "rich_text",
  Order: "relation",
};

const REQUIRED_SELECT_OPTIONS = {
  Status: ["New", "Draft", "Pending Approval", "Needs Human", "Confirmed", "Rejected", "Action Failed"],
  Confidence: ["high", "low"],
  Priority: ["normal", "urgent"],
  Trigger: ["webhook", "cron", "manual", "health", "whatsapp"],
  Outcome: ["success", "failed", "skipped", "duplicate", "needs_human", "action"],
} as const;

function ok(label: string): void {
  console.log(`  \u2714 ${label}`);
}

function fail(label: string, hint: string): void {
  console.log(`  \u2718 ${label}  -> ${hint}`);
}

async function resolveDataSource(
  client: Client,
  title: string,
  envId: string | undefined,
): Promise<string | null> {
  if (envId && envId.trim().length > 0) return envId.trim();

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

async function checkDataSource(
  client: Client,
  name: string,
  required: Record<string, PropertyKind>,
  requiredOptions: Record<string, readonly string[]>,
): Promise<void> {
  const envKey = name === "Orders" ? "NOTION_ORDERS_DB_ID" : "NOTION_RUN_LOG_DB_ID";
  const envId = process.env[envKey];
  const id = await resolveDataSource(client, name, envId);

  if (!id) {
    fail(`${name} database`, `not found. Share it with the integration (docs/setup-notion.md, section 7), or set ${envKey}.`);
    return;
  }
  ok(`${name} database resolves (id ${id.slice(0, 8)}\u2026)`);

  const ds = await client.dataSources.retrieve({ data_source_id: id });
  const props = ds.properties;

  const mismatches: string[] = [];
  for (const [propName, propType] of Object.entries(required)) {
    const prop = props[propName];
    if (!prop) {
      mismatches.push(`missing: ${propName}`);
      continue;
    }
    if (prop.type !== propType) {
      mismatches.push(`${propName} has wrong type ${prop.type}, expected ${propType}`);
      continue;
    }
    if (prop.type === "select") {
      const present = new Set((prop.select?.options ?? []).map((o) => o.name));
      const missing = requiredOptions[propName]?.filter((o) => !present.has(o)) ?? [];
      if (missing.length > 0) mismatches.push(`select options missing on ${propName}: ${missing.join(", ")}`);
    }
  }

  if (mismatches.length === 0) {
    ok(`${name}: all ${Object.keys(required).length} properties present and correct`);
  } else {
    fail(`${name} schema`, mismatches.join("; "));
  }
}

async function main(): Promise<number> {
  console.log("Tiffin Butler — Notion setup check\n");

  const token = process.env.NOTION_TOKEN;
  if (!token || token.startsWith("ntn_") === false) {
    fail("NOTION_TOKEN", "not set in .env. Get one at https://www.notion.so/my-integrations (see docs/setup-notion.md section 2).");
    return 1;
  }
  ok("integration token found");
  console.log("");

  const client = new Client({ auth: token });

  try {
    await checkDataSource(client, "Orders", REQUIRED_ORDERS, REQUIRED_SELECT_OPTIONS);
  } catch (err) {
    fail("Orders check crashed", err instanceof Error ? err.message : String(err));
  }

  try {
    await checkDataSource(client, "Run Log", REQUIRED_RUN_LOG, REQUIRED_SELECT_OPTIONS);
  } catch (err) {
    fail("Run Log check crashed", err instanceof Error ? err.message : String(err));
  }

  console.log("");
  return 0;
}

main().then((code) => process.exit(code));