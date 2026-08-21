import { Client, type DataSourceObjectResponse, type PageObjectResponse } from "@notionhq/client";
import { env } from "../config.js";

let client: Client | undefined;

export function getClient(): Client {
  if (!client) {
    if (!env.notionToken) throw new Error("NOTION_TOKEN is not set (see docs/setup-notion.md)");
    client = new Client({ auth: env.notionToken });
  }
  return client;
}

const dsCache = new Map<string, string>();
const pageCache = new Map<string, string>();

/** Resolve a database (data source) by its title. Env override wins. */
export async function resolveDataSource(title: string, envOverride?: string): Promise<string> {
  const cached = dsCache.get(title);
  if (cached) return cached;

  const override = envOverride?.trim();
  if (override) {
    dsCache.set(title, override);
    return override;
  }

  const search = await getClient().search({
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

  if (!found) {
    throw new Error(`Database "${title}" not found. Share it with the integration (docs/setup-notion.md, section 7).`);
  }
  dsCache.set(title, found.id);
  return found.id;
}

/** Resolve a page by its title. Env override wins. */
export async function resolvePage(title: string, envOverride?: string): Promise<string> {
  const cached = pageCache.get(title);
  if (cached) return cached;

  const override = envOverride?.trim();
  if (override) {
    pageCache.set(title, override);
    return override;
  }

  const search = await getClient().search({
    filter: { property: "object", value: "page" },
    query: title,
    page_size: 20,
  });
  for (const r of search.results) {
    if (r.object !== "page" || !("properties" in r)) continue;
    const page = r as PageObjectResponse;
    const titleProp = page.properties.title;
    if (titleProp?.type === "title") {
      const name = titleProp.title.map((t) => t.plain_text).join("");
      if (name.toLowerCase() === title.toLowerCase()) {
        pageCache.set(title, page.id);
        return page.id;
      }
    }
  }
  throw new Error(`Page "${title}" not found. Share it with the integration (docs/setup-notion.md, section 7).`);
}

export const getOrdersDataSource = (): Promise<string> =>
  resolveDataSource("Orders", process.env.NOTION_ORDERS_DB_ID);

export const getRunLogDataSource = (): Promise<string> =>
  resolveDataSource("Run Log", process.env.NOTION_RUN_LOG_DB_ID);

export const getMenuDataSource = (): Promise<string> =>
  resolveDataSource("Menu", process.env.NOTION_MENU_DB_ID);

export const getInboxPage = (): Promise<string> =>
  resolvePage("Inbox", process.env.NOTION_INBOX_PAGE_ID);

export const getHomePage = (): Promise<string> =>
  resolvePage("Tiffin Butler", process.env.NOTION_HOME_PAGE_ID);
