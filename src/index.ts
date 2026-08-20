import Fastify from "fastify";
import { env } from "./config.js";
import { processMessage, scanInbox } from "./jobs/processInbox.js";
import { approvalWatcher } from "./jobs/approvalWatcher.js";
import { healthCheck } from "./jobs/healthCheck.js";
import { writeRunLog } from "./runlog.js";

const app = Fastify({ logger: { level: "info" } });

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

app.get("/", async () => ({
  service: "tiffin-butler",
  ok: true,
  time: new Date().toISOString(),
  endpoints: ["POST /webhook/order", "GET /cron/process", "GET /cron/health"],
}));

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