import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { env } from "./config.js";
import { processMessage, scanInbox } from "./jobs/processInbox.js";
import { approvalWatcher } from "./jobs/approvalWatcher.js";
import { healthCheck } from "./jobs/healthCheck.js";
import { dailyDigest } from "./jobs/dailyDigest.js";
import { writeRunLog } from "./runlog.js";
import { replyToWhatsApp, downloadWhatsAppMedia } from "./actions/whatsapp.js";
import { transcribeAudio, TranscribeError } from "./ai/transcribe.js";
import { collectStats } from "./web/stats.js";
import { landingPage, orderFormPage } from "./web/pages.js";
import { loadMenu } from "./menu.js";

const app = Fastify({ logger: { level: "info" } });
await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Public dashboard (HTML) — live stats, today's menu, recent Run Log rows.
app.get("/", async (_req, reply) => {
  try {
    return reply.type("text/html; charset=utf-8").send(landingPage(await collectStats()));
  } catch {
    return reply.type("text/html; charset=utf-8").send(
      `<!doctype html><meta charset="utf-8"><title>Tiffin Butler</title><p>🍛 Tiffin Butler is running — Notion wiring unavailable right now. Endpoints: POST /webhook/order · POST /webhook/voice · GET /cron/*</p>`,
    );
  }
});

// JSON version of the dashboard numbers.
app.get("/stats", async () => {
  try {
    return await collectStats();
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
});

// Mobile order widget (HTML form) + its JSON endpoint.
app.get("/order", async (_req, reply) => {
  const menu = await loadMenu();
  return reply.type("text/html; charset=utf-8").send(orderFormPage(menu.entries.map((e) => ({ name: e.name, price: e.price }))));
});

app.post("/order", async (req, reply) => {
  const body = (req.body ?? {}) as { message?: unknown };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return reply.code(400).send({ ok: false, error: "missing string field 'message'" });
  }
  try {
    const result = await processMessage(message, "webhook", "web");
    return {
      ok: true,
      status: result.status,
      orderId: result.orderId ?? result.existingOrderId,
      note: result.note,
    };
  } catch (err) {
    await writeRunLog({ trigger: "webhook", job: "processInbox", outcome: "failed", error: errMsg(err), meta: "web order" }).catch(() => {});
    return reply.code(500).send({ ok: false, error: errMsg(err) });
  }
});

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

// WhatsApp Cloud API: inbound messages (text + voice notes).
app.post("/webhook/whatsapp", async (req, reply) => {
  const payload = (req.body ?? {}) as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<{
            from?: string;
            type?: string;
            id?: string;
            text?: { body?: string };
            audio?: { id?: string; mime_type?: string };
            voice?: { id?: string; mime_type?: string };
          }>;
        };
      }>;
    }>;
  };

  let processed = 0;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        const from = message.from ?? "";
        try {
          if (message.type === "text" && message.text?.body?.trim()) {
            await processMessage(message.text.body.trim(), "whatsapp", "whatsapp");
            if (env.whatsappReplies && from) {
              await replyToWhatsApp(from, "Tiffin Butler: order received — review in Notion. We'll confirm soon!");
            }
            processed += 1;
          } else if (message.type === "audio" || message.type === "voice") {
            // Voice note: download -> Whisper transcript -> same order pipeline.
            const media = message.audio ?? message.voice;
            if (!media?.id) continue;

            const dl = await downloadWhatsAppMedia(media.id);
            if (!dl.ok) {
              await writeRunLog({ trigger: "whatsapp", job: "transcribe", outcome: "failed", error: dl.error }).catch(() => {});
              continue;
            }

            const mime = media.mime_type ?? dl.mime;
            const ext = mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : "ogg";
            let transcript = "";
            try {
              transcript = (await transcribeAudio({ buffer: dl.buffer, filename: `voice-note.${ext}`, mime })).text;
            } catch (err) {
              const msg = err instanceof TranscribeError ? `${err.stage}: ${err.message}` : errMsg(err);
              await writeRunLog({ trigger: "whatsapp", job: "transcribe", outcome: "failed", error: msg }).catch(() => {});
              continue;
            }

            await processMessage(transcript, "whatsapp", "whatsapp");
            if (env.whatsappReplies && from) {
              await replyToWhatsApp(from, "Tiffin Butler: voice note received! We heard your order — review in Notion. We'll confirm soon.");
            }
            processed += 1;
          }
        } catch (err) {
          await writeRunLog({ trigger: "whatsapp", job: "processInbox", outcome: "failed", error: errMsg(err) }).catch(() => {});
        }
      }
    }
  }
  return processed > 0 ? { ok: true, processed } : { ok: true, processed: 0, note: "no processable messages" };
});

// Voice intake without WhatsApp: upload any audio recording directly.
// Demo-day Meta wiring reuses this exact transcribe->parse path.
app.post("/webhook/voice", async (req, reply) => {
  const q = (req.query ?? {}) as { channel?: string };

  let file: { buffer: Buffer; filename: string; mime: string } | null = null;
  try {
    for await (const part of req.parts()) {
      if (part.type === "file" && !file) {
        file = {
          buffer: await part.toBuffer(),
          filename: part.filename || "audio.ogg",
          mime: part.mimetype || "application/octet-stream",
        };
      }
    }
  } catch (err) {
    return reply.code(400).send({ ok: false, error: `could not read upload: ${errMsg(err)}` });
  }

  if (!file) {
    return reply.code(400).send({
      ok: false,
      error: "multipart field 'file' with an audio recording is required (curl -F file=@order.m4a https://…/webhook/voice)",
    });
  }

  let transcript: string;
  try {
    transcript = (await transcribeAudio(file)).text;
  } catch (err) {
    const msg = err instanceof TranscribeError ? `${err.stage}: ${err.message}` : errMsg(err);
    await writeRunLog({ trigger: "voice", job: "transcribe", outcome: "failed", error: msg }).catch(() => {});
    return reply.code(422).send({ ok: false, error: msg });
  }

  try {
    const result = await processMessage(transcript, "voice", q.channel ?? "voice");
    return { ok: true, transcript, ...result };
  } catch (err) {
    await writeRunLog({ trigger: "voice", job: "processInbox", outcome: "failed", error: errMsg(err) }).catch(() => {});
    return reply.code(500).send({ ok: false, transcript, error: errMsg(err) });
  }
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

// Trigger 4 (cron): evening owner digest — today's orders + what needs a human.
app.get("/cron/digest", async () => {
  try {
    const d = await dailyDigest();
    return { ok: true, time: new Date().toISOString(), orders: d.orders, revenue: d.revenue, emailed: d.emailed };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
});

app.listen({ port: env.port, host: "0.0.0.0" })
  .then((address) => app.log.info(`tiffin-butler listening at ${address}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });