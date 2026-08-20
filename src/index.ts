import Fastify from "fastify";
import { env } from "./config.js";
import { processMessage, scanInbox } from "./jobs/processInbox.js";
import { approvalWatcher } from "./jobs/approvalWatcher.js";
import { healthCheck } from "./jobs/healthCheck.js";
import { writeRunLog } from "./runlog.js";
import { replyToWhatsApp } from "./actions/whatsapp.js";

const app = Fastify({ logger: { level: "info" } });

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

app.get("/", async () => ({
  service: "tiffin-butler",
  ok: true,
  time: new Date().toISOString(),
  endpoints: [
    "POST /webhook/order",
    "POST /webhook/whatsapp",
    "GET /webhook/whatsapp",
    "GET /cron/process",
    "GET /cron/health",
  ],
}));

// WhatsApp Cloud API: verification handshake (Meta GETs this with hub.* params).
app.get("/webhook/whatsapp", async (req, reply) => {
  if (!env.whatsappVerifyToken) {
    return reply.code(503).type("text/plain").send("WhatsApp not configured");
  }
  const q = (req.query ?? {}) as { "hub.mode"?: string; "hub.verify_token"?: string; "hub.challenge"?: string };
  if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === env.whatsappVerifyToken) {
    return reply.type("text/plain").send(q["hub.challenge"] ?? "");
  }
  return reply.code(403).type("text/plain").send("verification token mismatch");
});

// WhatsApp Cloud API: inbound messages.
app.post("/webhook/whatsapp", async (req, reply) => {
  const payload = (req.body ?? {}) as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<{ from?: string; type?: string; text?: { body?: string }; id?: string }>;
        };
      }>;
    }>;
  };

  let processed = 0;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        const body = (message.text?.body ?? "").trim();
        const from = message.from ?? "";
        if (!body || message.type !== "text") continue;
        try {
          await processMessage(body, "whatsapp", "whatsapp");
          if (env.whatsappReplies && from) {
            await replyToWhatsApp(from, "Tiffin Butler: order received — review in Notion. We'll confirm soon!");
          }
          processed += 1;
        } catch (err) {
          await writeRunLog({ trigger: "whatsapp", job: "processInbox", outcome: "failed", error: errMsg(err) }).catch(() => {});
        }
      }
    }
  }
  return processed > 0 ? { ok: true, processed } : { ok: true, processed: 0, note: "no text messages" };
});

// Trigger 1: an inbound order message arrives (WhatsApp-forward, form, curl, anything).
app.post("/webhook/order", async (req, reply) => {
  const body = (req.body ?? {}) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) {
    return reply.code(400).send({ ok: false, error: "missing string field 'text'" });
  }
  try {
    const result = await processMessage(text, "webhook");
    return { ok: true, ...result };
  } catch (err) {
    await writeRunLog({ trigger: "webhook", job: "processInbox", outcome: "failed", error: errMsg(err) }).catch(() => {});
    return reply.code(500).send({ ok: false, error: errMsg(err) });
  }
});

// Trigger 2 (cron): the every-minute ping — approval watcher + Inbox scan.
app.get("/cron/process", async () => {
  const [watched, inbox] = await Promise.all([approvalWatcher("cron"), scanInbox("cron")]);
  return { ok: true, time: new Date().toISOString(), actionsTaken: watched.acted, inboxProcessed: inbox.processed };
});

// Trigger 3 (cron): hourly heartbeat — spreads Run Log rows across the event.
app.get("/cron/health", async () => {
  await healthCheck();
  return { ok: true, time: new Date().toISOString(), note: "health row written" };
});

app.listen({ port: env.port, host: "0.0.0.0" })
  .then((address) => app.log.info(`tiffin-butler listening at ${address}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });