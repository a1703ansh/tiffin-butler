import { z } from "zod";
import { env } from "../config.js";
import { business } from "../business.config.js";
import type { LoadedMenu } from "../menu.js";

export const parsedOrderSchema = z.object({
  customerName: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  items: z
    .array(z.object({ name: z.string().min(1), quantity: z.number().int().min(1).max(100) }))
    .min(1),
  deliveryDate: z.string().nullable().optional(),
  deliveryTime: z.string().nullable().optional(),
  room: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  language: z.string().nullable().optional(),
  confidence: z.enum(["high", "low"]).default("high"),
});

export type ParsedOrder = z.infer<typeof parsedOrderSchema>;

export class ParseError extends Error {
  constructor(
    message: string,
    readonly stage: "not_configured" | "http" | "bad_json" | "validation",
  ) {
    super(message);
  }
}

function buildPrompt(raw: string, menu: LoadedMenu): { system: string; user: string } {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: business.timezone });
  const menuNames = menu.entries.map((m) => m.name).join(", ");
  const menuNote =
    menu.source === "notion"
      ? `Menu the business offers (live from Notion): ${menuNames}.`
      : `Menu the business offers: ${menuNames}.`;

  const system = [
    `You extract order details from a customer's WhatsApp-style message for a tiffin/mess service in India.`,
    menuNote,
    `Today's date is ${today} (${business.timezone}).`,
    `Rules:`,
    `- Return ONLY one JSON object. No markdown, no commentary.`,
    `- Handle typos, hand-written spelling, and Hindi-English code-switching.`,
    `- items: each ordered item as {"name": string, "quantity": number}. Quantity defaults to 1 when not stated. Use the customer's wording for name, not the canonical menu name.`,
    `- deliveryDate: convert day words to an absolute date YYYY-MM-DD. "tomorrow" and "kal" and "aaj kal" -> tomorrow relative to today's date; "today"/"aaj" -> today; "parso" -> day after tomorrow. If the day is genuinely unclear, use null.`,
    `- deliveryTime: keep the value as stated ("8am", "1:30 pm"), or use the meal slot (breakfast/lunch/dinner) if that is all that is given.`,
    `- phone: a 10-digit Indian mobile number if present, else null.`,
    `- email: the customer's email address if present, else null. Validate format strictly; never invent one.`,
    `- customerName: the person's name if present, else null.`,
    `- room: hostel room/block/flat if present, else null.`,
    `- language: dominant language of the message ("en", "hi", "hinglish", ...).`,
    `- confidence: "high" only when at least the items AND a delivery day are clear, otherwise "low".`,
    `JSON keys exactly: customerName, phone, email, items, deliveryDate, deliveryTime, room, note, language, confidence`,
  ].join("\n");

  return { system, user: raw };
}

function extractJson(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("```")) {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return match[1].trim();
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

/** AI reads the messy message and returns a validated structured order. */
export async function parseOrder(raw: string, menu?: LoadedMenu): Promise<ParsedOrder> {
  if (!env.llmApiKey) throw new ParseError("LLM_API_KEY is not set", "not_configured");

  const { system, user } = buildPrompt(raw, menu ?? { entries: business.menu.map((m) => ({ name: m.name, aliases: [...m.aliases], price: m.price })), source: "config" });

  let res: Response;
  try {
    res = await fetch(`${env.llmBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.llmApiKey}`,
      },
      body: JSON.stringify({
        model: env.llmModel,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (err) {
    throw new ParseError(
      `LLM request failed: ${err instanceof Error ? err.message : String(err)}`,
      "http",
    );
  }

  if (!res.ok) {
    throw new ParseError(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, "http");
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "";

  let json: unknown;
  try {
    json = JSON.parse(extractJson(content));
  } catch {
    throw new ParseError("model returned non-JSON output", "bad_json");
  }

  const parsed = parsedOrderSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new ParseError(`output failed validation (${issues.join("; ")})`, "validation");
  }

  return parsed.data;
}